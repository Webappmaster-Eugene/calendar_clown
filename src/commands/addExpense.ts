import type { Context } from "telegraf";
import { parseExpenseText } from "../expenses/parser.js";
import {
  addExpense,
  ensureUser,
  getMonthTotal,
} from "../expenses/repository.js";
import { formatExpenseConfirmation, monthName } from "../expenses/formatter.js";
import { isAdminUser } from "../middleware/auth.js";
import { getExpenseKeyboard } from "./expenseMode.js";

const TIMEZONE = "Europe/Moscow";

function getMonthLimit(): number {
  const raw = process.env.MONTHLY_EXPENSE_LIMIT?.trim();
  if (!raw) return 350_000;
  const parsed = parseFloat(raw);
  return isNaN(parsed) ? 350_000 : parsed;
}

/**
 * Handle text message in expense mode — parse and save expense.
 */
export async function handleExpenseText(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!ctx.message || !("text" in ctx.message)) return;
  const text = typeof ctx.message.text === "string"
    ? ctx.message.text.trim()
    : "";

  if (!text) return;

  const parsed = await parseExpenseText(text);
  if (!parsed) {
    await ctx.reply(
      "❌ Не удалось разобрать трату.\n\n" +
      "Формат: *Категория Описание Сумма*\n" +
      "Пример: `Аптека Геморрой 5000`\n\n" +
      "Нажмите 📋 Категории для списка.",
      { parse_mode: "Markdown", ...getExpenseKeyboard() }
    );
    return;
  }

  try {
    const dbUser = await ensureUser(
      telegramId,
      ctx.from?.username ?? null,
      ctx.from?.first_name ?? "",
      ctx.from?.last_name ?? null,
      isAdminUser(telegramId)
    );

    const expense = await addExpense(
      dbUser.id,
      dbUser.tribeId,
      parsed.categoryId,
      parsed.amount,
      parsed.subcategory,
      "text"
    );

    const now = new Date();
    const mskDate = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
    const year = mskDate.getFullYear();
    const month = mskDate.getMonth() + 1;

    const total = await getMonthTotal(dbUser.tribeId, year, month);
    const limit = getMonthLimit();

    const confirmation = formatExpenseConfirmation(
      parsed.categoryEmoji,
      parsed.categoryName,
      parsed.subcategory,
      parsed.amount,
      expense.createdAt,
      dbUser.firstName || ctx.from?.first_name || "Пользователь",
      total,
      limit,
      monthName(month)
    );

    await ctx.replyWithMarkdown(confirmation, { ...getExpenseKeyboard() });
  } catch (err) {
    console.error("Error adding expense:", err);
    const msg = err instanceof Error ? err.message : "Ошибка";
    await ctx.reply(`❌ Ошибка при сохранении: ${msg}`);
  }
}

/**
 * Handle voice-extracted expense (called from voice handler).
 */
export async function handleVoiceExpense(
  ctx: Context,
  categoryName: string,
  subcategory: string | null,
  amount: number,
  statusMsgId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const parsed = await parseExpenseText(
    `${categoryName} ${subcategory || ""} ${amount}`
  );

  if (!parsed) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      "❌ Не удалось определить категорию из голосового сообщения."
    );
    return;
  }

  try {
    const dbUser = await ensureUser(
      telegramId,
      ctx.from?.username ?? null,
      ctx.from?.first_name ?? "",
      ctx.from?.last_name ?? null,
      isAdminUser(telegramId)
    );

    const expense = await addExpense(
      dbUser.id,
      dbUser.tribeId,
      parsed.categoryId,
      parsed.amount,
      parsed.subcategory,
      "voice"
    );

    const now = new Date();
    const mskDate = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
    const year = mskDate.getFullYear();
    const month = mskDate.getMonth() + 1;

    const total = await getMonthTotal(dbUser.tribeId, year, month);
    const limit = getMonthLimit();

    const confirmation = formatExpenseConfirmation(
      parsed.categoryEmoji,
      parsed.categoryName,
      parsed.subcategory,
      parsed.amount,
      expense.createdAt,
      dbUser.firstName || ctx.from?.first_name || "Пользователь",
      total,
      limit,
      monthName(month)
    );

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      confirmation,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Error adding voice expense:", err);
    const msg = err instanceof Error ? err.message : "Ошибка";
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      `❌ Ошибка при сохранении: ${msg}`
    );
  }
}
