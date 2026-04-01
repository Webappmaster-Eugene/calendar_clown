import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { setModeMenuCommands, getModeButtons } from "./expenseMode.js";
import { ensureUser, getUserByTelegramId } from "../expenses/repository.js";
import { isBootstrapAdmin, getUserMenuContext, canAccessMode } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DB_UNAVAILABLE_MSG, OSINT_DAILY_LIMIT } from "../constants.js";
import { runOsintSearch, sendReport } from "../osint/searchOrchestrator.js";
import { getSearchById, getFilteredSearchHistory, countTodaySearches } from "../osint/repository.js";
import { parseSearchSubject } from "../osint/queryParser.js";
import { escapeMarkdown, escapeMarkdownV2 } from "../utils/markdown.js";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";
import { truncateText } from "../utils/uiKit.js";
import { TIMEZONE_MSK } from "../constants.js";
import type { OsintParsedSubject } from "../osint/types.js";

const log = createLogger("osint-mode");
const PAGE_SIZE = 5;

// ─── Volatile state ─────────────────────────────────────────────────────

interface OsintPendingSearch {
  originalQuery: string;
  parsedSubject: OsintParsedSubject;
  messageId: number;
  inputMethod: "text" | "voice";
}

const pendingSearches = new Map<number, OsintPendingSearch>();

// ─── Search type labels ─────────────────────────────────────────────────

const SEARCH_TYPE_LABELS: Record<string, string> = {
  person: "Человек",
  company: "Компания",
  phone: "Телефон",
  email: "Email",
  general: "Общий",
};

// ─── Keyboard ───────────────────────────────────────────────────────────

function getOsintKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["🔍 Новый поиск", "📋 История поисков"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

// ─── Commands ───────────────────────────────────────────────────────────

/** Handle /osint command — enter OSINT mode. */
export async function handleOsintCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  const dbUser = await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  // Check tribe access
  const menuCtx = await getUserMenuContext(telegramId);
  if (menuCtx && !canAccessMode("osint", menuCtx)) {
    await ctx.reply("🔍 OSINT-поиск доступен только для участников трайба. Обратитесь к администратору.");
    return;
  }

  // Clear any pending state
  pendingSearches.delete(telegramId);

  await setUserMode(telegramId, "osint");
  await setModeMenuCommands(ctx, "osint");

  const todayCount = await countTodaySearches(dbUser.id);

  await ctx.reply(
    "🔍 *Режим OSINT\\-поиска активирован*\n\n" +
    "Отправьте текстом или голосом информацию о человеке для поиска\\.\n\n" +
    "Примеры:\n" +
    "• `Иванов Иван Петрович, Москва, Сбербанк`\n" +
    "• `+79161234567`\n" +
    "• `ivanov@mail.ru`\n" +
    "• `Петров Сергей, ООО Ромашка, Казань`\n\n" +
    `📊 Поисков сегодня: ${todayCount}/${OSINT_DAILY_LIMIT}`,
    { parse_mode: "MarkdownV2", ...getOsintKeyboard(isBootstrapAdmin(telegramId)) }
  );
}

// ─── Text input ─────────────────────────────────────────────────────────

/** Handle text input in OSINT mode. */
export async function handleOsintText(ctx: Context): Promise<boolean> {
  if (!ctx.message || !("text" in ctx.message)) return false;
  const text = ctx.message.text;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;

  // Skip mode-specific buttons
  if (["🔍 Новый поиск", "📋 История поисков", "🏠 Главное меню"].includes(text)) {
    return false;
  }

  // Check if there is a pending search — treat text as supplement
  const pending = pendingSearches.get(telegramId);
  if (pending) {
    const combinedQuery = `${pending.originalQuery}, ${text}`;
    await showParsingStatus(ctx);
    const parseResult = await parseSearchSubject(combinedQuery);

    if (!parseResult.subject) {
      await ctx.reply("Не удалось распознать данные. Попробуйте ещё раз.");
      return true;
    }

    // Update pending with new data
    pending.originalQuery = combinedQuery;
    pending.parsedSubject = parseResult.subject;

    // Send new confirmation card (delete old one is not reliable, send new)
    await showConfirmationCard(ctx, telegramId, parseResult.subject, combinedQuery, pending.inputMethod);
    return true;
  }

  // New search — parse and show confirmation
  await showParsingStatus(ctx);
  const parseResult = await parseSearchSubject(text);

  if (!parseResult.sufficient || !parseResult.subject) {
    await ctx.reply(
      "❓ Недостаточно данных для поиска. Укажите более конкретную информацию: ФИО с фамилией, город, компанию, телефон или email."
    );
    return true;
  }

  await showConfirmationCard(ctx, telegramId, parseResult.subject, text, "text");
  return true;
}

// ─── Voice input ────────────────────────────────────────────────────────

/** Handle voice input in OSINT mode. */
export async function handleOsintVoice(
  ctx: Context,
  transcript: string,
  statusMsgId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const chatId = ctx.chat!.id;
  const safeTranscript = escapeMarkdown(truncateText(transcript, 200));

  try {
    await ctx.telegram.editMessageText(
      chatId,
      statusMsgId,
      undefined,
      `🎤 Расшифровка: "${safeTranscript}"\n\n🔍 Анализирую запрос...`
    );
  } catch {
    // ignore edit errors
  }

  const parseResult = await parseSearchSubject(transcript);

  if (!parseResult.sufficient || !parseResult.subject) {
    try {
      await ctx.telegram.editMessageText(
        chatId,
        statusMsgId,
        undefined,
        `🎤 Расшифровка: "${safeTranscript}"\n\n❓ Недостаточно данных для поиска. Укажите более конкретную информацию.`
      );
    } catch {
      await ctx.reply("❓ Недостаточно данных для поиска. Укажите более конкретную информацию.");
    }
    return;
  }

  // Delete status message and show confirmation card
  try {
    await ctx.telegram.deleteMessage(chatId, statusMsgId);
  } catch {
    // ignore delete errors
  }

  await showConfirmationCard(ctx, telegramId, parseResult.subject, transcript, "voice");
}

// ─── Confirmation card ──────────────────────────────────────────────────

async function showParsingStatus(ctx: Context): Promise<void> {
  await ctx.reply("🔍 Анализирую запрос...");
}

async function showConfirmationCard(
  ctx: Context,
  telegramId: number,
  subject: OsintParsedSubject,
  originalQuery: string,
  inputMethod: "text" | "voice"
): Promise<void> {
  const name = subject.name || "—";
  const city = subject.city || "—";
  const company = subject.company || "—";
  const phone = subject.phone || "—";
  const email = subject.email || "—";
  const typeLabel = SEARCH_TYPE_LABELS[subject.searchType] || subject.searchType;

  const text =
    `🔍 *Распознанные данные для поиска:*\n\n` +
    `👤 ФИО: ${escapeMarkdownV2(name)}\n` +
    `🏙 Город: ${escapeMarkdownV2(city)}\n` +
    `🏢 Компания: ${escapeMarkdownV2(company)}\n` +
    `📱 Телефон: ${escapeMarkdownV2(phone)}\n` +
    `📧 Email: ${escapeMarkdownV2(email)}\n` +
    `🔖 Тип: ${escapeMarkdownV2(typeLabel)}\n\n` +
    `Если нужно дополнить — отправьте текстом\\.\n` +
    `Например: "телефон \\+79161234567" или "работает в Сбербанке"`;

  const buttons = Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Начать поиск", "osint_confirm"),
      Markup.button.callback("✏️ Ввести заново", "osint_reenter"),
    ],
    [
      Markup.button.callback("❌ Отмена", "osint_cancel"),
    ],
  ]);

  const msg = await ctx.reply(text, {
    parse_mode: "MarkdownV2",
    ...buttons,
  });

  pendingSearches.set(telegramId, {
    originalQuery,
    parsedSubject: subject,
    messageId: msg.message_id,
    inputMethod,
  });
}

// ─── Confirmation callbacks ─────────────────────────────────────────────

/** Handle "✅ Начать поиск" callback. */
export async function handleOsintConfirmCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  await ctx.answerCbQuery("Запускаю поиск...");

  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const pending = pendingSearches.get(telegramId);
  if (!pending) {
    await ctx.reply("Нет активного запроса. Отправьте новый текст для поиска.");
    return;
  }

  pendingSearches.delete(telegramId);

  const dbUser = await getUserByTelegramId(telegramId);
  logAction(dbUser?.id ?? null, telegramId, "osint_search_confirm", {
    query: pending.originalQuery,
    searchType: pending.parsedSubject.searchType,
  });

  // Edit the confirmation card to show search started
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch {
    // ignore
  }

  await executeOsintSearch(ctx, pending.originalQuery, pending.inputMethod);
}

/** Handle "✏️ Ввести заново" callback. */
export async function handleOsintReenterCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  await ctx.answerCbQuery();

  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  pendingSearches.delete(telegramId);

  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch {
    // ignore
  }

  await ctx.reply("📝 Отправьте новый запрос для OSINT-поиска.");
}

/** Handle "❌ Отмена" callback. */
export async function handleOsintCancelCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  await ctx.answerCbQuery("Поиск отменён");

  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  pendingSearches.delete(telegramId);

  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch {
    // ignore
  }

  await ctx.reply("❌ Поиск отменён.");
}

// ─── Mode buttons ───────────────────────────────────────────────────────

/** Handle "🔍 Новый поиск" button. */
export async function handleNewSearchButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  // Clear any pending state
  pendingSearches.delete(telegramId);

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const todayCount = await countTodaySearches(dbUser.id);
  await ctx.reply(
    `🔍 Отправьте запрос для OSINT-поиска (текстом или голосом).\n\n📊 Поисков сегодня: ${todayCount}/${OSINT_DAILY_LIMIT}`
  );
}

/** Handle "📋 История поисков" button. */
export async function handleHistoryButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id ?? 0;
  const dbUser = await getUserByTelegramId(telegramId);
  logAction(dbUser?.id ?? null, telegramId, "osint_history_view");
  await showHistory(ctx, 0);
}

// ─── History callbacks ──────────────────────────────────────────────────

/** Handle history pagination callback. */
export async function handleHistoryPageCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const page = parseInt(ctx.callbackQuery.data.replace("osint_hist:", ""), 10);
  if (isNaN(page)) return;
  await ctx.answerCbQuery();
  await showHistory(ctx, page);
}

/** Handle view single search callback. */
export async function handleViewSearchCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const searchId = parseInt(ctx.callbackQuery.data.replace("osint_view:", ""), 10);
  if (isNaN(searchId)) return;
  await ctx.answerCbQuery();

  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const search = await getSearchById(searchId, dbUser.id);
  if (!search) {
    await ctx.reply("Поиск не найден.");
    return;
  }

  if (search.status !== "completed" || !search.report) {
    const statusText = search.status === "failed"
      ? `❌ Поиск завершился ошибкой: ${search.errorMessage || "неизвестная ошибка"}`
      : `⏳ Поиск в процессе (${search.status})`;
    await ctx.reply(`🔍 Запрос: "${escapeMarkdown(search.query)}"\n\n${statusText}`, {
      parse_mode: "Markdown",
    });
    return;
  }

  // Send full report
  const { splitMessage } = await import("../utils/telegram.js");
  const formatted = `🔍 *Запрос:* "${escapeMarkdown(search.query)}"\n\n${search.report}\n\n📊 Источников: ${search.sourcesCount}`;
  const chunks = splitMessage(formatted);

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(chunk.replace(/[*_`\[\]\\]/g, ""));
    }
  }
}

// ─── History display ────────────────────────────────────────────────────

const STATUS_DISPLAY: Record<string, string> = {
  completed: "✅ Готов",
  failed: "❌ Ошибка",
  pending: "⏳ Ожидание",
  searching: "🔍 Поиск",
  analyzing: "🧠 Анализ",
};

async function showHistory(ctx: Context, page: number): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const offset = page * PAGE_SIZE;
  const { searches, total } = await getFilteredSearchHistory(
    dbUser.id,
    PAGE_SIZE,
    offset
  );

  if (total === 0) {
    await ctx.reply("📋 История поисков пуста. Отправьте запрос для первого поиска.");
    return;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  let text = `📋 *История OSINT\\-поисков* \\(стр\\. ${page + 1}/${totalPages}\\)\n\n`;

  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  // Search items
  for (let i = 0; i < searches.length; i++) {
    const s = searches[i];
    const statusLabel = STATUS_DISPLAY[s.status] ?? s.status;
    const statusEmoji = s.status === "completed" ? "✅" : s.status === "failed" ? "❌" : "⏳";
    const date = s.createdAt.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      timeZone: TIMEZONE_MSK,
    });

    // Use parsed name if available, otherwise query preview
    const displayName = s.parsedSubject?.name && s.parsedSubject.name.length > 0
      ? s.parsedSubject.name
      : s.query;
    const namePreview = truncateText(displayName, 30);

    // Show sources count for completed
    const sourcesInfo = s.status === "completed" && s.sourcesCount > 0
      ? ` \\(${s.sourcesCount} ист\\.\\)`
      : "";

    text += `${offset + i + 1}\\. ${escapeMarkdownV2(statusLabel)} — ${escapeMarkdownV2(namePreview)}${sourcesInfo} — ${date}\n`;

    const buttonLabel = s.status === "completed" && s.sourcesCount > 0
      ? `${statusEmoji} ${namePreview} (${s.sourcesCount} ист.)`
      : `${statusEmoji} ${namePreview}`;

    buttons.push([
      Markup.button.callback(
        truncateText(buttonLabel, 60),
        `osint_view:${s.id}`
      ),
    ]);
  }

  // Pagination
  const navRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (page > 0) {
    navRow.push(Markup.button.callback("⬅️ Назад", `osint_hist:${page - 1}`));
  }
  if (page < totalPages - 1) {
    navRow.push(Markup.button.callback("Вперёд ➡️", `osint_hist:${page + 1}`));
  }
  if (navRow.length > 0) buttons.push(navRow);

  try {
    await ctx.reply(text, {
      parse_mode: "MarkdownV2",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch {
    // Fallback: plain text
    await ctx.reply(text.replace(/\\/g, ""), {
      ...Markup.inlineKeyboard(buttons),
    });
  }
}

// ─── Execute search ─────────────────────────────────────────────────────

async function executeOsintSearch(
  ctx: Context,
  queryText: string,
  inputMethod: "text" | "voice"
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const chatId = ctx.chat!.id;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  logAction(dbUser.id, telegramId, "osint_search_start", { query: queryText, inputMethod });

  const statusMsg = await ctx.reply("🔍 Запускаю OSINT-поиск...");

  const onProgress = async (text: string): Promise<void> => {
    try {
      await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, text);
    } catch {
      // Ignore edit errors (message not modified, etc.)
    }
  };

  const result = await runOsintSearch(dbUser.id, queryText, inputMethod, { onProgress });

  if (!result.success) {
    try {
      await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, result.error || "Ошибка поиска.");
    } catch {
      await ctx.reply(result.error || "Ошибка поиска.");
    }
    return;
  }

  if (result.search?.report) {
    await sendReport(ctx, chatId, statusMsg.message_id, result.search.report, result.search.sourcesCount, result.extractedCount);
  }
}
