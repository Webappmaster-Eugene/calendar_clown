import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { isDatabaseAvailable } from "../db/connection.js";
import { getUserByTelegramId, ensureUser } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { setUserMode } from "../middleware/userMode.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import type { NotableDate } from "../notable-dates/repository.js";
import {
  addNotableDate,
  removeNotableDate,
  updateNotableDate,
  listNotableDates,
  getUpcomingDates,
  toggleNotableDatePriority,
  getNotableDateById,
  countNotableDates,
  listNotableDatesPaginated,
} from "../notable-dates/repository.js";
import { parseNotableDateInput, formatNotableDateReminder } from "../notable-dates/service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("notable-dates");

const MONTH_NAMES = [
  "", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const NOTABLE_DATES_PAGE_SIZE = 10;

function getNotableDatesKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📅 Ближайшие", "📅 На неделе", "📅 За месяц"],
    ["📋 Все даты"],
    ["➕ Добавить", "✏️ Изменить", "🗑 Удалить"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

/** Handle /dates command — enter notable dates mode. */
export async function handleNotableDatesCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("Знаменательные даты недоступны (нет подключения к базе данных).");
    return;
  }

  const dbUser = await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  if (!dbUser.tribeId) {
    await ctx.reply("🎉 Знаменательные даты доступны только для участников трайба. Обратитесь к администратору.");
    return;
  }

  await setUserMode(telegramId, "notable_dates");
  await setModeMenuCommands(ctx, "notable_dates");

  // Answer callback query if triggered from inline button
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery("🎉 Даты");
  }

  await ctx.reply(
    "🎉 *Режим знаменательных дат*\n\n" +
    "Здесь можно просматривать дни рождения, праздники и другие важные даты.\n\n" +
    "Для добавления нажмите *➕ Добавить* и введите данные в формате:\n" +
    "`Имя ДД.ММ Описание`\n\n" +
    "Пример: `Иванов Иван 15.03 Коллега`",
    { parse_mode: "Markdown", ...getNotableDatesKeyboard(isBootstrapAdmin(telegramId)) }
  );
}

/** Handle "Ближайшие" button — show upcoming dates. */
export async function handleUpcomingDatesButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /start.");
    return;
  }

  try {
    const dates = await getUpcomingDates(dbUser.tribeId!, 14);
    if (dates.length === 0) {
      await ctx.reply("В ближайшие 2 недели знаменательных дат нет.");
      return;
    }

    const lines = dates.map((d) => {
      const desc = d.description ? ` — ${d.description}` : "";
      return `${d.emoji} ${d.name} (${d.dateDay}.${String(d.dateMonth).padStart(2, "0")})${desc}`;
    });

    await ctx.reply(
      `📅 *Ближайшие даты (14 дней):*\n\n${lines.join("\n")}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    log.error("Error fetching upcoming dates:", err);
    await ctx.reply("Ошибка при получении дат.");
  }
}

/** Handle "На неделе" button — show dates for this week (7 days). */
export async function handleWeekDatesButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /start.");
    return;
  }

  try {
    const dates = await getUpcomingDates(dbUser.tribeId!, 7);
    if (dates.length === 0) {
      await ctx.reply("На этой неделе знаменательных дат нет.");
      return;
    }

    const lines = dates.map((d) => {
      const desc = d.description ? ` — ${d.description}` : "";
      return `${d.emoji} ${d.name} (${d.dateDay}.${String(d.dateMonth).padStart(2, "0")})${desc}`;
    });

    await ctx.reply(
      `📅 *Даты на этой неделе (7 дней):*\n\n${lines.join("\n")}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    log.error("Error fetching week dates:", err);
    await ctx.reply("Ошибка при получении дат.");
  }
}

/** Handle "За месяц" button — show dates for the current month. */
export async function handleMonthDatesButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /start.");
    return;
  }

  try {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const dates = await listNotableDates(dbUser.tribeId!, currentMonth);
    if (dates.length === 0) {
      await ctx.reply(`В ${MONTH_NAMES[currentMonth].toLowerCase()} знаменательных дат нет.`);
      return;
    }

    const lines = dates.map((d) => {
      const desc = d.description ? ` — ${d.description}` : "";
      return `${d.emoji} ${d.dateDay}.${String(d.dateMonth).padStart(2, "0")} ${d.name}${desc}`;
    });

    await ctx.reply(
      `📅 *Даты за ${MONTH_NAMES[currentMonth].toLowerCase()} (${dates.length}):*\n\n${lines.join("\n")}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    log.error("Error fetching month dates:", err);
    await ctx.reply("Ошибка при получении дат.");
  }
}

/** Format a flat list of notable dates for display. */
function formatNotableDatesList(dates: NotableDate[]): string {
  return dates.map((d) => {
    const desc = d.description ? ` — ${d.description}` : "";
    return `${d.emoji} ${d.dateDay}.${String(d.dateMonth).padStart(2, "0")} ${d.name}${desc}`;
  }).join("\n");
}

/** Build inline keyboard buttons for a paginated notable dates list. */
function buildNotableDatesNavButtons(
  type: "all" | "delete" | "edit",
  offset: number,
  total: number
): Array<ReturnType<typeof Markup.button.callback>> {
  const navButtons: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (offset > 0) {
    navButtons.push(Markup.button.callback("⬅️ Назад", `notable_page:${type}:${offset - NOTABLE_DATES_PAGE_SIZE}`));
  }
  if (offset + NOTABLE_DATES_PAGE_SIZE < total) {
    navButtons.push(Markup.button.callback("Вперёд ➡️", `notable_page:${type}:${offset + NOTABLE_DATES_PAGE_SIZE}`));
  }
  return navButtons;
}

/** Handle "Все даты" button — show all dates with pagination. */
export async function handleAllDatesButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /start.");
    return;
  }

  try {
    const total = await countNotableDates(dbUser.tribeId!);
    if (total === 0) {
      await ctx.reply("Знаменательных дат пока нет. Нажмите ➕ Добавить.");
      return;
    }

    const dates = await listNotableDatesPaginated(dbUser.tribeId!, NOTABLE_DATES_PAGE_SIZE, 0);
    const totalPages = Math.ceil(total / NOTABLE_DATES_PAGE_SIZE);

    const navButtons = buildNotableDatesNavButtons("all", 0, total);
    const keyboard = navButtons.length > 0
      ? Markup.inlineKeyboard([navButtons])
      : undefined;

    await ctx.reply(
      `📋 *Все знаменательные даты (1/${totalPages}, всего: ${total}):*\n\n${formatNotableDatesList(dates)}`,
      { parse_mode: "Markdown", ...keyboard }
    );
  } catch (err) {
    log.error("Error listing all dates:", err);
    await ctx.reply("Ошибка при получении дат.");
  }
}

type PendingAction =
  | { action: "add"; timestamp: number }
  | { action: "edit"; dateId: number; field: "name" | "date" | "desc"; timestamp: number };

/** State for users currently adding/editing dates. Auto-expires after 5 minutes. */
const pendingAction = new Map<number, PendingAction>();

/** Clean expired pending actions (older than 5 minutes). */
function cleanExpiredActions(): void {
  const now = Date.now();
  const TTL = 5 * 60 * 1000;
  for (const [key, val] of pendingAction) {
    if (now - val.timestamp > TTL) pendingAction.delete(key);
  }
}

/** Handle "Добавить" button. */
export async function handleAddDateButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  cleanExpiredActions();
  pendingAction.set(telegramId, { action: "add", timestamp: Date.now() });
  await ctx.reply(
    "Введите данные в формате:\n`Имя ДД.ММ Описание`\n\nПример: `Иванов Иван 15.03 Коллега`\n\nОписание необязательно.",
    { parse_mode: "Markdown" }
  );
}

/** Handle "Удалить" button. */
export async function handleDeleteDateButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const total = await countNotableDates(dbUser.tribeId!, true);
  if (total === 0) {
    await ctx.reply("Нет дат для удаления.");
    return;
  }

  const dates = await listNotableDatesPaginated(dbUser.tribeId!, NOTABLE_DATES_PAGE_SIZE, 0, true);
  const totalPages = Math.ceil(total / NOTABLE_DATES_PAGE_SIZE);

  const buttons = dates.map((d) =>
    [Markup.button.callback(
      `${d.emoji} ${d.name} (${d.dateDay}.${String(d.dateMonth).padStart(2, "0")})`,
      `notable_delete:${d.id}`
    )]
  );

  const navButtons = buildNotableDatesNavButtons("delete", 0, total);
  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }

  await ctx.reply(`Выберите дату для удаления (1/${totalPages}):`, {
    ...Markup.inlineKeyboard(buttons),
  });
}

/** Handle delete callback. */
export async function handleNotableDateDeleteCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const match = data.match(/^notable_delete:(\d+)$/);
  if (!match) return;

  const dateId = parseInt(match[1], 10);

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  try {
    const deleted = await removeNotableDate(dateId, dbUser.tribeId!);
    if (deleted) {
      await ctx.editMessageText("✅ Дата удалена.");
    } else {
      await ctx.editMessageText("Дата не найдена или уже удалена.");
    }
  } catch (err) {
    log.error("Error deleting notable date:", err);
    await ctx.editMessageText("❌ Ошибка при удалении.");
  }
}

/** Handle priority toggle callback. */
export async function handleNotableDatePriorityCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = data.match(/^notable_priority:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const dateId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  try {
    await toggleNotableDatePriority(dateId, dbUser.tribeId!);
    const date = await getNotableDateById(dateId, dbUser.tribeId!);
    if (date) {
      const status = date.isPriority
        ? "🔔 Расширенные напоминания включены (за 7, 3 и 1 день)"
        : "🔕 Расширенные напоминания отключены";
      await ctx.answerCbQuery(date.isPriority ? "🔔 Включено" : "🔕 Отключено");
      await ctx.editMessageText(
        `${formatNotableDateReminder(date)}\n\n${status}`,
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback(
              date.isPriority ? "🔕 Убрать расширенные напоминания" : "🔔 Напоминать за 7, 3, 1 день",
              `notable_priority:${date.id}`
            )],
          ]),
        }
      );
    } else {
      await ctx.answerCbQuery("Дата не найдена");
    }
  } catch (err) {
    log.error("Error toggling priority:", err);
    await ctx.answerCbQuery("Ошибка");
  }
}

/** Handle text input in notable_dates mode. */
export async function handleNotableDatesText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;

  const pending = pendingAction.get(telegramId);
  if (!pending) return false;

  if (!ctx.message || !("text" in ctx.message)) return false;
  const text = typeof ctx.message.text === "string" ? ctx.message.text.trim() : "";
  if (!text) return false;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    pendingAction.delete(telegramId);
    await ctx.reply("Пользователь не найден.");
    return true;
  }

  if (pending.action === "edit") {
    return await handleEditTextInput(ctx, telegramId, dbUser, pending, text);
  }

  // action === "add"
  const parsed = parseNotableDateInput(text);
  if (!parsed) {
    // Keep pendingAction so user can retry without pressing "Добавить" again
    await ctx.reply(
      "❌ Не удалось разобрать. Формат: `Имя ДД.ММ Описание`\nПример: `Иванов Иван 15.03 Коллега`",
      { parse_mode: "Markdown" }
    );
    return true;
  }

  pendingAction.delete(telegramId);

  try {
    const date = await addNotableDate({
      tribeId: dbUser.tribeId!,
      addedByUserId: dbUser.id,
      name: parsed.name,
      dateMonth: parsed.dateMonth,
      dateDay: parsed.dateDay,
      description: parsed.description,
    });

    await ctx.reply(
      `✅ Добавлено:\n${formatNotableDateReminder(date)}`,
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback(
            date.isPriority ? "🔔 Убрать расширенные напоминания" : "🔔 Напоминать за 7, 3, 1 день",
            `notable_priority:${date.id}`
          )],
        ]),
      }
    );
  } catch (err) {
    log.error("Error adding notable date:", err);
    await ctx.reply("❌ Ошибка при сохранении.");
  }

  return true;
}

/** Handle text input for editing a notable date field. */
async function handleEditTextInput(
  ctx: Context,
  telegramId: number,
  dbUser: { tribeId: number | null },
  pending: { action: "edit"; dateId: number; field: "name" | "date" | "desc" },
  text: string
): Promise<boolean> {
  pendingAction.delete(telegramId);

  try {
    const fields: Partial<{ name: string; dateMonth: number; dateDay: number; description: string | null }> = {};

    if (pending.field === "name") {
      if (!text) {
        await ctx.reply("❌ Имя не может быть пустым.");
        return true;
      }
      fields.name = text;
    } else if (pending.field === "date") {
      const dateMatch = text.match(/^(\d{1,2})\.(\d{1,2})$/);
      if (!dateMatch) {
        await ctx.reply("❌ Неверный формат. Введите дату в формате `ДД.ММ`, например `15.03`", { parse_mode: "Markdown" });
        return true;
      }
      const day = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) {
        await ctx.reply("❌ Некорректная дата.");
        return true;
      }
      fields.dateDay = day;
      fields.dateMonth = month;
    } else if (pending.field === "desc") {
      fields.description = text || null;
    }

    const updated = await updateNotableDate(pending.dateId, dbUser.tribeId!, fields);
    if (!updated) {
      await ctx.reply("❌ Дата не найдена.");
      return true;
    }

    await ctx.reply(`✅ Обновлено:\n${formatNotableDateReminder(updated)}`);
  } catch (err) {
    log.error("Error updating notable date:", err);
    await ctx.reply("❌ Ошибка при обновлении.");
  }

  return true;
}

/** Handle "✏️ Изменить" button — show list of dates to edit. */
export async function handleEditDateButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const total = await countNotableDates(dbUser.tribeId!, true);
  if (total === 0) {
    await ctx.reply("Нет дат для редактирования.");
    return;
  }

  const dates = await listNotableDatesPaginated(dbUser.tribeId!, NOTABLE_DATES_PAGE_SIZE, 0, true);
  const totalPages = Math.ceil(total / NOTABLE_DATES_PAGE_SIZE);

  const buttons = dates.map((d) =>
    [Markup.button.callback(
      `${d.emoji} ${d.name} (${d.dateDay}.${String(d.dateMonth).padStart(2, "0")})`,
      `notable_edit:${d.id}`
    )]
  );

  const navButtons = buildNotableDatesNavButtons("edit", 0, total);
  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }

  await ctx.reply(`Выберите дату для редактирования (1/${totalPages}):`, {
    ...Markup.inlineKeyboard(buttons),
  });
}

/** Handle callback when a date is selected for editing — show field buttons. */
export async function handleNotableDateEditCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const match = data.match(/^notable_edit:(\d+)$/);
  if (!match) return;

  const dateId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  try {
    const date = await getNotableDateById(dateId, dbUser.tribeId!);
    if (!date) {
      await ctx.editMessageText("Дата не найдена.");
      return;
    }

    const desc = date.description ? `📝 ${date.description}` : "📝 (нет описания)";
    const info = [
      `${date.emoji} *${date.name}*`,
      `📅 ${date.dateDay}.${String(date.dateMonth).padStart(2, "0")}`,
      desc,
    ].join("\n");

    await ctx.editMessageText(`Редактирование:\n\n${info}\n\nВыберите что изменить:`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✏️ Имя", `notable_edit_field:${dateId}:name`)],
        [Markup.button.callback("📅 Дата", `notable_edit_field:${dateId}:date`)],
        [Markup.button.callback("📝 Описание", `notable_edit_field:${dateId}:desc`)],
      ]),
    });
  } catch (err) {
    log.error("Error fetching date for edit:", err);
    await ctx.editMessageText("❌ Ошибка.");
  }
}

/** Handle notable dates pagination callback. */
export async function handleNotableDatesPageCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^notable_page:(all|delete|edit):(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const type = match[1] as "all" | "delete" | "edit";
  const offset = parseInt(match[2], 10);

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  try {
    const excludeHolidays = type !== "all";
    const total = await countNotableDates(dbUser.tribeId!, excludeHolidays);
    const dates = await listNotableDatesPaginated(dbUser.tribeId!, NOTABLE_DATES_PAGE_SIZE, offset, excludeHolidays);
    const totalPages = Math.ceil(total / NOTABLE_DATES_PAGE_SIZE);
    const currentPage = Math.floor(offset / NOTABLE_DATES_PAGE_SIZE) + 1;

    const navButtons = buildNotableDatesNavButtons(type, offset, total);

    if (type === "all") {
      const keyboard = navButtons.length > 0
        ? Markup.inlineKeyboard([navButtons])
        : undefined;

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `📋 *Все знаменательные даты (${currentPage}/${totalPages}, всего: ${total}):*\n\n${formatNotableDatesList(dates)}`,
        { parse_mode: "Markdown", ...keyboard }
      );
    } else {
      const callbackPrefix = type === "delete" ? "notable_delete" : "notable_edit";
      const label = type === "delete" ? "удаления" : "редактирования";

      const buttons = dates.map((d) =>
        [Markup.button.callback(
          `${d.emoji} ${d.name} (${d.dateDay}.${String(d.dateMonth).padStart(2, "0")})`,
          `${callbackPrefix}:${d.id}`
        )]
      );

      if (navButtons.length > 0) {
        buttons.push(navButtons);
      }

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `Выберите дату для ${label} (${currentPage}/${totalPages}):`,
        { ...Markup.inlineKeyboard(buttons) }
      );
    }
  } catch (err) {
    log.error("Error in notable dates pagination:", err);
    await ctx.answerCbQuery("Ошибка");
  }
}

/** Handle callback when a field is selected for editing — prompt for new value. */
export async function handleNotableDateEditFieldCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const match = data.match(/^notable_edit_field:(\d+):(name|date|desc)$/);
  if (!match) return;

  const dateId = parseInt(match[1], 10);
  const field = match[2] as "name" | "date" | "desc";

  cleanExpiredActions();

  const fieldLabels: Record<string, string> = {
    name: "имя",
    date: "дату (формат: `ДД.ММ`)",
    desc: "описание",
  };

  pendingAction.set(telegramId, { action: "edit", dateId, field, timestamp: Date.now() });
  await ctx.reply(
    `Введите новое значение для поля: *${fieldLabels[field]}*`,
    { parse_mode: "Markdown" }
  );
}

// ─── CSV Import via Document Upload ─────────────────────────────────────

/** Simple CSV line parser that handles quoted fields. */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Handle document upload in notable dates mode — import CSV file.
 * CSV format: Subject,Start Date,Start Time,End Date,End Time,Description
 * Subject: "🎂 День рождения: Имя Фамилия"
 * Start Date: MM/DD/YYYY
 */
export async function handleNotableDatesDocument(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) {
    await ctx.reply("Пользователь не найден или не в трайбе.");
    return;
  }

  const doc = ctx.message && "document" in ctx.message ? ctx.message.document : null;
  if (!doc) return;

  // Only accept CSV/text files
  const fileName = doc.file_name ?? "";
  if (!fileName.endsWith(".csv") && doc.mime_type !== "text/csv" && doc.mime_type !== "text/plain") {
    await ctx.reply("Пожалуйста, отправьте файл в формате CSV.");
    return;
  }

  // Limit file size to 1 MB
  if (doc.file_size && doc.file_size > 1024 * 1024) {
    await ctx.reply("Файл слишком большой. Максимум 1 МБ.");
    return;
  }

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const response = await fetch(fileLink.href);
    if (!response.ok) {
      await ctx.reply("Не удалось скачать файл.");
      return;
    }

    const content = await response.text();
    const lines = content.split("\n").filter((l) => l.trim());

    if (lines.length < 2) {
      await ctx.reply("Файл пуст или содержит только заголовок.");
      return;
    }

    // Skip header
    const dataLines = lines.slice(1);
    let imported = 0;
    let skipped = 0;

    for (const line of dataLines) {
      try {
        const parts = parseCSVLine(line);
        if (parts.length < 2) {
          skipped++;
          continue;
        }

        const [subject, startDate] = parts;
        const description = parts.length >= 6 ? parts[5]?.trim() || null : null;

        // Extract name and type
        const birthdayMatch = subject.match(/День рождения:\s*(.+)/);
        const anniversaryMatch = !birthdayMatch ? subject.match(/Годовщина\s+(.+)/i) : null;

        let name: string;
        let eventType: string;
        let emoji: string;

        if (birthdayMatch) {
          name = birthdayMatch[1].trim();
          eventType = "birthday";
          emoji = "🎂";
        } else if (anniversaryMatch) {
          name = subject.replace(/^[^\p{L}]*/u, "").trim();
          eventType = "anniversary";
          emoji = "💍";
        } else {
          name = subject.replace(/^[^\p{L}]*/u, "").trim();
          if (!name) {
            skipped++;
            continue;
          }
          eventType = "other";
          emoji = "📌";
        }

        // Parse date MM/DD/YYYY
        const dateMatch = startDate.match(/^(\d{1,2})\/(\d{1,2})\/\d{4}$/);
        if (!dateMatch) {
          skipped++;
          continue;
        }
        const month = parseInt(dateMatch[1], 10);
        const day = parseInt(dateMatch[2], 10);

        await addNotableDate({
          tribeId: dbUser.tribeId!,
          addedByUserId: dbUser.id,
          name,
          dateMonth: month,
          dateDay: day,
          eventType,
          description,
          emoji,
        });
        imported++;
      } catch {
        skipped++;
      }
    }

    await ctx.reply(
      `📥 *Импорт завершён*\n\n✅ Импортировано: ${imported}\n⏭ Пропущено: ${skipped}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    log.error("Error importing CSV:", err);
    await ctx.reply("Ошибка при импорте файла.");
  }
}
