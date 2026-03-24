import type { Context } from "telegraf";
import { parseEventText } from "../calendar/parse.js";
import { createEvent, listEvents, NoCalendarLinkedError } from "../calendar/client.js";
import { saveCalendarEvent } from "../calendar/repository.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { escapeMarkdown } from "../utils/markdown.js";
import { getUserId, replyMarkdownSafe } from "../utils/telegram.js";
import { TIMEZONE_MSK } from "../constants.js";
import { extractVoiceIntent } from "../voice/extractVoiceIntent.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("calendar");

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
        log.error("Failed to save calendar event to DB:", dbErr);
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
        log.error("Failed to save failed calendar event to DB:", dbErr);
      }
    }
  }
}

/**
 * Handle plain text in calendar mode (without /new prefix).
 * Uses AI extraction (extractVoiceIntent) since free-form text like
 * "8:00, Екатерина, скрининг по собесу" needs structured parsing.
 * Falls back to chrono-node parseEventText for simpler phrases.
 */
export async function handleCalendarText(ctx: Context): Promise<void> {
  const userId = getUserId(ctx);
  if (!userId) {
    await ctx.reply("Не удалось определить пользователя.");
    return;
  }
  if (!ctx.message || !("text" in ctx.message)) return;
  const text = typeof ctx.message.text === "string" ? ctx.message.text.trim() : "";
  if (!text) return;

  // First try simple chrono-node parsing (fast, no API call)
  const parsed = parseEventText(text);
  if (parsed) {
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
          log.error("Failed to save calendar event to DB:", dbErr);
        }
      }
      return;
    } catch (err) {
      if (err instanceof NoCalendarLinkedError) {
        await ctx.reply(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : "Ошибка календаря";
      await ctx.reply(`Ошибка: ${msg}`);
      return;
    }
  }

  // Fallback: use AI extraction for complex free-form text
  try {
    const intent = await extractVoiceIntent(text);

    // Handle list intents
    if (intent.type === "list_today" || intent.type === "list_week") {
      const now = new Date();
      const todayStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
      const timeMin = new Date(todayStr + "T00:00:00+03:00");
      const days = intent.type === "list_week" ? 7 : 1;
      const timeMax = new Date(timeMin.getTime() + days * 24 * 60 * 60 * 1000);
      const events = await listEvents(timeMin, timeMax, userId);
      if (events.length === 0) {
        await ctx.reply(intent.type === "list_week" ? "На эту неделю встреч нет." : "На сегодня встреч нет.");
        return;
      }
      const lines = events.map((e) => {
        const s = new Date(e.start);
        const en = new Date(e.end);
        const timeOpt = { hour: "2-digit" as const, minute: "2-digit" as const, timeZone: TIMEZONE_MSK };
        const dayPart = intent.type === "list_week"
          ? s.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: TIMEZONE_MSK }) + " "
          : "";
        return `• ${escapeMarkdown(e.summary)} (${dayPart}${s.toLocaleTimeString("ru-RU", timeOpt)} – ${en.toLocaleTimeString("ru-RU", timeOpt)})`;
      });
      const header = intent.type === "list_week" ? "📅 *Неделя:*" : "📅 *Сегодня:*";
      await replyMarkdownSafe(ctx, header + "\n" + lines.join("\n"));
      return;
    }

    if (intent.type === "calendar" && intent.events.length > 0) {
      for (const evData of intent.events) {
        try {
          const event = await createEvent(
            evData.title,
            evData.start,
            evData.end,
            userId,
            undefined,
            evData.recurrence,
          );
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
                  recurrence: evData.recurrence ?? null,
                  inputMethod: "text",
                  status: "created",
                  htmlLink: event.htmlLink ?? null,
                });
              }
            } catch (dbErr) {
              log.error("Failed to save calendar event to DB:", dbErr);
            }
          }
        } catch (err) {
          if (err instanceof NoCalendarLinkedError) {
            await ctx.reply(err.message);
            return;
          }
          log.error(`Failed to create event "${evData.title}":`, err);
          const msg = err instanceof Error ? err.message : "Ошибка календаря";
          await ctx.reply(`Ошибка: ${msg}`);
        }
      }
      return;
    }

    // Not recognized as calendar event
    await ctx.reply(
      "Не удалось разобрать событие. Попробуйте формат:\nВстреча с командой завтра в 15:00\n\nИли используйте /new перед фразой.",
    );
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      await ctx.reply(err.message);
      return;
    }
    log.error("Calendar text extraction failed:", err);
    const msg = err instanceof Error ? err.message : "Ошибка";
    await ctx.reply(`Ошибка: ${msg}`);
  }
}
