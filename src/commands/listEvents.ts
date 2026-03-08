import type { Context } from "telegraf";
import { listEvents, NoCalendarLinkedError } from "../calendar/client.js";

const TIMEZONE_MSK = "Europe/Moscow";

function getUserId(ctx: Context): string | null {
  const id = ctx.from?.id ?? ctx.chat?.id;
  return id != null ? String(id) : null;
}

function formatEvent(e: { summary: string; start: string; end: string }) {
  const start = new Date(e.start);
  const end = new Date(e.end);
  const timeOpt = { hour: "2-digit" as const, minute: "2-digit" as const, timeZone: TIMEZONE_MSK };
  const time = `${start.toLocaleTimeString("ru-RU", timeOpt)} – ${end.toLocaleTimeString("ru-RU", timeOpt)}`;
  return `• ${e.summary} (${time})`;
}

export async function handleToday(ctx: Context) {
  const userId = getUserId(ctx);
  if (!userId) {
    await ctx.reply("Не удалось определить пользователя.");
    return;
  }
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  try {
    const events = await listEvents(start, end, userId);
    if (events.length === 0) {
      await ctx.reply("На сегодня встреч нет.");
      return;
    }
    const text = "📅 *Сегодня:*\n" + events.map(formatEvent).join("\n");
    await ctx.replyWithMarkdown(text);
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      await ctx.reply(err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Ошибка календаря";
    await ctx.reply(`Ошибка: ${msg}`);
  }
}

export async function handleWeek(ctx: Context) {
  const userId = getUserId(ctx);
  if (!userId) {
    await ctx.reply("Не удалось определить пользователя.");
    return;
  }
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  try {
    const events = await listEvents(start, end, userId);
    if (events.length === 0) {
      await ctx.reply("На эту неделю встреч нет.");
      return;
    }
    const lines: string[] = [];
    let currentDay = "";
    for (const e of events) {
      const d = new Date(e.start);
      const dayKey = d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: TIMEZONE_MSK });
      if (dayKey !== currentDay) {
        currentDay = dayKey;
        lines.push(`\n*${dayKey}*`);
      }
      lines.push(formatEvent(e));
    }
    await ctx.replyWithMarkdown("📅 *Неделя:*" + lines.join("\n"));
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      await ctx.reply(err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Ошибка календаря";
    await ctx.reply(`Ошибка: ${msg}`);
  }
}
