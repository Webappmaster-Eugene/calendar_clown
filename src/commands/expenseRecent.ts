import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { getRecentExpenses, undoExpense } from "../services/expenseService.js";
import { formatMoney } from "../expenses/formatter.js";
import { TIMEZONE_MSK } from "../constants.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DB_UNAVAILABLE_MSG } from "./expenseMode.js";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";
import { escapeMarkdown } from "../utils/markdown.js";

const log = createLogger("expense-recent");

/**
 * Build the recent expenses message text + inline keyboard.
 * Returns null if user not found / no tribe.
 */
async function buildRecentMessage(telegramId: number): Promise<{
  text: string;
  keyboard: ReturnType<typeof Markup.inlineKeyboard>;
} | null> {
  let expenses;
  try {
    expenses = await getRecentExpenses(telegramId, 15);
  } catch {
    return null;
  }

  if (expenses.length === 0) {
    return {
      text: "🕐 *Последние записи*\n\nЗаписей пока нет.",
      keyboard: Markup.inlineKeyboard([]),
    };
  }

  const lines = expenses.map((e, i) => {
    const date = new Date(e.createdAt).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TIMEZONE_MSK,
    });
    const sub = e.subcategory ? ` — ${escapeMarkdown(e.subcategory)}` : "";
    return `${i + 1}. ${e.categoryEmoji} ${formatMoney(e.amount)}${sub}\n   👤 ${escapeMarkdown(e.firstName)} | ${date}`;
  });

  const text = `🕐 *Последние ${expenses.length} записей*\n\n${lines.join("\n\n")}`;

  // Delete buttons — only for expenses owned by current user
  const deleteButtons = expenses
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => e.isOwn)
    .map(({ e, idx }) =>
      Markup.button.callback(`🗑 #${idx + 1}`, `rdel:${e.id}`)
    );

  // Arrange delete buttons in rows of 4
  const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
  for (let i = 0; i < deleteButtons.length; i += 4) {
    rows.push(deleteButtons.slice(i, i + 4));
  }
  rows.push([Markup.button.callback("🔄 Обновить", "recent:refresh")]);

  return { text, keyboard: Markup.inlineKeyboard(rows) };
}

/**
 * Handle "🕐 Последние" keyboard button — show last 15 expenses.
 */
export async function handleRecentButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  logAction(null, telegramId, "expense_recent", {});

  try {
    const result = await buildRecentMessage(telegramId);
    if (!result) {
      await ctx.reply("Пользователь не найден или нет трайба. Отправьте /expenses.");
      return;
    }

    await ctx.reply(result.text, {
      parse_mode: "Markdown",
      ...result.keyboard,
    });
  } catch (err) {
    log.error("Error showing recent expenses:", err);
    await ctx.reply("❌ Не удалось загрузить последние записи.");
  }
}

/**
 * Handle recent expense callbacks: rdel:<id>, rdel_y:<id>, recent:refresh.
 */
export async function handleRecentCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.answerCbQuery("⚠️ База данных недоступна.");
    return;
  }

  // Refresh list
  if (data === "recent:refresh") {
    await ctx.answerCbQuery();
    try {
      const result = await buildRecentMessage(telegramId);
      if (!result) return;
      await ctx.editMessageText(result.text, {
        parse_mode: "Markdown",
        ...result.keyboard,
      });
    } catch {
      // Message may be unchanged
    }
    return;
  }

  // Delete confirmation: rdel:<expenseId>
  const delMatch = data.match(/^rdel:(\d+)$/);
  if (delMatch) {
    const expenseId = parseInt(delMatch[1], 10);
    if (isNaN(expenseId)) return;

    await ctx.answerCbQuery("Подтвердите удаление");
    try {
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [
          [
            { text: "✅ Удалить", callback_data: `rdel_y:${expenseId}` },
            { text: "❌ Отмена", callback_data: "recent:refresh" },
          ],
        ],
      });
    } catch {
      // Message may be already edited
    }
    return;
  }

  // Confirmed delete: rdel_y:<expenseId>
  const delConfirmMatch = data.match(/^rdel_y:(\d+)$/);
  if (delConfirmMatch) {
    const expenseId = parseInt(delConfirmMatch[1], 10);
    if (isNaN(expenseId)) return;

    try {
      const deleted = await undoExpense(telegramId, expenseId);
      if (!deleted) {
        await ctx.answerCbQuery("Запись уже удалена или не ваша.");
      } else {
        await ctx.answerCbQuery("✅ Удалено");
        log.info(`Expense ${expenseId} deleted from recent by user ${telegramId}`);
        logAction(null, telegramId, "expense_delete_recent", { expenseId });
      }

      // Refresh list after delete (or failed delete)
      const result = await buildRecentMessage(telegramId);
      if (result) {
        await ctx.editMessageText(result.text, {
          parse_mode: "Markdown",
          ...result.keyboard,
        });
      }
    } catch (err) {
      log.error("Error deleting expense from recent:", err);
      await ctx.answerCbQuery("❌ Ошибка при удалении.");
    }
    return;
  }
}
