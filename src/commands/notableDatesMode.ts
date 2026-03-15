import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { isDatabaseAvailable } from "../db/connection.js";
import { getUserByTelegramId, ensureUser } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { setUserMode } from "../middleware/expenseMode.js";
import { getModeButtons } from "./expenseMode.js";
import {
  addNotableDate,
  removeNotableDate,
  listNotableDates,
  getUpcomingDates,
} from "../notable-dates/repository.js";
import { parseNotableDateInput, formatNotableDateReminder } from "../notable-dates/service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("notable-dates");

const MONTH_NAMES = [
  "", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function getNotableDatesKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📅 Ближайшие", "📋 Все даты"],
    ["➕ Добавить", "🗑 Удалить"],
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

  await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  await setUserMode(telegramId, "notable_dates");

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
    const dates = await getUpcomingDates(dbUser.tribeId, 14);
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

/** Handle "Все даты" button — show all dates grouped by month. */
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
    const dates = await listNotableDates(dbUser.tribeId);
    if (dates.length === 0) {
      await ctx.reply("Знаменательных дат пока нет. Нажмите ➕ Добавить.");
      return;
    }

    // Group by month
    const byMonth = new Map<number, typeof dates>();
    for (const d of dates) {
      const arr = byMonth.get(d.dateMonth) ?? [];
      arr.push(d);
      byMonth.set(d.dateMonth, arr);
    }

    const sections: string[] = [];
    for (let m = 1; m <= 12; m++) {
      const monthDates = byMonth.get(m);
      if (!monthDates) continue;
      const lines = monthDates.map((d) => {
        const desc = d.description ? ` — ${d.description}` : "";
        return `  ${d.emoji} ${d.dateDay}.${String(m).padStart(2, "0")} ${d.name}${desc}`;
      });
      sections.push(`*${MONTH_NAMES[m]}:*\n${lines.join("\n")}`);
    }

    const text = `📋 *Все знаменательные даты (${dates.length}):*\n\n${sections.join("\n\n")}`;

    // Split if too long
    if (text.length > 4000) {
      const half = Math.ceil(sections.length / 2);
      const first = `📋 *Все даты (часть 1):*\n\n${sections.slice(0, half).join("\n\n")}`;
      const second = `📋 *Все даты (часть 2):*\n\n${sections.slice(half).join("\n\n")}`;
      await ctx.reply(first, { parse_mode: "Markdown" });
      await ctx.reply(second, { parse_mode: "Markdown" });
    } else {
      await ctx.reply(text, { parse_mode: "Markdown" });
    }
  } catch (err) {
    log.error("Error listing all dates:", err);
    await ctx.reply("Ошибка при получении дат.");
  }
}

/** State for users currently adding dates. Auto-expires after 5 minutes. */
const pendingAction = new Map<number, { action: "add"; timestamp: number }>();

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

  const dates = await listNotableDates(dbUser.tribeId);
  const deletable = dates.filter((d) => d.eventType !== "holiday");

  if (deletable.length === 0) {
    await ctx.reply("Нет дат для удаления.");
    return;
  }

  // Show numbered list with inline buttons
  const buttons = deletable.slice(0, 20).map((d) =>
    [Markup.button.callback(
      `${d.emoji} ${d.name} (${d.dateDay}.${String(d.dateMonth).padStart(2, "0")})`,
      `notable_delete:${d.id}`
    )]
  );

  await ctx.reply("Выберите дату для удаления:", {
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
    const deleted = await removeNotableDate(dateId, dbUser.tribeId);
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

/** Handle text input in notable_dates mode. */
export async function handleNotableDatesText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;

  const pending = pendingAction.get(telegramId);
  if (!pending || pending.action !== "add") return false;

  if (!ctx.message || !("text" in ctx.message)) return false;
  const text = typeof ctx.message.text === "string" ? ctx.message.text.trim() : "";
  if (!text) return false;

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

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден.");
    return true;
  }

  try {
    const date = await addNotableDate({
      tribeId: dbUser.tribeId,
      addedByUserId: dbUser.id,
      name: parsed.name,
      dateMonth: parsed.dateMonth,
      dateDay: parsed.dateDay,
      description: parsed.description,
    });

    await ctx.reply(
      `✅ Добавлено:\n${formatNotableDateReminder(date)}`,
    );
  } catch (err) {
    log.error("Error adding notable date:", err);
    await ctx.reply("❌ Ошибка при сохранении.");
  }

  return true;
}
