import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/expenseMode.js";
import type { UserMode } from "../middleware/expenseMode.js";
import { getCategoriesList } from "../expenses/parser.js";
import { ensureUser } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";

export const DB_UNAVAILABLE_MSG =
  "⚠️ Учёт расходов временно недоступен (нет подключения к базе данных).\n" +
  "Календарь работает в обычном режиме.";

/** Single bottom row to return to main menu — used in all mode keyboards. */
export function getModeButtons(_isAdmin: boolean): string[][] {
  return [["🏠 Главное меню"]];
}

/** Per-mode commands for the Telegram hamburger menu. */
const MODE_COMMANDS: Record<UserMode, Array<{ command: string; description: string }>> = {
  calendar: [
    { command: "new", description: "Создать встречу из фразы" },
    { command: "today", description: "Встречи на сегодня" },
    { command: "week", description: "Встречи на неделю" },
    { command: "cancel", description: "Отменить встречу" },
    { command: "auth", description: "Привязать календарь" },
    { command: "status", description: "Статус привязки" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  expenses: [
    { command: "expenses", description: "Режим расходов (текущий)" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  transcribe: [
    { command: "transcribe", description: "Режим транскрибатора (текущий)" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  digest: [
    { command: "digest", description: "Управление рубриками" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  broadcast: [
    { command: "broadcast", description: "Рассылка сообщений" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  notable_dates: [
    { command: "dates", description: "Знаменательные даты (текущий)" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
};

/** Update the Telegram hamburger menu commands for the user's current mode. */
export async function setModeMenuCommands(ctx: Context, mode: UserMode): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId == null) return;
  const commands = MODE_COMMANDS[mode] ?? MODE_COMMANDS.calendar;
  try {
    await ctx.telegram.setMyCommands(commands, {
      scope: { type: "chat", chat_id: chatId },
    });
  } catch {
    // Non-critical — silently ignore
  }
}

export function getModeKeyboard(isAdmin: boolean) {
  const rows = [
    ["📅 Календарь", "💰 Расходы"],
    ["🎙 Транскрибатор", "📰 Дайджест"],
    ["🎉 Даты"],
  ];
  if (isAdmin) {
    rows.push(["📢 Рассылка"]);
  }
  return Markup.keyboard(rows).resize();
}

export function getExpenseKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📊 Отчёт", "📥 Excel"],
    ["📋 Категории", "📈 Сравнение"],
    ["👥 Статистика"],
    ...getModeButtons(isAdmin),
  ]).resize();
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
  await setModeMenuCommands(ctx, "expenses");

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
    { parse_mode: "Markdown", ...getExpenseKeyboard(isBootstrapAdmin(telegramId)) }
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
  await setModeMenuCommands(ctx, "calendar");

  await ctx.reply(
    "📅 Режим календаря активирован. Используйте /help для списка команд.",
    { ...getModeKeyboard(isBootstrapAdmin(telegramId)) }
  );
}

function getModeInlineKeyboard(isAdmin: boolean) {
  const rows = [
    [
      Markup.button.callback("📅 Календарь", "mode:calendar"),
      Markup.button.callback("💰 Расходы", "mode:expenses"),
    ],
    [
      Markup.button.callback("🎙 Транскрибатор", "mode:transcribe"),
      Markup.button.callback("📰 Дайджест", "mode:digest"),
    ],
    [
      Markup.button.callback("🎉 Даты", "mode:notable_dates"),
    ],
  ];
  if (isAdmin) {
    rows.push([Markup.button.callback("📢 Рассылка", "mode:broadcast")]);
  }
  return Markup.inlineKeyboard(rows);
}

export async function handleModeCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  const isAdmin = telegramId != null && isBootstrapAdmin(telegramId);

  // If triggered from the "🏠 Главное меню" keyboard button, show keyboard-based mode selector
  const isFromKeyboard = ctx.message && "text" in ctx.message && ctx.message.text === "🏠 Главное меню";
  if (isFromKeyboard) {
    await ctx.reply("Выберите режим работы:", { ...getModeKeyboard(isAdmin) });
    return;
  }

  await ctx.reply("Выберите режим работы:", { ...getModeInlineKeyboard(isAdmin) });
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
