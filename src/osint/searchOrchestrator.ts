import type { Context } from "telegraf";
import { OSINT_DAILY_LIMIT, OSINT_ANALYSIS_MODEL, DEEPSEEK_MODEL } from "../constants.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import { createLogger } from "../utils/logger.js";
import { parseSearchSubject, generateSearchQueries } from "./queryParser.js";
import { tavilySearchMulti } from "./searchClient.js";
import { createSearch, updateSearchStatus, countTodaySearches } from "./repository.js";
import { formatReport } from "./reportFormatter.js";
import { splitMessage } from "../utils/telegram.js";
import type { OsintParsedSubject, OsintSearch, TavilyResult, TavilyImage } from "./types.js";

const log = createLogger("osint-orchestrator");

export interface OrchestratorResult {
  success: boolean;
  error?: string;
  search?: OsintSearch;
}

/**
 * Run the full OSINT search pipeline with progress updates.
 * Returns the search record on success.
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

    // 5. Execute searches
    await editStatus(ctx, chatId, statusMsgId, `🔍 Поиск: веб + госреестры + соцсети (${queries.length} запросов)...`);

    if (!process.env.TAVILY_API_KEY) {
      await updateSearchStatus(search.id, "failed", {
        errorMessage: "TAVILY_API_KEY не настроен",
      });
      return {
        success: false,
        error: "⚠️ OSINT-поиск не настроен. Обратитесь к администратору (TAVILY_API_KEY).",
      };
    }

    const searchResult = await tavilySearchMulti(queries, 5);
    let rawResults = searchResult.results;
    const images = searchResult.images;

    if (rawResults.length === 0) {
      // Try with simpler queries
      const simpleQuery = parseResult.subject.name || queryText;
      const fallbackResult = await tavilySearchMulti([simpleQuery], 10);
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
      rawResults = fallbackResult.results;
      images.push(...fallbackResult.images);
    }

    await updateSearchStatus(search.id, "analyzing", {
      rawResults,
      sourcesCount: rawResults.length,
    });

    // 6. Analyze with AI
    await editStatus(ctx, chatId, statusMsgId, `🧠 Анализирую ${rawResults.length} источников...`);
    const report = await analyzeResults(parseResult.subject, rawResults, images, queryText);

    // 7. Save completed
    await updateSearchStatus(search.id, "completed", {
      report,
      sourcesCount: rawResults.length,
    });

    return {
      success: true,
      search: { ...search, status: "completed", report, sourcesCount: rawResults.length },
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
  sourcesCount: number
): Promise<void> {
  const formatted = formatReport(report, sourcesCount);
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

const ANALYSIS_PROMPT = `Ты — профессиональный OSINT-аналитик с опытом работы в конкурентной разведке. Проанализируй найденные данные и составь максимально подробный структурированный отчёт.

Отчёт должен быть на русском языке, в формате Markdown (Telegram V1: *bold*, _italic_, \`code\`).
Используй следующие разделы (пропускай только если данных совсем нет):

*Краткое резюме* — 2-3 предложения с ключевыми выводами о найденной информации.

*Идентификация* — ФИО (полное), предполагаемый возраст/год рождения, город проживания, ИНН/ОГРН если найдены.

*Государственные реестры* — данные из ЕГРЮЛ/ЕГРИП (компании, ИП), ФССП (исполнительные производства), судебные решения (sudact.ru), банкротство (fedresurs). Если ничего не найдено — укажи это явно.

*Онлайн-присутствие* — профили в соцсетях (VK, OK, Instagram, Facebook, LinkedIn) со ссылками. Форумы, блоги, комментарии. Если найдены фотографии — перечисли их URL.

*Профессиональная деятельность* — должности, компании, роли (учредитель, директор, сотрудник). Карьерный путь если прослеживается.

*Контактная информация* — телефоны, email, адреса (только публично доступные данные).

*Упоминания в СМИ* — статьи, новости, обсуждения, публикации. Укажи источник и краткое содержание.

*Характеристика личности* — стиль общения (на основе постов/комментариев), интересы, хобби, активность в сети. Только на основе фактических данных.

*Семья и окружение* — члены семьи из публичных источников (соцсети, реестры), деловые партнёры, связанные лица.

*Связи и сеть контактов* — организационные связи, перекрёстные упоминания, совместные проекты/компании.

*Оценка достоверности* — уровень уверенности в собранных данных (высокий/средний/низкий), найденные противоречия, пробелы в информации, рекомендации по дополнительной проверке.

Если найдены URL фотографий — выдели их отдельным списком в разделе "Онлайн-присутствие" с пометкой 📷.

Будь максимально подробен. Извлекай всю возможную информацию из источников.
Не придумывай информацию — только то, что подтверждено источниками.
Если информации мало — так и напиши, но укажи что именно не удалось найти.
Не используй MarkdownV2 символы (не экранируй точки, скобки и т.п.).`;

async function analyzeResults(
  subject: OsintParsedSubject,
  results: TavilyResult[],
  images: TavilyImage[],
  originalQuery: string
): Promise<string> {
  const sourcesText = results
    .slice(0, 40)
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
    .join("\n\n---\n\n");

  const imagesText = images.length > 0
    ? `\n\nНайденные изображения:\n${images.map((img, i) => `[Фото ${i + 1}] ${img.url}${img.description ? ` — ${img.description}` : ""}`).join("\n")}`
    : "";

  const userMessage = `Запрос пользователя: "${originalQuery}"
Данные об объекте: ${JSON.stringify(subject)}

Найденные источники:
${sourcesText}${imagesText}`;

  const report = await callOpenRouter({
    model: OSINT_ANALYSIS_MODEL,
    messages: [
      { role: "system", content: ANALYSIS_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.3,
    max_tokens: 8000,
  });

  return report || "Не удалось сформировать отчёт.";
}
