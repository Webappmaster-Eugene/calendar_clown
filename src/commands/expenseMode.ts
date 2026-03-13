import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/expenseMode.js";
import { getCategoriesList } from "../expenses/parser.js";
import { ensureUser } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";

export const DB_UNAVAILABLE_MSG =
  "⚠️ Учёт расходов временно недоступен (нет подключения к базе данных).\n" +
  "Календарь работает в обычном режиме.";

const EXPENSE_KEYBOARD = Markup.keyboard([
  ["📊 Отчёт", "📥 Excel"],
  ["📋 Категории", "📈 Сравнение"],
  ["👥 Статистика", "↩️ Отменить"],
  ["📅 Календарь"],
]).resize();

const MODE_KEYBOARD = Markup.keyboard([
  ["📅 Календарь", "💰 Расходы"],
]).resize();

export function getExpenseKeyboard() {
  return EXPENSE_KEYBOARD;
}

export async function handleExpensesCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  // Ensure user exists in DB before switching mode
  await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  await setUserMode(telegramId, "expenses");

  const categoriesList = await getCategoriesList();

  await ctx.reply(
    "💰 *Режим учёта расходов активирован*\n\n" +
    "Просто отправьте трату в формате:\n" +
    "📝 *Категория Описание Сумма*\n\n" +
    "Примеры:\n" +
    "• `Продукты 55000`\n" +
    "• `Аптека Геморрой 5000`\n" +
    "• `Кафе Бургер Кинг 1200`\n\n" +
    "Или отправьте голосовое сообщение 🎤\n\n" +
    "📋 *Категории:*\n" + categoriesList,
    { parse_mode: "Markdown", ...EXPENSE_KEYBOARD }
  );
}

export async function handleCalendarCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("📅 Календарь работает. Используйте /help для списка команд.");
    return;
  }

  await setUserMode(telegramId, "calendar");

  await ctx.reply(
    "📅 Режим календаря активирован. Используйте /help для списка команд.",
    { ...MODE_KEYBOARD }
  );
}

export async function handleCategoriesButton(ctx: Context): Promise<void> {
  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  const categoriesList = await getCategoriesList();
  await ctx.reply(
    "📋 *Доступные категории:*\n\n" + categoriesList,
    { parse_mode: "Markdown" }
  );
}
