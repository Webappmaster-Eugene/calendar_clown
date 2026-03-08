import type { Context } from "telegraf";
import { listEvents } from "../calendar/client.js";

function formatEvent(e: { summary: string; start: string; end: string }) {
  const start = new Date(e.start);
  const end = new Date(e.end);
  const time = `${start.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} – ${end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  return `• ${e.summary} (${time})`;
}

export async function handleToday(ctx: Context) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  try {
    const events = await listEvents(start, end);
    if (events.length === 0) {
      await ctx.reply("На сегодня встреч нет.");
      return;
    }
    const text = "📅 *Сегодня:*\n" + events.map(formatEvent).join("\n");
    await ctx.replyWithMarkdown(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка календаря";
    await ctx.reply(`Ошибка: ${msg}`);
  }
}

export async function handleWeek(ctx: Context) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  try {
    const events = await listEvents(start, end);
    if (events.length === 0) {
      await ctx.reply("На эту неделю встреч нет.");
      return;
    }
    const lines: string[] = [];
    let currentDay = "";
    for (const e of events) {
      const d = new Date(e.start);
      const dayKey = d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
      if (dayKey !== currentDay) {
        currentDay = dayKey;
        lines.push(`\n*${dayKey}*`);
      }
      lines.push(formatEvent(e));
    }
    await ctx.replyWithMarkdown("📅 *Неделя:*" + lines.join("\n"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка календаря";
    await ctx.reply(`Ошибка: ${msg}`);
  }
}
