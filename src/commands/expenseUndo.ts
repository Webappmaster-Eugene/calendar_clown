import type { Context } from "telegraf";
import { undoExpense } from "../services/expenseService.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";

const log = createLogger("undo");

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
    logAction(null, telegramId, "expense_undo", { expenseId });
    await ctx.editMessageText("✅ Запись успешно отменена.");
  } catch (err) {
    log.error("Error undoing expense:", err);
    await ctx.editMessageText("❌ Не удалось отменить запись.");
  }
}
