import type { Context } from "telegraf";
import { getLastExpense, deleteExpense, getUserByTelegramId } from "../expenses/repository.js";
import { formatMoney } from "../expenses/formatter.js";
import { TIMEZONE_MSK } from "../constants.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { isExpenseMode } from "../middleware/expenseMode.js";
import { DB_UNAVAILABLE_MSG } from "./expenseMode.js";

/**
 * Handle undo button — delete the last expense of the current user.
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

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /expenses.");
    return;
  }

  const last = await getLastExpense(dbUser.id);
  if (!last) {
    await ctx.reply("Нет записей для отмены.");
    return;
  }

  const deleted = await deleteExpense(last.id, dbUser.id);
  if (!deleted) {
    await ctx.reply("Не удалось отменить запись.");
    return;
  }

  const dateStr = last.createdAt.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE_MSK,
  });

  await ctx.replyWithMarkdown(
    `↩️ *Отменено:*\n` +
    `${last.categoryEmoji} ${last.categoryName}${last.subcategory ? ` — ${last.subcategory}` : ""} — ${formatMoney(last.amount)}\n` +
    `📅 ${dateStr}`
  );
}
