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
import { TIMEZONE_MSK } from "../constants.js";
import type { OsintParsedSubject, OsintStatus } from "../osint/types.js";

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
const historySearchStates = new Map<number, boolean>();

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
  historySearchStates.delete(telegramId);

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

  // Check if user is in history search mode
  if (historySearchStates.get(telegramId)) {
    historySearchStates.delete(telegramId);
    await showHistory(ctx, 0, { searchText: text });
    return true;
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
  const safeTranscript = escapeMarkdown(
    transcript.length > 200 ? transcript.slice(0, 200) + "…" : transcript
  );

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
  historySearchStates.delete(telegramId);

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const todayCount = await countTodaySearches(dbUser.id);
  await ctx.reply(
    `🔍 Отправьте запрос для OSINT-поиска (текстом или голосом).\n\n📊 Поисков сегодня: ${todayCount}/${OSINT_DAILY_LIMIT}`
  );
}

/** Handle "📋 История поисков" button. */
export async function handleHistoryButton(ctx: Context): Promise<void> {
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

/** Handle history filter callback: osint_hist_filter:{status}:{page} */
export async function handleHistoryFilterCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const parts = ctx.callbackQuery.data.replace("osint_hist_filter:", "").split(":");
  if (parts.length < 2) return;
  await ctx.answerCbQuery();

  const statusFilter = parts[0] === "all" ? undefined : parts[0] as OsintStatus;
  const page = parseInt(parts[1], 10) || 0;

  await showHistory(ctx, page, { status: statusFilter });
}

/** Handle history search button callback. */
export async function handleHistorySearchCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  await ctx.answerCbQuery();

  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  historySearchStates.set(telegramId, true);
  await ctx.reply("🔎 Отправьте текст для поиска по истории:");
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

interface HistoryFilter {
  status?: OsintStatus;
  searchText?: string;
}

async function showHistory(
  ctx: Context,
  page: number,
  filter?: HistoryFilter
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const offset = page * PAGE_SIZE;
  const { searches, total } = await getFilteredSearchHistory(
    dbUser.id,
    PAGE_SIZE,
    offset,
    filter
  );

  if (total === 0) {
    const emptyText = filter
      ? "📋 Ничего не найдено по заданному фильтру."
      : "📋 История поисков пуста. Отправьте запрос для первого поиска.";
    await ctx.reply(emptyText);
    return;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const filterSuffix = filter?.status
    ? ` \\| ${escapeMarkdownV2(getStatusFilterLabel(filter.status))}`
    : filter?.searchText
      ? ` \\| 🔎 "${escapeMarkdownV2(filter.searchText)}"`
      : "";

  let text = `📋 *История OSINT\\-поисков* \\(стр\\. ${page + 1}/${totalPages}${filterSuffix}\\)\n\n`;

  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  // Filter row
  const currentStatus = filter?.status || "all";
  const filterRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  const filterOptions: Array<{ label: string; value: string }> = [
    { label: "Все", value: "all" },
    { label: "✅", value: "completed" },
    { label: "❌", value: "failed" },
    { label: "⏳", value: "pending" },
  ];
  for (const opt of filterOptions) {
    const isActive = currentStatus === opt.value;
    filterRow.push(
      Markup.button.callback(
        isActive ? `[${opt.label}]` : opt.label,
        `osint_hist_filter:${opt.value}:0`
      )
    );
  }
  filterRow.push(Markup.button.callback("🔎", "osint_hist_search"));
  buttons.push(filterRow);

  // Search items
  for (let i = 0; i < searches.length; i++) {
    const s = searches[i];
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
    const namePreview = displayName.length > 30 ? displayName.slice(0, 30) + "…" : displayName;

    // Show sources count for completed
    const sourcesInfo = s.status === "completed" && s.sourcesCount > 0
      ? ` \\(${s.sourcesCount} ист\\.\\)`
      : "";

    text += `${offset + i + 1}\\. ${statusEmoji} ${escapeMarkdownV2(namePreview)}${sourcesInfo} — ${date}\n`;

    const buttonLabel = s.status === "completed" && s.sourcesCount > 0
      ? `${statusEmoji} ${namePreview} (${s.sourcesCount} ист.)`
      : `${statusEmoji} ${namePreview}`;

    buttons.push([
      Markup.button.callback(
        buttonLabel.length > 60 ? buttonLabel.slice(0, 57) + "…" : buttonLabel,
        `osint_view:${s.id}`
      ),
    ]);
  }

  // Pagination — preserve filter
  const filterParam = filter?.status || "all";
  const navRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (page > 0) {
    navRow.push(Markup.button.callback("⬅️ Назад", `osint_hist_filter:${filterParam}:${page - 1}`));
  }
  if (page < totalPages - 1) {
    navRow.push(Markup.button.callback("Вперёд ➡️", `osint_hist_filter:${filterParam}:${page + 1}`));
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

function getStatusFilterLabel(status: OsintStatus): string {
  switch (status) {
    case "completed": return "Успешные";
    case "failed": return "Ошибки";
    case "pending": return "В ожидании";
    case "searching": return "В процессе";
    case "analyzing": return "Анализ";
    default: return status;
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

  const statusMsg = await ctx.reply("🔍 Запускаю OSINT-поиск...");

  const result = await runOsintSearch(ctx, chatId, statusMsg.message_id, dbUser.id, queryText, inputMethod);

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
