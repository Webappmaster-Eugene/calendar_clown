import type { Context } from "telegraf";
import {
  OSINT_DAILY_LIMIT,
  OSINT_ANALYSIS_MODEL,
  DEEPSEEK_MODEL,
  OSINT_RESULTS_PER_QUERY,
  OSINT_TOP_SOURCES,
  OSINT_RAW_CONTENT_TOP,
  OSINT_EXTRACT_URLS_LIMIT,
  OSINT_ANALYSIS_MAX_TOKENS,
} from "../constants.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import { tryParseJson } from "../utils/parseJson.js";
import { createLogger } from "../utils/logger.js";
import { parseSearchSubject, generateSearchQueries } from "./queryParser.js";
import { tavilySearchMulti, tavilyExtract } from "./searchClient.js";
import { createSearch, updateSearchStatus, countTodaySearches } from "./repository.js";
import { formatReport } from "./reportFormatter.js";
import { splitMessage } from "../utils/telegram.js";
import type { OsintParsedSubject, OsintSearch, TavilyResult, TavilyImage, IntermediateAnalysis } from "./types.js";

const log = createLogger("osint-orchestrator");

export interface OrchestratorResult {
  success: boolean;
  error?: string;
  search?: OsintSearch;
  extractedCount?: number;
}

/**
 * Run the full two-phase OSINT search pipeline with progress updates.
 * Phase 1: Broad discovery (30-35 queries, raw content)
 * Phase 2: Deep extraction (follow-up queries + profile extraction)
 */
export async function runOsintSearch(
  ctx: Context,
  chatId: number,
  statusMsgId: number,
  userId: number,
  queryText: string,
  inputMethod: "text" | "voice"
): Promise<OrchestratorResult> {
  // 1. Rate limit check
  const todayCount = await countTodaySearches(userId);
  if (todayCount >= OSINT_DAILY_LIMIT) {
    return {
      success: false,
      error: `⚠️ Достигнут дневной лимит поисков (${OSINT_DAILY_LIMIT}/${OSINT_DAILY_LIMIT}). Попробуйте завтра.`,
    };
  }

  // 2. Create DB record
  const search = await createSearch(userId, queryText, inputMethod);

  try {
    // 3. Parse subject
    await editStatus(ctx, chatId, statusMsgId, "🔍 Анализирую запрос...");
    const parseResult = await parseSearchSubject(queryText);

    if (!parseResult.sufficient || !parseResult.subject) {
      await updateSearchStatus(search.id, "failed", {
        errorMessage: "Недостаточно данных для поиска",
        parsedSubject: parseResult.subject ?? undefined,
      });
      return {
        success: false,
        error: "❓ Недостаточно данных для поиска. Укажите более конкретную информацию: ФИО с фамилией, город, компанию, телефон или email.",
      };
    }

    await updateSearchStatus(search.id, "searching", {
      parsedSubject: parseResult.subject,
    });

    // 4. Generate search queries
    await editStatus(ctx, chatId, statusMsgId, "🔍 Формирую поисковые запросы...");
    const queries = await generateSearchQueries(parseResult.subject);

    await updateSearchStatus(search.id, "searching", {
      searchQueries: queries,
    });

    // 5. Phase 1: Broad discovery
    await editStatus(ctx, chatId, statusMsgId, `🔍 Фаза 1: поиск по ${queries.length} запросам...`);

    if (!process.env.TAVILY_API_KEY) {
      await updateSearchStatus(search.id, "failed", {
        errorMessage: "TAVILY_API_KEY не настроен",
      });
      return {
        success: false,
        error: "⚠️ OSINT-поиск не настроен. Обратитесь к администратору (TAVILY_API_KEY).",
      };
    }

    const phase1Result = await tavilySearchMulti(queries, OSINT_RESULTS_PER_QUERY, true);
    let allResults = phase1Result.results;
    const allImages = phase1Result.images;

    if (allResults.length === 0) {
      // Try with simpler queries
      const simpleQuery = parseResult.subject.name || queryText;
      const fallbackResult = await tavilySearchMulti([simpleQuery], 10, true);
      if (fallbackResult.results.length === 0) {
        await updateSearchStatus(search.id, "completed", {
          rawResults: [],
          report: "Информация не найдена по данному запросу.",
          sourcesCount: 0,
        });
        return {
          success: true,
          search: { ...search, status: "completed", report: "Информация не найдена по данному запросу.", sourcesCount: 0 },
        };
      }
      allResults = fallbackResult.results;
      allImages.push(...fallbackResult.images);
    }

    await editStatus(ctx, chatId, statusMsgId, `🔍 Фаза 1: найдено ${allResults.length} источников, углубляю поиск...`);

    // 6. Phase 1 intermediate analysis
    let phase1Findings: string | undefined;
    let extractedCount = 0;
    const intermediate = await analyzePhase1(parseResult.subject, allResults.slice(0, 40));

    if (intermediate) {
      phase1Findings = intermediate.keyFindings;

      // 7. Phase 2: Deep extraction
      const followUpCount = intermediate.followUpQueries.length;
      const extractCount = Math.min(intermediate.profileUrls.length, OSINT_EXTRACT_URLS_LIMIT);

      if (followUpCount > 0 || extractCount > 0) {
        await editStatus(
          ctx,
          chatId,
          statusMsgId,
          `🔍 Фаза 2: ${followUpCount} доп. запросов + извлечение ${extractCount} профилей...`
        );

        // Phase 2 searches and extract in parallel
        const [phase2Result, extractedProfiles] = await Promise.all([
          followUpCount > 0
            ? tavilySearchMulti(intermediate.followUpQueries, OSINT_RESULTS_PER_QUERY, true)
            : Promise.resolve({ results: [], images: [] }),
          extractCount > 0
            ? tavilyExtract(intermediate.profileUrls.slice(0, OSINT_EXTRACT_URLS_LIMIT))
            : Promise.resolve([]),
        ]);

        // Merge Phase 2 search results
        if (phase2Result.results.length > 0) {
          allResults = mergeAndDedup(allResults, phase2Result.results);
          allImages.push(...phase2Result.images);
        }

        // Merge extracted profiles as high-score results
        for (const profile of extractedProfiles) {
          const existing = allResults.find((r) => r.url === profile.url);
          if (existing) {
            existing.raw_content = profile.raw_content;
          } else {
            allResults.push({
              title: profile.url,
              url: profile.url,
              content: profile.raw_content.slice(0, 500),
              score: 0.8,
              raw_content: profile.raw_content,
            });
          }
        }
        extractedCount = extractedProfiles.length;
      }
    }

    await updateSearchStatus(search.id, "analyzing", {
      rawResults: allResults.slice(0, OSINT_TOP_SOURCES),
      sourcesCount: allResults.length,
    });

    // 8. Final analysis
    await editStatus(ctx, chatId, statusMsgId, `🧠 Анализирую ${allResults.length} источников...`);
    const report = await analyzeResults(parseResult.subject, allResults, allImages, queryText, phase1Findings);

    // 9. Save completed
    const sourcesCount = allResults.length;
    await updateSearchStatus(search.id, "completed", {
      report,
      sourcesCount,
    });

    return {
      success: true,
      search: { ...search, status: "completed", report, sourcesCount },
      extractedCount,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    log.error("OSINT search pipeline error:", err);

    await updateSearchStatus(search.id, "failed", { errorMessage }).catch((e) =>
      log.error("Failed to update search status:", e)
    );

    return {
      success: false,
      error: `❌ Ошибка при выполнении поиска: ${errorMessage}`,
    };
  }
}

/** Send report to user, splitting if needed. */
export async function sendReport(
  ctx: Context,
  chatId: number,
  statusMsgId: number,
  report: string,
  sourcesCount: number,
  extractedCount: number = 0
): Promise<void> {
  const formatted = formatReport(report, sourcesCount, extractedCount);
  const chunks = splitMessage(formatted);

  // Edit the status message with the first chunk
  try {
    await ctx.telegram.editMessageText(chatId, statusMsgId, undefined, chunks[0], {
      parse_mode: "Markdown",
    });
  } catch {
    // Fallback: plain text
    await ctx.telegram.editMessageText(
      chatId,
      statusMsgId,
      undefined,
      chunks[0].replace(/[*_`\[\]\\]/g, "")
    );
  }

  // Send remaining chunks as new messages
  for (let i = 1; i < chunks.length; i++) {
    try {
      await ctx.telegram.sendMessage(chatId, chunks[i], { parse_mode: "Markdown" });
    } catch {
      await ctx.telegram.sendMessage(chatId, chunks[i].replace(/[*_`\[\]\\]/g, ""));
    }
  }
}

async function editStatus(ctx: Context, chatId: number, msgId: number, text: string): Promise<void> {
  try {
    await ctx.telegram.editMessageText(chatId, msgId, undefined, text);
  } catch {
    // Ignore edit errors (message not modified, etc.)
  }
}

// --- Phase 1 Intermediate Analysis ---

const PHASE1_ANALYSIS_PROMPT = `Ты — OSINT-аналитик. Проанализируй промежуточные результаты поиска (Фаза 1) и определи направления для углублённого поиска.

На входе: массив результатов веб-поиска (title, url, content, raw_content).

Задача:
1. Выяви ключевые лиды: связанные лица, компании, адреса, телефоны, ИНН
2. Определи URL профилей, которые стоит извлечь полностью (соцсети, реестры, rusprofile, LinkedIn и т.п.)
3. Сформулируй 10-15 целевых follow-up запросов для Фазы 2
4. Кратко опиши ключевые находки
5. Выявляй упоминания членов семьи — имена жены/мужа, детей, родителей, братьев/сестёр и их связи с объектом
6. Обнаруживай Telegram-аккаунты, каналы, группы и чаты, связанные с объектом
7. Фиксируй все найденные номера телефонов и email для дальнейшего поиска в утечках
8. Определяй географию — города проживания, страны посещения, места путешествий
9. Выявляй хобби, интересы, привычки, спортивные увлечения
10. Обнаруживай друзей, коллег, деловых партнёров из соцсетей и публичных источников

Верни строго JSON (без markdown):
{
  "followUpQueries": ["запрос 1", "запрос 2", ...],
  "profileUrls": ["https://...", ...],
  "discoveredEntities": ["ООО Компания", "Иванов И.И.", ...],
  "keyFindings": "Краткое описание ключевых находок Фазы 1"
}

Правила:
- followUpQueries: 10-15 запросов, НЕ повторяющих запросы Фазы 1. Включай запросы по обнаруженным родственникам, Telegram-каналам, email/телефонам в утечках
- profileUrls: до 20 URL, приоритет — соцсети, rusprofile, реестры, LinkedIn, Telegram-каналы
- discoveredEntities: связанные лица (включая членов семьи), компании, ИНН обнаруженные в результатах
- keyFindings: 3-5 предложений с главными находками, включая семейные связи и контакты`;

async function analyzePhase1(
  subject: OsintParsedSubject,
  results: TavilyResult[]
): Promise<IntermediateAnalysis | null> {
  try {
    const sourcesText = results
      .map((r, i) => {
        const content = r.raw_content ? r.raw_content.slice(0, 1500) : r.content;
        return `[${i + 1}] ${r.title}\nURL: ${r.url}\n${content}`;
      })
      .join("\n\n---\n\n");

    const userMessage = `Объект поиска: ${JSON.stringify(subject)}

Результаты Фазы 1 (${results.length} источников):
${sourcesText}`;

    const raw = await callOpenRouter({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: PHASE1_ANALYSIS_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2,
    });

    if (!raw) {
      log.warn("Empty response from Phase 1 analysis");
      return null;
    }

    const parsed = tryParseJson(raw);
    if (!parsed) {
      log.warn("Failed to parse Phase 1 analysis response:", raw.slice(0, 200));
      return null;
    }

    return {
      followUpQueries: Array.isArray(parsed.followUpQueries)
        ? parsed.followUpQueries.filter((q: unknown): q is string => typeof q === "string")
        : [],
      profileUrls: Array.isArray(parsed.profileUrls)
        ? parsed.profileUrls.filter((u: unknown): u is string => typeof u === "string")
        : [],
      discoveredEntities: Array.isArray(parsed.discoveredEntities)
        ? parsed.discoveredEntities.filter((e: unknown): e is string => typeof e === "string")
        : [],
      keyFindings: typeof parsed.keyFindings === "string" ? parsed.keyFindings : "",
    };
  } catch (err) {
    log.error("Phase 1 analysis error:", err);
    return null;
  }
}

// --- Final Analysis ---

const ANALYSIS_PROMPT = `Ты — профессиональный OSINT-аналитик с опытом работы в конкурентной разведке. Проанализируй найденные данные и составь максимально подробный структурированный отчёт.

Отчёт должен быть на русском языке, в формате Markdown (Telegram V1: *bold*, _italic_, \`code\`).
Используй следующие 22 раздела (пропускай только если данных совсем нет, но лучше указать «данных не найдено»):

*1. Краткое резюме* — 2-3 предложения с ключевыми выводами о найденной информации.

*2. Идентификация* — ФИО (полное), дата рождения (точная или приблизительная), возраст (точный или приблизительный), место рождения, город проживания, ИНН/ОГРН если найдены.

*3. Хронология ключевых событий* — хронологический список (по годам) основных событий: регистрация компаний, судебные дела, смена должностей, публикации. Формат: "ГГГГ — событие (источник)".

*4. Биография и образование* — учебные заведения (школа, университет, степени), специальность, карьерный путь по годам. Курсы, сертификаты, научные работы/диссертации. Источники данных.

*5. Профессиональная деятельность* — должности, компании, роли (учредитель, директор, сотрудник). Карьерный путь если прослеживается. Профессиональные достижения.

*6. Финансовые данные и бизнес* — выручка и прибыль компаний (rusprofile.ru), доли владения, уставный капитал. Исполнительные производства ФССП (суммы, статус). Арбитражные дела (arbitr.ru): суммы, роль (истец/ответчик). Банкротство. Долговые обязательства. Общая оценка финансового состояния и социального положения.

*7. Государственные реестры* — данные из ЕГРЮЛ/ЕГРИП (компании, ИП, даты регистрации, статус), ФССП (исполнительные производства с суммами), судебные решения (sudact.ru), банкротство (fedresurs). Если ничего не найдено — укажи это явно.

*8. Недвижимость и адреса* — адрес проживания (текущий и прежние), зарегистрированная собственность, кадастровые данные, адреса регистрации компаний, данные Росреестра, адреса из reformagkh.ru, объявления на ЦИАН/Авито. Только публично доступные данные.

*9. Автомобили и транспорт* — госномера, марки, модели, год выпуска автомобилей. Штрафы ГИБДД, ДТП, данные с avto-nomer.ru. Если данных нет — укажи явно.

*10. Штрафы и правонарушения* — штрафы ГИБДД, административные правонарушения, протоколы, исполнительные производства. Если данных нет — укажи явно.

*11. Онлайн-присутствие и фотографии* — профили в соцсетях (VK, OK, Instagram, Facebook, LinkedIn, Pikabu, Drive2) со ссылками. Telegram-аккаунты. Форумы, блоги, комментарии. ВСЕ найденные URL фотографий — перечисли каждый с описанием и источником, пометка 📷.

*12. Telegram* — аккаунты (@username), каналы, боты, связи в Telegram, участие в группах и чатах, публикации в Telegram-каналах. Данные с t.me, tgstat.ru, telemetr.me.

*13. Контактная информация* — все найденные номера телефонов, email-адреса, мессенджеры (Telegram, WhatsApp, Viber), сайты, другие способы связи. Только публично доступные данные.

*14. Утечки данных* — найденные в утечках email, пароли, телефоны, адреса, IP-адреса. Базы данных, в которых обнаружены данные объекта. Если данных нет — укажи явно.

*15. Семья и родственники* — жена/муж (ФИО), дети (имена, возраст), родители (ФИО), братья/сёстры, ближайшие родственники. Источники информации о каждом члене семьи. Семейное положение.

*16. Друзья и связи* — друзья из соцсетей, деловые партнёры, коллеги, совместные фото/публикации, общие группы. Ключевые связи с описанием характера отношений.

*17. Упоминания в СМИ* — статьи, новости, обсуждения, публикации. Укажи источник, дату и краткое содержание каждого упоминания.

*18. Хобби, интересы и свободное время* — хобби, спорт, клубы, секции, увлечения (из Strava, sports.ru, соцсетей). Где и как проводит свободное время. Членство в клубах/организациях.

*19. Путешествия и география* — города и страны посещения, чекины, фото из поездок, частота путешествий, любимые направления. Данные из Instagram, VK, TripAdvisor, Foursquare.

*20. Характеристика личности* — вредные привычки, отличительные черты, стиль общения (на основе постов/комментариев), манера поведения, активность в сети. Только на основе фактических данных.

*21. Перекрёстный анализ* — факты, подтверждённые несколькими независимыми источниками. Противоречия между источниками. Паттерны поведения и связей.

*22. Оценка достоверности* — уровень уверенности в собранных данных (высокий/средний/низкий), найденные противоречия, пробелы в информации, рекомендации по дополнительной проверке. Какие направления требуют углублённого поиска.

Приоритизируй raw_content когда доступен — он содержит полный текст страницы.
Построй хронологию по годам если достаточно данных.
Перекрёстно проверяй факты между источниками.
Будь максимально подробен. Извлекай всю возможную информацию из источников.
Не придумывай информацию — только то, что подтверждено источниками.
Если информации мало — так и напиши, но укажи что именно не удалось найти.
Не используй MarkdownV2 символы (не экранируй точки, скобки и т.п.).`;

async function analyzeResults(
  subject: OsintParsedSubject,
  results: TavilyResult[],
  images: TavilyImage[],
  originalQuery: string,
  phase1Findings?: string
): Promise<string> {
  const topResults = results.slice(0, OSINT_TOP_SOURCES);

  // For top N results by score, include raw_content (truncated); for rest — only snippet
  const sourcesText = topResults
    .map((r, i) => {
      let content: string;
      if (i < OSINT_RAW_CONTENT_TOP && r.raw_content) {
        content = r.raw_content.slice(0, 3000);
      } else {
        content = r.content;
      }
      return `[${i + 1}] ${r.title}\nURL: ${r.url}\n${content}`;
    })
    .join("\n\n---\n\n");

  const imagesText = images.length > 0
    ? `\n\nНайденные изображения:\n${images.map((img, i) => `[Фото ${i + 1}] ${img.url}${img.description ? ` — ${img.description}` : ""}`).join("\n")}`
    : "";

  const phase1Context = phase1Findings
    ? `\nКлючевые находки Фазы 1 (промежуточный анализ):\n${phase1Findings}\n`
    : "";

  const userMessage = `Запрос пользователя: "${originalQuery}"
Данные об объекте: ${JSON.stringify(subject)}
${phase1Context}
Найденные источники (${topResults.length}):
${sourcesText}${imagesText}`;

  const report = await callOpenRouter({
    model: OSINT_ANALYSIS_MODEL,
    messages: [
      { role: "system", content: ANALYSIS_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.3,
    max_tokens: OSINT_ANALYSIS_MAX_TOKENS,
  });

  return report || "Не удалось сформировать отчёт.";
}

/** Merge two result arrays, deduplicating by URL (keeping higher score). */
function mergeAndDedup(existing: TavilyResult[], incoming: TavilyResult[]): TavilyResult[] {
  const seen = new Map<string, TavilyResult>();

  for (const r of existing) {
    seen.set(r.url, r);
  }

  for (const r of incoming) {
    const prev = seen.get(r.url);
    if (!prev || r.score > prev.score) {
      // Preserve raw_content from previous if new one doesn't have it
      if (prev?.raw_content && !r.raw_content) {
        r.raw_content = prev.raw_content;
      }
      seen.set(r.url, r);
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.score - a.score);
}
