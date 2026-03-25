import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { getUndoInfo, undoExpense } from "../services/expenseService.js";
import { formatMoney } from "../expenses/formatter.js";
import { TIMEZONE_MSK } from "../constants.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { isExpenseMode } from "../middleware/userMode.js";
import { DB_UNAVAILABLE_MSG } from "./expenseMode.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("undo");

/**
 * Handle undo button — show last expense and ask for confirmation.
 */
export async function handleUndoButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!await isExpenseMode(telegramId)) {
    await ctx.reply("Кнопка «Отменить» работает только в режиме расходов. Переключитесь: /expenses");
    return;
  }

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  const info = await getUndoInfo(telegramId);
  if (!info) {
    await ctx.reply("Нет записей для отмены (или запись старше 24 часов).");
    return;
  }

  const dateStr = info.createdAt.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE_MSK,
  });

  await ctx.reply(
    `↩️ *Отменить последнюю запись?*\n\n` +
    `${info.categoryEmoji} ${info.categoryName}${info.subcategory ? ` — ${info.subcategory}` : ""} — ${formatMoney(info.amount)}\n` +
    `📅 ${dateStr}`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        Markup.button.callback("✅ Да, отменить", `undo:confirm:${info.id}`),
        Markup.button.callback("❌ Нет", "undo:cancel"),
      ]),
    }
  );
}

/**
 * Handle undo confirmation/cancellation callbacks.
 */
export async function handleUndoCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  if (data === "undo:cancel") {
    try {
      await ctx.editMessageText("❌ Отмена отклонена.");
    } catch {
      // Message may already be edited
    }
    return;
  }

  const match = data.match(/^undo:confirm:(\d+)$/);
  if (!match) return;

  const expenseId = parseInt(match[1], 10);

  if (!isDatabaseAvailable()) {
    await ctx.editMessageText("⚠️ База данных недоступна.");
    return;
  }

  try {
    const deleted = await undoExpense(telegramId, expenseId);
    if (!deleted) {
      await ctx.editMessageText("Запись уже удалена или не найдена.");
      return;
    }

    log.info(`Expense ${expenseId} undone by user ${telegramId}`);
    await ctx.editMessageText("✅ Запись успешно отменена.");
  } catch (err) {
    log.error("Error undoing expense:", err);
    await ctx.editMessageText("❌ Не удалось отменить запись.");
  }
}
