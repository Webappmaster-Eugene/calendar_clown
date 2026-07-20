/**
 * Because the category is guessed by AI from a short merchant name, every imported
 * expense is confirmed to the user with inline buttons to fix the category or delete it.
 */
import { Markup, type Telegraf, type Context } from "telegraf";
import { formatMoney } from "../formatter.js";
import { escapeMarkdown } from "../../utils/markdown.js";
import { getCategories } from "../repository.js";
import { editExpense, undoExpense } from "../../services/expenseService.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("bank-push-confirm");

let botRef: Telegraf | null = null;

export function setBankPushBotRef(bot: Telegraf): void {
  botRef = bot;
}

export interface BankPushConfirmationInfo {
  telegramId: number;
  expenseId: number;
  categoryEmoji: string;
  categoryName: string;
  merchant: string | null;
  amount: number;
}

function buildConfirmationText(info: BankPushConfirmationInfo): string {
  const merchantLine = info.merchant ? ` — ${escapeMarkdown(info.merchant)}` : "";
  return (
    `💸 *${formatMoney(info.amount)}*${merchantLine}\n` +
    `Категория: ${info.categoryEmoji} ${escapeMarkdown(info.categoryName)}\n` +
    `_из уведомления Т-Банка_`
  );
}

function confirmationKeyboard(expenseId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✏️ Категория", `bpcat:${expenseId}`)],
    [Markup.button.callback("❌ Удалить", `bpdel:${expenseId}`)],
  ]);
}

/** Never throws — failures are logged so a messaging hiccup can't fail the webhook (expense already recorded). */
export async function sendBankPushConfirmation(info: BankPushConfirmationInfo): Promise<void> {
  if (!botRef) {
    log.warn("Bank-push bot ref not set; skipping confirmation for user %d", info.telegramId);
    return;
  }
  try {
    await botRef.telegram.sendMessage(info.telegramId, buildConfirmationText(info), {
      parse_mode: "Markdown",
      ...confirmationKeyboard(info.expenseId),
    });
  } catch (err) {
    log.error("Failed to send bank-push confirmation:", err);
  }
}

// ─── Callback handlers (registered in bot.ts) ────────────────────────────────

function parseId(data: string, prefix: string): number | null {
  if (!data.startsWith(prefix)) return null;
  const n = parseInt(data.slice(prefix.length), 10);
  return Number.isFinite(n) ? n : null;
}

/** "bpcat:<id>" — show the category picker in place of the confirmation keyboard. */
export async function handleBankPushCategoryMenu(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : "";
  const expenseId = parseId(data, "bpcat:");
  if (expenseId == null) {
    await ctx.answerCbQuery();
    return;
  }

  const categories = await getCategories();
  const rows = [];
  for (let i = 0; i < categories.length; i += 2) {
    rows.push(
      categories.slice(i, i + 2).map((c) =>
        Markup.button.callback(`${c.emoji} ${c.name}`, `bpset:${expenseId}:${c.id}`)
      )
    );
  }
  rows.push([Markup.button.callback("« Отмена", `bpcancel:${expenseId}`)]);

  try {
    await ctx.editMessageReplyMarkup(Markup.inlineKeyboard(rows).reply_markup);
  } catch (err) {
    log.error("Failed to open category menu:", err);
  }
  await ctx.answerCbQuery();
}

/** "bpset:<id>:<catId>" — reassign the category and refresh the message. */
export async function handleBankPushSetCategory(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  const data = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : "";
  const match = data.match(/^bpset:(\d+):(\d+)$/);
  if (telegramId == null || !match) {
    await ctx.answerCbQuery();
    return;
  }
  const expenseId = parseInt(match[1], 10);
  const categoryId = parseInt(match[2], 10);

  try {
    const updated = await editExpense(telegramId, expenseId, { categoryId });
    if (!updated) {
      await ctx.answerCbQuery("Не удалось изменить категорию");
      return;
    }
    await ctx.editMessageText(
      buildConfirmationText({
        telegramId,
        expenseId,
        categoryEmoji: updated.categoryEmoji,
        categoryName: updated.categoryName,
        merchant: updated.subcategory,
        amount: updated.amount,
      }),
      { parse_mode: "Markdown", ...confirmationKeyboard(expenseId) }
    );
    await ctx.answerCbQuery("Категория обновлена");
  } catch (err) {
    log.error("Failed to set category:", err);
    await ctx.answerCbQuery("Ошибка");
  }
}

/** "bpcancel:<id>" — collapse the category picker back to the confirmation keyboard. */
export async function handleBankPushCancel(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : "";
  const expenseId = parseId(data, "bpcancel:");
  if (expenseId == null) {
    await ctx.answerCbQuery();
    return;
  }
  try {
    await ctx.editMessageReplyMarkup(confirmationKeyboard(expenseId).reply_markup);
  } catch {
    // message may be too old to edit — ignore
  }
  await ctx.answerCbQuery();
}

/** "bpdel:<id>" — delete the imported expense. */
export async function handleBankPushDelete(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  const data = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : "";
  const expenseId = parseId(data, "bpdel:");
  if (telegramId == null || expenseId == null) {
    await ctx.answerCbQuery();
    return;
  }
  try {
    const deleted = await undoExpense(telegramId, expenseId);
    if (deleted) {
      await ctx.editMessageText("🗑️ Трата удалена");
      await ctx.answerCbQuery("Удалено");
    } else {
      await ctx.answerCbQuery("Уже удалено");
    }
  } catch (err) {
    log.error("Failed to delete expense:", err);
    await ctx.answerCbQuery("Ошибка");
  }
}
