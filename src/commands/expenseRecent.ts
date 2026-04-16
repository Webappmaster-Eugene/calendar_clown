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

const RECENT_PAGE_SIZE = 10;

/**
 * Build the recent expenses message text + inline keyboard for a given page.
 * Returns null if user not found / no tribe.
 */
async function buildRecentMessage(telegramId: number, page: number = 1): Promise<{
  text: string;
  keyboard: ReturnType<typeof Markup.inlineKeyboard>;
} | null> {
  let result;
  try {
    result = await getRecentExpenses(telegramId, RECENT_PAGE_SIZE, page);
  } catch {
    return null;
  }

  const { items: expenses, total } = result;
  const totalPages = Math.max(1, Math.ceil(total / RECENT_PAGE_SIZE));

  if (expenses.length === 0 && page === 1) {
    return {
      text: "🕐 *Последние записи*\n\nЗаписей пока нет.",
      keyboard: Markup.inlineKeyboard([]),
    };
  }

  // Page beyond data after deletion — fall back to page 1
  if (expenses.length === 0 && page > 1) {
    return buildRecentMessage(telegramId, 1);
  }

  const startIdx = (page - 1) * RECENT_PAGE_SIZE;
  const lines = expenses.map((e, i) => {
    const date = new Date(e.createdAt).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TIMEZONE_MSK,
    });
    const sub = e.subcategory ? ` — ${escapeMarkdown(e.subcategory)}` : "";
    return `${startIdx + i + 1}. ${e.categoryEmoji} ${formatMoney(e.amount)}${sub}\n   👤 ${escapeMarkdown(e.firstName)} | ${date}`;
  });

  const text = `🕐 *Последние записи* (${page}/${totalPages}, всего: ${total})\n\n${lines.join("\n\n")}`;

  // Delete buttons — only for expenses owned by current user
  const deleteButtons = expenses
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => e.isOwn)
    .map(({ e, idx }) =>
      Markup.button.callback(`🗑 #${startIdx + idx + 1}`, `rdel:${e.id}:${page}`)
    );

  // Arrange delete buttons in rows of 4
  const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
  for (let i = 0; i < deleteButtons.length; i += 4) {
    rows.push(deleteButtons.slice(i, i + 4));
  }

  // Navigation row
  const navRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (page > 1) {
    navRow.push(Markup.button.callback("⬅️ Назад", `rcnt:${page - 1}`));
  }
  navRow.push(Markup.button.callback("🔄", `rcnt:${page}`));
  if (page < totalPages) {
    navRow.push(Markup.button.callback("Вперёд ➡️", `rcnt:${page + 1}`));
  }
  rows.push(navRow);

  return { text, keyboard: Markup.inlineKeyboard(rows) };
}

/**
 * Handle "🕐 Последние" keyboard button — show recent expenses (page 1).
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
 * Handle recent expense callbacks:
 * - rcnt:<page> — navigate to page
 * - rdel:<id>:<page> — request delete confirmation
 * - rdel_y:<id>:<page> — confirm delete
 * - recent:refresh — legacy refresh (page 1)
 * - rdel:<id> / rdel_y:<id> — legacy (no page, defaults to 1)
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

  // Page navigation: rcnt:<page>
  const pageMatch = data.match(/^rcnt:(\d+)$/);
  if (pageMatch) {
    const page = parseInt(pageMatch[1], 10);
    await ctx.answerCbQuery();
    try {
      const result = await buildRecentMessage(telegramId, page);
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

  // Legacy refresh (backward compat with old inline keyboards in chat)
  if (data === "recent:refresh") {
    await ctx.answerCbQuery();
    try {
      const result = await buildRecentMessage(telegramId, 1);
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

  // Delete confirmation: rdel:<expenseId>:<page> or rdel:<expenseId> (legacy)
  const delMatch = data.match(/^rdel:(\d+)(?::(\d+))?$/);
  if (delMatch) {
    const expenseId = parseInt(delMatch[1], 10);
    const page = delMatch[2] ? parseInt(delMatch[2], 10) : 1;
    if (isNaN(expenseId)) return;

    await ctx.answerCbQuery("Подтвердите удаление");
    try {
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [
          [
            { text: "✅ Удалить", callback_data: `rdel_y:${expenseId}:${page}` },
            { text: "❌ Отмена", callback_data: `rcnt:${page}` },
          ],
        ],
      });
    } catch {
      // Message may be already edited
    }
    return;
  }

  // Confirmed delete: rdel_y:<expenseId>:<page> or rdel_y:<expenseId> (legacy)
  const delConfirmMatch = data.match(/^rdel_y:(\d+)(?::(\d+))?$/);
  if (delConfirmMatch) {
    const expenseId = parseInt(delConfirmMatch[1], 10);
    const page = delConfirmMatch[2] ? parseInt(delConfirmMatch[2], 10) : 1;
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

      // Refresh list at same page
      const result = await buildRecentMessage(telegramId, page);
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
