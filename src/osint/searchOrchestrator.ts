import type { Context } from "telegraf";
import {
  OSINT_DAILY_LIMIT,
  OSINT_ANALYSIS_MODEL,
  DEEPSEEK_MODEL,
  OSINT_RESULTS_PER_QUERY,
  OSINT_TOP_SOURCES,
  OSINT_RAW_CONTENT_TOP,
  OSINT_RAW_CONTENT_MEDIUM_END,
  OSINT_EXTRACT_URLS_LIMIT,
  OSINT_ANALYSIS_MAX_TOKENS,
  OSINT_PHASE1_ANALYSIS_LIMIT,
} from "../constants.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import { tryParseJson } from "../utils/parseJson.js";
import { createLogger } from "../utils/logger.js";
import { parseSearchSubject, generateSearchQueries } from "./queryParser.js";
import { tavilySearchMulti, tavilyExtract } from "./searchClient.js";
import { createSearch, updateSearchStatus, countTodaySearches, getSearchById } from "./repository.js";
import { formatReport } from "./reportFormatter.js";
import { splitMessage } from "../utils/telegram.js";
import type { OsintParsedSubject, OsintSearch, TavilyResult, TavilyImage, IntermediateAnalysis } from "./types.js";

const log = createLogger("osint-orchestrator");

/** Callback for reporting pipeline progress (optional). */
export type ProgressCallback = (text: string) => Promise<void>;

export interface OrchestratorOptions {
  /** If set, skip DB record creation and rate-limit check (record already exists). */
  existingSearchId?: number;
  /** Optional callback for progress updates (e.g. editing a Telegram message). */
  onProgress?: ProgressCallback;
}

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
 *
 * When `options.existingSearchId` is provided, uses the existing DB record
 * instead of creating a new one (used by API/Mini App flow).
 */
export async function runOsintSearch(
  userId: number,
  queryText: string,
  inputMethod: "text" | "voice",
  options?: OrchestratorOptions
): Promise<OrchestratorResult> {
  const onProgress = options?.onProgress;
  let search: OsintSearch;

  if (options?.existingSearchId) {
    // API flow: record already created by initiateSearch(), verify it's still pending
    const existing = await getSearchById(options.existingSearchId, userId);
    if (!existing) {
      return { success: false, error: "Поиск не найден." };
    }
    if (existing.status !== "pending") {
      return { success: false, error: "Поиск уже запущен или завершён." };
    }
    search = existing;
  } else {
    // Bot flow: check rate limit and create record
    const todayCount = await countTodaySearches(userId);
    if (todayCount >= OSINT_DAILY_LIMIT) {
      return {
        success: false,
        error: `⚠️ Достигнут дневной лимит поисков (${OSINT_DAILY_LIMIT}/${OSINT_DAILY_LIMIT}). Попробуйте завтра.`,
      };
    }
    search = await createSearch(userId, queryText, inputMethod);
  }

  try {
    // 3. Parse subject
    await onProgress?.("🔍 Анализирую запрос...");
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
    await onProgress?.("🔍 Формирую поисковые запросы...");
    const queries = await generateSearchQueries(parseResult.subject);

    await updateSearchStatus(search.id, "searching", {
      searchQueries: queries,
    });

    // 5. Phase 1: Broad discovery
    await onProgress?.(`🔍 Фаза 1: поиск по ${queries.length} запросам...`);

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

    await onProgress?.(`🔍 Фаза 1: найдено ${allResults.length} источников, углубляю поиск...`);

    // 6. Phase 1 intermediate analysis
    let phase1Findings: string | undefined;
    let extractedCount = 0;
    const intermediate = await analyzePhase1(parseResult.subject, allResults.slice(0, OSINT_PHASE1_ANALYSIS_LIMIT));

    if (intermediate) {
      phase1Findings = intermediate.keyFindings;

      // 7. Phase 2: Deep extraction
      const followUpCount = intermediate.followUpQueries.length;
      const extractCount = Math.min(intermediate.profileUrls.length, OSINT_EXTRACT_URLS_LIMIT);

      if (followUpCount > 0 || extractCount > 0) {
        await onProgress?.(
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
    await onProgress?.(`🧠 Анализирую ${allResults.length} источников...`);
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
  _sourcesCount: number,
  _extractedCount: number = 0
): Promise<void> {
  const formatted = formatReport(report);
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

// --- Phase 1 Intermediate Analysis ---

const PHASE1_ANALYSIS_PROMPT = `Ты — OSINT-аналитик. Проанализируй промежуточные результаты поиска (Фаза 1) и определи направления для углублённого поиска.

На входе: массив результатов веб-поиска (title, url, content, raw_content).

Задача:
1. Выяви ключевые лиды: связанные лица, компании, адреса, телефоны, ИНН
2. Определи URL профилей, которые стоит извлечь полностью (соцсети, реестры, rusprofile, LinkedIn и т.п.)
3. Сформулируй 20-25 целевых follow-up запросов для Фазы 2
4. Кратко опиши ключевые находки
5. Выявляй упоминания членов семьи — имена жены/мужа, детей, родителей, братьев/сестёр и их связи с объектом
6. Обнаруживай Telegram-аккаунты, каналы, группы и чаты, связанные с объектом
7. Фиксируй все найденные номера телефонов и email для дальнейшего поиска в утечках
8. Определяй географию — города проживания, страны посещения, места путешествий
9. Выявляй хобби, интересы, привычки, спортивные увлечения
10. Обнаруживай друзей, коллег, деловых партнёров из соцсетей и публичных источников
11. Выявляй черты характера, манеру общения, конфликтность из текстов постов, комментариев и отзывов
12. Анализируй семейную динамику — конфликты, поддержка, совместная деятельность, разводы, свадьбы
13. Фиксируй данные из утечек баз компаний и сервисов (Яндекс Еда, СДЭК, Wildberries, Ozon) — адреса доставки, заказы, пароли

ПРИОРИТИЗАЦИЯ follow-up запросов:
- Высший приоритет: запросы по обнаруженным конкретным сущностям (ИНН, телефон, email, username, конкретные ФИО родственников) — дают самые точные результаты
- Средний приоритет: site-specific запросы по обнаруженным платформам (нашли VK — копай глубже в VK, нашли rusprofile — ищи связанные компании)
- Низкий приоритет: общие тематические запросы

Верни строго JSON (без markdown):
{
  "followUpQueries": ["запрос 1", "запрос 2", ...],
  "profileUrls": ["https://...", ...],
  "discoveredEntities": ["ООО Компания", "Иванов И.И.", ...],
  "keyFindings": "Краткое описание ключевых находок Фазы 1"
}

Правила:
- followUpQueries: 20-25 запросов, НЕ повторяющих запросы Фазы 1. Включай запросы по обнаруженным родственникам, Telegram-каналам, email/телефонам в утечках. Каждый запрос должен быть максимально конкретным.
- profileUrls: до 30 URL, приоритет — соцсети, rusprofile, реестры, LinkedIn, Telegram-каналы, судебные дела, ФССП
- discoveredEntities: связанные лица (включая членов семьи), компании, ИНН обнаруженные в результатах
- keyFindings: 5-10 предложений с главными находками, включая семейные связи и контакты. Перечисли ВСЕ обнаруженные конкретные факты: ФИО, даты, суммы, адреса, должности.`;

async function analyzePhase1(
  subject: OsintParsedSubject,
  results: TavilyResult[]
): Promise<IntermediateAnalysis | null> {
  try {
    const sourcesText = results
      .map((r, i) => {
        const content = r.raw_content ? r.raw_content.slice(0, 3000) : r.content;
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

КРИТИЧЕСКИ ВАЖНО:
- Пиши МАКСИМАЛЬНО подробно в тех разделах, где есть реальные данные. Лучше написать 3 блока очень глубоко и детально, чем 8 блоков поверхностно.
- Для каждого найденного факта указывай: что именно найдено, откуда (номер источника [N]), когда (дата если есть), и какие выводы можно сделать.
- Пустые подразделы ПРОПУСКАЙ ПОЛНОСТЬЮ — НЕ пиши "данных не найдено", "информация не обнаружена" и т.п. Это трата объёма отчёта. Весь бюджет отчёта трать на углубление разделов с реальными находками.
- Если в одном источнике много данных — извлеки ВСЁ до последней детали. Перечисляй конкретные факты, даты, суммы, адреса, имена, должности. Не обобщай.
- Цитируй ключевые фрагменты из источников дословно (в кавычках) когда это добавляет ценность.
- При анализе профилей соцсетей перечисляй конкретные посты, даты публикаций, реакции — не ограничивайся обобщениями.

Отчёт должен быть на русском языке, в формате Markdown (Telegram V1: *bold*, _italic_, \`code\`).
Используй следующую структуру из 8 блоков. Каждый блок начинай с заголовка: *━━━ БЛОК N: НАЗВАНИЕ ━━━*
Подразделы оформляй как: *N.M Название*
Включай ТОЛЬКО подразделы, по которым есть реальные данные.

*━━━ БЛОК I: ОБЗОР ━━━*

*1.1 Краткое резюме* — 3-5 предложений с ключевыми выводами. Главные факты, которые определяют профиль человека.

*1.2 Хронология ключевых событий* — хронологический список (по годам) основных событий: регистрация компаний, судебные дела, смена должностей, публикации. Формат: "ГГГГ — событие [N]". Чем больше событий, тем лучше.

*━━━ БЛОК II: ПЕРСОНАЛЬНЫЕ ДАННЫЕ ━━━*

*2.1 Идентификация* — ФИО (полное), все вариации имени (транслитерации, девичья фамилия, псевдонимы, написание латиницей), дата рождения (точная или приблизительная), возраст, место рождения, город проживания, ИНН, ОГРН, СНИЛС, паспортные данные (если найдены в публичных источниках). Для каждого факта — источник [N].

*2.2 Контактная информация* — все найденные номера телефонов, email-адреса, мессенджеры (Telegram, WhatsApp, Viber), сайты, другие способы связи. Для каждого контакта указывай где найден [N].

*2.3 Утечки данных* — детализация по источникам утечек. Для каждой утечки указывай:
  - Название базы/сервиса (Яндекс Еда, СДЭК, Wildberries, Ozon, ГИБДД, Delivery Club и др.)
  - Дата утечки
  - Какие данные утекли: email, пароль (полный/хеш), телефон, адрес доставки, состав заказов, IP-адрес, платёжные данные (последние 4 цифры карты)
  - Что можно вывести из данных утечки (адрес проживания по доставкам, предпочтения по заказам, финансовые привычки)

*━━━ БЛОК III: АДРЕСА И ИМУЩЕСТВО ━━━*

*3.1 Недвижимость и адреса* — адрес проживания (текущий и исторические), зарегистрированная собственность, кадастровые данные, адреса регистрации компаний, данные Росреестра, адреса из reformagkh.ru, объявления на ЦИАН/Авито.

*3.2 Автомобили и транспорт* — госномера, марки, модели, год выпуска автомобилей. Штрафы ГИБДД, ДТП, данные с avto-nomer.ru.

*━━━ БЛОК IV: СЕМЬЯ И ОКРУЖЕНИЕ ━━━*

*4.1 Семья и родственники* — жена/муж (ФИО, возраст, род деятельности), дети (имена, возраст, учебные заведения), родители (ФИО, род деятельности), братья/сёстры, ближайшие родственники. Источники информации о каждом члене семьи [N]. Семейное положение.
Проанализируй характер семейных отношений на основе соцсетей — совместные фото, поздравления, конфликты, разводы, алименты, раздел имущества. Общая динамика семьи: крепкая/конфликтная/дистанцированная.

*4.2 Друзья и связи* — друзья из соцсетей, деловые партнёры, коллеги, совместные фото/публикации, общие группы. Ключевые связи с описанием характера отношений. Конкретные имена и контекст знакомства.

*━━━ БЛОК V: РАБОТА И ФИНАНСЫ ━━━*

*5.1 Образование* — учебные заведения (школа, университет, степени), специальность, карьерный путь по годам. Курсы, сертификаты, научные работы/диссертации. Источники данных [N].

*5.2 Профессиональная деятельность* — должности, компании, роли (учредитель, директор, сотрудник). Полный карьерный путь по годам. Профессиональные достижения. Для каждой позиции — источник [N].

*5.3 Финансовые данные и бизнес* — выручка и прибыль компаний (rusprofile.ru), доли владения, уставный капитал. Исполнительные производства ФССП (суммы, статус, даты). Арбитражные дела (arbitr.ru): суммы, роль (истец/ответчик), даты, номера дел. Банкротство. Долговые обязательства. Общая оценка финансового состояния с доказательствами.

*5.4 Государственные реестры* — данные из ЕГРЮЛ/ЕГРИП (компании, ИП, даты регистрации, статус), ФССП (исполнительные производства с суммами), судебные решения (sudact.ru), банкротство (fedresurs). Конкретные номера дел, даты, суммы.

*5.5 Штрафы и правонарушения* — штрафы ГИБДД, административные правонарушения, протоколы, исполнительные производства.

*━━━ БЛОК VI: ЦИФРОВОЙ СЛЕД ━━━*

*6.1 Соцсети и фотографии* — профили в соцсетях (VK, OK, Instagram, Facebook, LinkedIn, Pikabu, Drive2) со ссылками. ВСЕ найденные URL фотографий — перечисли каждый с описанием и источником, пометка 📷. Анализ контента профилей: о чём пишет, что публикует, какие фото, частота активности, количество друзей/подписчиков.

*6.2 Telegram* — аккаунты (@username), каналы, боты, связи в Telegram, участие в группах и чатах, публикации в Telegram-каналах. Данные с t.me, tgstat.ru, telemetr.me. Статистика каналов если есть.

*6.3 Маркетплейсы и сервисы* — профили и отзывы на Wildberries, Ozon, Avito. Объявления, история продаж/покупок. Профили в сервисах доставки если найдены. Конкретные отзывы — текст, дата, рейтинг.

*6.4 Упоминания в СМИ* — статьи, новости, обсуждения, публикации. Укажи источник [N], дату и подробное содержание каждого упоминания. Цитируй ключевые абзацы.

*6.5 Форумы и отзывы* — активность на форумах, сайтах отзывов (otzovik.com, irecommend.ru, flamp.ru), блогах, комментарии. Никнеймы и юзернеймы на форумах. Конкретные цитаты из постов/отзывов.

*━━━ БЛОК VII: ПРОФИЛЬ ЛИЧНОСТИ ━━━*

*7.1 Хобби и интересы* — хобби, спорт, клубы, секции, увлечения (из Strava, sports.ru, соцсетей). Где и как проводит свободное время. Членство в клубах/организациях. Конкретные примеры из источников.

*7.2 Путешествия и география* — города и страны посещения, чекины, фото из поездок, частота путешествий, любимые направления. Данные из Instagram, VK, TripAdvisor, Foursquare.

*7.3 Психологический портрет* — ПОДРОБНЫЙ анализ на основе всех собранных данных. Каждый вывод ОБЯЗАТЕЛЬНО подкрепляй конкретными примерами из источников [N]: цитаты из постов, описание фотографий, факты из отзывов. Без доказательств — не пиши.
  а) Черты характера: экстраверт/интроверт, конфликтность, лидерские качества, эмоциональность, рациональность.
  б) Ценности и мотивация: что важно для человека (карьера, семья, деньги, статус, свобода).
  в) Стиль общения: формальный/неформальный, агрессивный/мягкий, грамотность, использование мата, эмодзи, длина сообщений.
  г) Вредные привычки: курение, алкоголь, азартные игры — только по фактическим данным.
  д) Конфликты и репутация: скандалы, жалобы, негативные отзывы, судебные разбирательства.
  е) Финансовое поведение: уровень трат, отношение к деньгам — на основе фактических данных.
  ж) Социальная активность: уровень общительности, количество друзей/подписчиков, частота публикаций.

*7.4 Привычки и образ жизни* — распорядок дня (на основе времени публикаций), питание (заказы из утечек доставки, фото еды), режим сна (активность поздно ночью), регулярные места (чекины, фото), спортивные привычки (Strava, фитнес-клубы).

*━━━ БЛОК VIII: ВЫВОДЫ ━━━*

*8.1 Перекрёстный анализ* — факты, подтверждённые несколькими независимыми источниками. Противоречия между источниками. Паттерны поведения и связей. Неочевидные выводы из совокупности данных.

*8.2 Оценка достоверности* — для каждого блока (I-VII) укажи уровень уверенности: 🟢 высокий / 🟡 средний / 🔴 низкий. Найденные противоречия, рекомендации по дополнительной проверке.

Общие инструкции:
- Приоритизируй raw_content когда доступен — он содержит полный текст страницы. Извлекай из него ВСЕ релевантные данные.
- Для каждого утверждения указывай номер источника [N] — это критически важно для верификации.
- Построй хронологию по годам если достаточно данных.
- Перекрёстно проверяй факты между источниками.
- Будь максимально подробен в разделах с данными. Извлекай КАЖДЫЙ факт, дату, сумму, имя, адрес.
- Не придумывай информацию — только то, что подтверждено источниками.
- Не используй MarkdownV2 символы (не экранируй точки, скобки и т.п.).
- Помни: глубина важнее ширины. Лучше 5000 слов о том, что реально найдено, чем 1000 слов с пустыми разделами.`;

async function analyzeResults(
  subject: OsintParsedSubject,
  results: TavilyResult[],
  images: TavilyImage[],
  originalQuery: string,
  phase1Findings?: string
): Promise<string> {
  const topResults = results.slice(0, OSINT_TOP_SOURCES);

  // Three-tier content: Tier 1 (full), Tier 2 (medium), Tier 3 (snippet only)
  const RAW_CONTENT_FULL = 5000;
  const RAW_CONTENT_MEDIUM = 1500;

  const sourcesText = topResults
    .map((r, i) => {
      let content: string;
      if (i < OSINT_RAW_CONTENT_TOP && r.raw_content) {
        content = r.raw_content.slice(0, RAW_CONTENT_FULL);
      } else if (i < OSINT_RAW_CONTENT_MEDIUM_END && r.raw_content) {
        content = r.raw_content.slice(0, RAW_CONTENT_MEDIUM);
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
