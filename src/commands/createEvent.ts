import type { Context } from "telegraf";
import { parseEventText } from "../calendar/parse.js";
import { createEvent, NoCalendarLinkedError } from "../calendar/client.js";
import { saveCalendarEvent } from "../calendar/repository.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { escapeMarkdown } from "../utils/markdown.js";
import { getUserId, replyMarkdownSafe } from "../utils/telegram.js";
import { TIMEZONE_MSK } from "../constants.js";

export async function handleNew(ctx: Context): Promise<void> {
  const userId = getUserId(ctx);
  if (!userId) {
    await ctx.reply("Не удалось определить пользователя.");
    return;
  }
  if (!ctx.message || !("text" in ctx.message)) return;
  const text = typeof ctx.message.text === "string"
    ? ctx.message.text.replace(/^\/new\s*/i, "").trim()
    : "";
  if (!text) {
    await ctx.reply(
      "Напишите событие одной фразой, например:\n/new Встреча с командой завтра в 15:00"
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
    const event = await createEvent(parsed.title, parsed.start, parsed.end, userId);
    const start = new Date(event.start);
    const end = new Date(event.end);
    const timeStr = start.toLocaleString("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: TIMEZONE_MSK,
    });
    const endStr = end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE_MSK });
    const safeSummary = escapeMarkdown(event.summary);
    const msg =
      `✅ Создано: *${safeSummary}*\n${timeStr} – ${endStr}` +
      (event.htmlLink ? `\n[Открыть в календаре](${event.htmlLink})` : "");
    await replyMarkdownSafe(ctx, msg);

    if (isDatabaseAvailable() && ctx.from?.id) {
      try {
        const dbUser = await getUserByTelegramId(ctx.from.id);
        if (dbUser) {
          await saveCalendarEvent({
            userId: dbUser.id,
            tribeId: dbUser.tribeId,
            googleEventId: event.id ?? null,
            summary: event.summary,
            startTime: start,
            endTime: end,
            inputMethod: "text",
            status: "created",
            htmlLink: event.htmlLink ?? null,
          });
        }
      } catch (dbErr) {
        console.error("Failed to save calendar event to DB:", dbErr);
      }
    }
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      await ctx.reply(err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Ошибка календаря";
    await ctx.reply(`Ошибка: ${msg}`);

    if (isDatabaseAvailable() && ctx.from?.id && !(err instanceof NoCalendarLinkedError)) {
      try {
        const dbUser = await getUserByTelegramId(ctx.from.id);
        if (dbUser) {
          await saveCalendarEvent({
            userId: dbUser.id,
            tribeId: dbUser.tribeId,
            googleEventId: null,
            summary: parsed.title,
            startTime: parsed.start,
            endTime: parsed.end,
            inputMethod: "text",
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
          });
        }
      } catch (dbErr) {
        console.error("Failed to save failed calendar event to DB:", dbErr);
      }
    }
  }
}
