import type { Context } from "telegraf";
import { addExpenseFromText, addMultipleExpenses, addExpenseFromVoice } from "../services/expenseService.js";
import { formatMoney, monthName } from "../expenses/formatter.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { checkRateLimit } from "../middleware/rateLimit.js";
import { getExpenseKeyboard, DB_UNAVAILABLE_MSG } from "./expenseMode.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("expense");

/** Handle text message in expense mode — parse and save expense. */
export async function handleExpenseText(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;
  if (!ctx.message || !("text" in ctx.message)) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  const text = typeof ctx.message.text === "string" ? ctx.message.text.trim() : "";
  if (!text) return;

  // Rate limiting
  if (!checkRateLimit(telegramId)) {
    await ctx.reply("⏳ Слишком много записей. Подождите минуту.");
    return;
  }

  const isAdmin = isBootstrapAdmin(telegramId);
  const username = ctx.from?.username ?? null;
  const firstName = ctx.from?.first_name ?? "";
  const lastName = ctx.from?.last_name ?? null;

  // Try multi-line expenses first
  try {
    const multiResult = await addMultipleExpenses(telegramId, username, firstName, lastName, isAdmin, text);
    if (multiResult) {
      const lines = multiResult.expenses.map((e) => {
        const sub = e.sub ? ` — ${e.sub}` : "";
        return `${e.emoji} ${e.name}${sub} — ${formatMoney(e.amount)}`;
      });

      const parts = [
        `✅ *Записано ${multiResult.expenses.length} трат:*`,
        ...lines,
        `\n💰 Сумма: ${formatMoney(multiResult.totalAmount)}`,
      ];
      if (multiResult.monthlyLimit > 0) {
        const pct = ((multiResult.monthTotal / multiResult.monthlyLimit) * 100).toFixed(1);
        parts.push(`📊 Итого за ${monthName(multiResult.month)}: ${formatMoney(multiResult.monthTotal)} / ${formatMoney(multiResult.monthlyLimit)} (${pct}%)`);
      }

      await ctx.replyWithMarkdown(parts.join("\n"), { ...getExpenseKeyboard(isAdmin) });
      return;
    }
  } catch (err) {
    log.error("Error adding multi-expenses:", err);
    const msg = err instanceof Error ? err.message : "Ошибка";
    await ctx.reply(`❌ Ошибка при сохранении: ${msg}`);
    return;
  }

  // Single expense
  try {
    const result = await addExpenseFromText(telegramId, username, firstName, lastName, isAdmin, text);
    await ctx.replyWithMarkdown(result.confirmation, { ...getExpenseKeyboard(isAdmin) });
  } catch (err) {
    log.error("Error adding expense:", err);
    const msg = err instanceof Error ? err.message : "Ошибка";
    if (msg === "Не удалось разобрать трату.") {
      await ctx.reply(
        "❌ Не удалось разобрать трату.\n\n" +
        "Формат: Категория Описание Сумма\n" +
        "Пример: Аптека Геморрой 5000\n\n" +
        "Нажмите 📋 Категории для списка.",
        { ...getExpenseKeyboard(isAdmin) }
      );
    } else {
      await ctx.reply(`❌ Ошибка при сохранении: ${msg}`);
    }
  }
}

/** Handle voice-extracted expense (called from voice handler). */
export async function handleVoiceExpense(
  ctx: Context,
  categoryName: string,
  subcategory: string | null,
  amount: number,
  statusMsgId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  try {
    const result = await addExpenseFromVoice(
      telegramId,
      ctx.from?.username ?? null,
      ctx.from?.first_name ?? "",
      ctx.from?.last_name ?? null,
      isBootstrapAdmin(telegramId),
      categoryName,
      subcategory,
      amount
    );

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      result.confirmation,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    log.error("Error adding voice expense:", err);
    const msg = err instanceof Error ? err.message : "Ошибка";
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      `❌ Ошибка при сохранении: ${msg}`
    );
  }
}
