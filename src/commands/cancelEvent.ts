import type { Context } from "telegraf";
import { searchEvents, deleteEvent, NoCalendarLinkedError } from "../calendar/client.js";
import { markEventDeleted } from "../calendar/repository.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { escapeMarkdown } from "../utils/markdown.js";
import { getUserId } from "../utils/telegram.js";
import { TIMEZONE_MSK } from "../constants.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("calendar");

/**
 * Handle /cancel <query> — search and delete a calendar event by text.
 */
export async function handleCancel(ctx: Context): Promise<void> {
  const userId = getUserId(ctx);
  if (!userId) {
    await ctx.reply("Не удалось определить пользователя.");
    return;
  }

  if (!ctx.message || !("text" in ctx.message)) return;
  const query = typeof ctx.message.text === "string"
    ? ctx.message.text.replace(/^\/cancel\s*/i, "").trim()
    : "";

  if (!query) {
    await ctx.reply(
      "Укажите название или часть названия встречи.\nПример: /cancel врач"
    );
    return;
  }

  try {
    const now = new Date();
    const todayStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
    const timeMin = new Date(todayStr + "T00:00:00+03:00");
    const timeMax = new Date(timeMin.getTime() + 7 * 24 * 60 * 60 * 1000);

    const events = await searchEvents(query, timeMin, timeMax, userId);

    if (events.length === 0) {
      await ctx.reply(
        `Встречи не найдены по запросу «${query}» на ближайшую неделю.`
      );
      return;
    }

    if (events.length === 1) {
      const ev = events[0];
      await deleteEvent(ev.id, userId);
      log.info(`Event deleted: id=${ev.id}, summary="${ev.summary}", by user ${userId}`);

      if (isDatabaseAvailable() && ctx.from?.id) {
        try {
          const dbUser = await getUserByTelegramId(ctx.from.id);
          if (dbUser) {
            await markEventDeleted(ev.id, dbUser.id);
          }
        } catch (dbErr) {
          log.error("Failed to mark calendar event as deleted in DB:", dbErr);
        }
      }

      const start = new Date(ev.start);
      const timeStr = start.toLocaleString("ru-RU", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: TIMEZONE_MSK,
      });
      const safeSummary = escapeMarkdown(ev.summary);
      try {
        await ctx.replyWithMarkdown(`✅ Отменено: *${safeSummary}*\n${timeStr}`);
      } catch {
        await ctx.reply(`✅ Отменено: ${ev.summary}\n${timeStr}`);
      }
      return;
    }

    // Multiple events found — show list
    const listText = events.slice(0, 10).map((ev, i) => {
      const start = new Date(ev.start);
      const dateStr = start.toLocaleDateString("ru-RU", { dateStyle: "short", timeZone: TIMEZONE_MSK });
      const timeStr = start.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE_MSK });
      return `${i + 1}. ${ev.summary} (${dateStr}, ${timeStr})`;
    }).join("\n");

    await ctx.reply(
      `Найдено несколько встреч. Уточните запрос:\n\n${listText}\n\nНапример: /cancel ${query} завтра`
    );
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      await ctx.reply(err.message);
      return;
    }
    log.error("Error in /cancel:", err);
    const msg = err instanceof Error ? err.message : "Ошибка";
    await ctx.reply(`Ошибка: ${msg}`);
  }
}
