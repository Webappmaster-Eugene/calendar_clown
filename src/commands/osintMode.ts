import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { setModeMenuCommands, getModeButtons } from "./expenseMode.js";
import { ensureUser, getUserByTelegramId } from "../expenses/repository.js";
import { isBootstrapAdmin, getUserMenuContext, canAccessMode } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DB_UNAVAILABLE_MSG, OSINT_DAILY_LIMIT } from "../constants.js";
import { runOsintSearch, sendReport } from "../osint/searchOrchestrator.js";
import { getSearchHistory, getSearchById, countTodaySearches } from "../osint/repository.js";
import { escapeMarkdown } from "../utils/markdown.js";
import { createLogger } from "../utils/logger.js";
import { TIMEZONE_MSK } from "../constants.js";

const log = createLogger("osint-mode");
const PAGE_SIZE = 5;

function getOsintKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["🔍 Новый поиск", "📋 История поисков"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

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

/** Handle text input in OSINT mode. */
export async function handleOsintText(ctx: Context): Promise<boolean> {
  if (!ctx.message || !("text" in ctx.message)) return false;
  const text = ctx.message.text;

  // Skip mode-specific buttons
  if (["🔍 Новый поиск", "📋 История поисков", "🏠 Главное меню"].includes(text)) {
    return false;
  }

  await executeOsintSearch(ctx, text, "text");
  return true;
}

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
      `🎤 Расшифровка: "${safeTranscript}"\n\n🔍 Запускаю OSINT-поиск...`
    );
  } catch {
    // ignore edit errors
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.telegram.editMessageText(chatId, statusMsgId, undefined, "Пользователь не найден.");
    return;
  }

  const result = await runOsintSearch(ctx, chatId, statusMsgId, dbUser.id, transcript, "voice");

  if (!result.success) {
    try {
      await ctx.telegram.editMessageText(chatId, statusMsgId, undefined, result.error || "Ошибка поиска.");
    } catch {
      await ctx.reply(result.error || "Ошибка поиска.");
    }
    return;
  }

  if (result.search?.report) {
    await sendReport(ctx, chatId, statusMsgId, result.search.report, result.search.sourcesCount);
  }
}

/** Handle "🔍 Новый поиск" button. */
export async function handleNewSearchButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

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

async function showHistory(ctx: Context, page: number): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const offset = page * PAGE_SIZE;
  const { searches, total } = await getSearchHistory(dbUser.id, PAGE_SIZE, offset);

  if (total === 0) {
    await ctx.reply("📋 История поисков пуста. Отправьте запрос для первого поиска.");
    return;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  let text = `📋 *История OSINT\\-поисков* (стр\\. ${page + 1}/${totalPages})\n\n`;

  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  for (let i = 0; i < searches.length; i++) {
    const s = searches[i];
    const statusEmoji = s.status === "completed" ? "✅" : s.status === "failed" ? "❌" : "⏳";
    const date = s.createdAt.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      timeZone: TIMEZONE_MSK,
    });
    const queryPreview = s.query.length > 35 ? s.query.slice(0, 35) + "…" : s.query;
    text += `${offset + i + 1}\\. ${statusEmoji} ${escapeMarkdown(queryPreview)} \\(${date}\\)\n`;
    buttons.push([
      Markup.button.callback(
        `${statusEmoji} ${queryPreview}`,
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
    await sendReport(ctx, chatId, statusMsg.message_id, result.search.report, result.search.sourcesCount);
  }
}
