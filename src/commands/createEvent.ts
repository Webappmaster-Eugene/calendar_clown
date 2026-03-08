import type { Context } from "telegraf";
import { parseEventText } from "../calendar/parse.js";
import { createEvent } from "../calendar/client.js";

export async function handleNew(ctx: Context) {
  const text = "text" in ctx.message && typeof ctx.message.text === "string"
    ? ctx.message.text.replace(/^\/new\s*/i, "").trim()
    : "";
  if (!text) {
    await ctx.replyWithMarkdown(
      "Напишите событие одной фразой, например:\n`/new Встреча с командой завтра в 15:00`"
    );
    return;
  }
  const parsed = parseEventText(text);
  if (!parsed) {
    await ctx.reply(
      "Не удалось разобрать дату и время. Попробуйте: «завтра в 15:00», «в понедельник 10:00»."
    );
    return;
  }
  try {
    const event = await createEvent(
      parsed.title,
      parsed.start,
      parsed.end
    );
    const start = new Date(event.start);
    const end = new Date(event.end);
    const timeStr = start.toLocaleString("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
    });
    const endStr = end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    await ctx.replyWithMarkdown(
      `✅ Создано: *${event.summary}*\n${timeStr} – ${endStr}` +
        (event.htmlLink ? `\n[Открыть в календаре](${event.htmlLink})` : "")
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка календаря";
    await ctx.reply(`Ошибка: ${msg}`);
  }
}
