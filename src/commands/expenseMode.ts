import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import type { UserMode } from "../middleware/userMode.js";
import { getCategoriesList } from "../expenses/parser.js";
import { ensureUser } from "../expenses/repository.js";
import { isBootstrapAdmin, getUserMenuContext, canAccessMode } from "../middleware/auth.js";
import type { UserMenuContext } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DB_UNAVAILABLE_MSG } from "../constants.js";

export { DB_UNAVAILABLE_MSG };

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
    { command: "stats", description: "Статистика бота" },
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
    { command: "broadcast", description: "Царская почта — рассылка" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  notable_dates: [
    { command: "dates", description: "Знаменательные даты (текущий)" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  gandalf: [
    { command: "gandalf", description: "База знаний (текущий)" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  neuro: [
    { command: "neuro", description: "Нейро — AI-чат (текущий)" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  wishlist: [
    { command: "wishlist", description: "Вишлист — списки желаний (текущий)" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  goals: [
    { command: "goals", description: "Хранитель целей (текущий)" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  reminders: [
    { command: "reminders", description: "Напоминания (текущий)" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  osint: [
    { command: "osint", description: "OSINT-поиск (текущий)" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  summarizer: [
    { command: "summarizer", description: "Саммаризатор работы (текущий)" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  blogger: [
    { command: "blogger", description: "Блогер (текущий)" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "help", description: "Справка" },
  ],
  admin: [
    { command: "admin", description: "Управление пользователями" },
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

export function getModeKeyboard(isAdmin: boolean, context?: UserMenuContext | null) {
  // If we have context, use role-based keyboard
  if (context) {
    if (context.role === "admin") {
      return Markup.keyboard([
        ["📅 Календарь", "💰 Расходы"],
        ["🎙️ Транскрибация", "🧙 База знаний"],
        ["📰 Дайджест", "🎂 Даты"],
        ["🎁 Вишлист", "🧠 Нейро"],
        ["🎯 Цели", "⏰ Напоминания"],
        ["🔍 OSINT", "📋 Резюме"],
        ["✍️ Блогер", "📢 Рассылка"],
        ["⚙️ Админка"],
      ]).resize();
    }
    if (context.hasTribe) {
      return Markup.keyboard([
        ["📅 Календарь", "💰 Расходы"],
        ["🎙️ Транскрибация", "🧙 База знаний"],
        ["📰 Дайджест", "🎂 Даты"],
        ["🎁 Вишлист", "🧠 Нейро"],
        ["🎯 Цели", "⏰ Напоминания"],
        ["🔍 OSINT", "📋 Резюме"],
        ["✍️ Блогер"],
      ]).resize();
    }
    // User without tribe — limited modes
    return Markup.keyboard([
      ["📅 Календарь", "🎙️ Транскрибация"],
      ["🧙 База знаний", "🧠 Нейро"],
      ["🎯 Цели", "⏰ Напоминания"],
    ]).resize();
  }

  // Fallback: simple admin check
  const rows = [
    ["📅 Календарь", "💰 Расходы"],
    ["🎙️ Транскрибация", "🧙 База знаний"],
    ["📰 Дайджест", "🎂 Даты"],
    ["🎁 Вишлист", "🧠 Нейро"],
    ["🎯 Цели", "⏰ Напоминания"],
    ["🔍 OSINT", "📋 Резюме"],
    ["✍️ Блогер"],
  ];
  if (isAdmin) {
    rows.push(["📢 Рассылка", "⚙️ Админка"]);
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
  const dbUser = await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  if (!dbUser.tribeId) {
    await ctx.reply("💰 Расходы доступны только для участников трайба. Обратитесь к администратору.");
    return;
  }

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

function getModeInlineKeyboard(isAdmin: boolean, context?: UserMenuContext | null) {
  const ctx = context ?? { role: isAdmin ? "admin" as const : "user" as const, status: "approved", hasTribe: true, tribeId: 1, tribeName: null };
  const rows = [
    [
      Markup.button.callback("📅 Календарь", "mode:calendar"),
      ...(canAccessMode("expenses", ctx) ? [Markup.button.callback("💰 Расходы", "mode:expenses")] : []),
    ],
    [
      Markup.button.callback("🎙️ Транскрибация", "mode:transcribe"),
      Markup.button.callback("🧙 База знаний", "mode:gandalf"),
    ],
  ];
  if (canAccessMode("digest", ctx) || canAccessMode("notable_dates", ctx)) {
    rows.push([
      ...(canAccessMode("digest", ctx) ? [Markup.button.callback("📰 Дайджест", "mode:digest")] : []),
      ...(canAccessMode("notable_dates", ctx) ? [Markup.button.callback("🎂 Даты", "mode:notable_dates")] : []),
    ]);
  }
  if (canAccessMode("wishlist", ctx)) {
    rows.push([
      Markup.button.callback("🎁 Вишлист", "mode:wishlist"),
    ]);
  }
  rows.push([
    Markup.button.callback("🧠 Нейро", "mode:neuro"),
    Markup.button.callback("🎯 Цели", "mode:goals"),
  ]);
  rows.push([
    Markup.button.callback("⏰ Напоминания", "mode:reminders"),
  ]);
  if (canAccessMode("osint", ctx)) {
    rows.push([
      Markup.button.callback("🔍 OSINT", "mode:osint"),
    ]);
  }
  if (canAccessMode("summarizer", ctx)) {
    rows.push([
      Markup.button.callback("📋 Резюме", "mode:summarizer"),
      Markup.button.callback("✍️ Блогер", "mode:blogger"),
    ]);
  }
  if (isAdmin) {
    rows.push([
      Markup.button.callback("📢 Рассылка", "mode:broadcast"),
      Markup.button.callback("⚙️ Админка", "mode:admin"),
    ]);
  }
  return Markup.inlineKeyboard(rows);
}

export async function handleModeCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  const isAdmin = telegramId != null && isBootstrapAdmin(telegramId);

  // If triggered from the "🏠 Главное меню" keyboard button, show keyboard-based mode selector
  const isFromKeyboard = ctx.message && "text" in ctx.message && ctx.message.text === "🏠 Главное меню";
  if (isFromKeyboard) {
    const menuCtx = telegramId ? await getUserMenuContext(telegramId) : null;
    await ctx.reply("Выберите режим работы:", { ...getModeKeyboard(isAdmin, menuCtx) });
    return;
  }

  const menuCtx2 = telegramId ? await getUserMenuContext(telegramId) : null;
  await ctx.reply("Выберите режим работы:", { ...getModeInlineKeyboard(isAdmin, menuCtx2) });
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
