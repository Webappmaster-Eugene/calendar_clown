import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode, getUserMode } from "../middleware/expenseMode.js";
import { getCategoriesList } from "../expenses/parser.js";

const EXPENSE_KEYBOARD = Markup.keyboard([
  ["📊 Отчёт", "📥 Excel"],
  ["📋 Категории", "📈 Сравнение"],
  ["👥 Статистика", "↩️ Отменить"],
  ["🔙 Календарь"],
]).resize();

const CALENDAR_KEYBOARD = Markup.removeKeyboard();

export function getExpenseKeyboard() {
  return EXPENSE_KEYBOARD;
}

export async function handleExpensesCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  setUserMode(telegramId, "expenses");

  const categoriesList = await getCategoriesList();

  await ctx.replyWithMarkdown(
    "💰 *Режим учёта расходов активирован*\n\n" +
    "Просто отправьте трату в формате:\n" +
    "📝 *Категория Описание Сумма*\n\n" +
    "Примеры:\n" +
    "• `Продукты 55000`\n" +
    "• `Аптека Геморрой 5000`\n" +
    "• `Кафе Бургер Кинг 1200`\n\n" +
    "Или отправьте голосовое сообщение 🎤\n\n" +
    "📋 *Категории:*\n" + categoriesList,
    { ...EXPENSE_KEYBOARD }
  );
}

export async function handleCalendarCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  setUserMode(telegramId, "calendar");

  await ctx.reply(
    "📅 Режим календаря активирован. Используйте /help для списка команд.",
    { ...CALENDAR_KEYBOARD }
  );
}

export async function handleCategoriesButton(ctx: Context): Promise<void> {
  const categoriesList = await getCategoriesList();
  await ctx.replyWithMarkdown(
    "📋 *Доступные категории:*\n\n" + categoriesList
  );
}
