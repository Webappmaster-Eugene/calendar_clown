import type { Context } from "telegraf";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import { createEvent, deleteEvent, searchEvents, NoCalendarLinkedError } from "../calendar/client.js";
import { extractCalendarEvent } from "../calendar/extractViaOpenRouter.js";
import { transcribeVoice } from "../voice/transcribe.js";
import { extractVoiceIntent } from "../voice/extractVoiceIntent.js";

const VOICE_DIR = "./data/voice";

function getUserId(ctx: Context): string | null {
  const id = ctx.from?.id ?? ctx.chat?.id;
  return id != null ? String(id) : null;
}

export async function handleVoice(ctx: Context) {
  const userId = getUserId(ctx);
  if (!userId) return;

  const voice = "voice" in ctx.message ? ctx.message.voice : null;
  if (!voice?.file_id) return;

  const statusMsg = await ctx.reply("Обрабатываю голосовое…");

  let filePath: string | null = null;
  try {
    const link = await ctx.telegram.getFileLink(voice.file_id);
    const res = await fetch(link.toString());
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir(VOICE_DIR, { recursive: true });
    filePath = join(VOICE_DIR, `voice_${voice.file_unique_id}.ogg`);
    const { writeFile } = await import("fs/promises");
    await writeFile(filePath, buffer);
  } catch (e) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      "Не удалось скачать голосовое сообщение."
    );
    return;
  }

  try {
    const transcript = await transcribeVoice(filePath);
    await unlink(filePath).catch(() => {});
    filePath = null;

    if (!transcript) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        "Не удалось распознать речь."
      );
      return;
    }

    const intent = await extractVoiceIntent(transcript);

    if (intent.type === "cancel_event") {
      const timeZone = "Europe/Moscow";
      let timeMin: Date;
      let timeMax: Date;
      if (intent.date) {
        timeMin = intent.date;
        timeMax = new Date(timeMin.getTime() + 24 * 60 * 60 * 1000);
      } else {
        const nowMsk = new Date();
        const todayStr = nowMsk.toLocaleDateString("en-CA", { timeZone });
        timeMin = new Date(todayStr + "T00:00:00+03:00");
        timeMax = new Date(timeMin.getTime() + 7 * 24 * 60 * 60 * 1000);
      }

      const events = await searchEvents(intent.query, timeMin, timeMax, userId);

      if (events.length === 0) {
        const rangeHint = intent.date
          ? intent.date.toLocaleDateString("ru-RU", { dateStyle: "long", timeZone })
          : "ближайшую неделю";
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          `Встречи не найдены${intent.query ? ` по запросу «${intent.query}»` : ""} на ${rangeHint}.`
        );
        return;
      }

      if (events.length === 1) {
        const ev = events[0];
        await deleteEvent(ev.id, userId);
        const start = new Date(ev.start);
        const timeStr = start.toLocaleString("ru-RU", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone,
        });
        const safeSummary = ev.summary.replace(/([*_`\[\]])/g, "\\$1");
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          `Отменено: *${safeSummary}*\n${timeStr}`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      const listText = events.slice(0, 10).map((ev, i) => {
        const start = new Date(ev.start);
        const dateStr = start.toLocaleDateString("ru-RU", { dateStyle: "short", timeZone });
        const timeStr = start.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone });
        return `${i + 1}. ${ev.summary} (${dateStr}, ${timeStr})`;
      }).join("\n");
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        `Найдено несколько встреч. Уточните, какую отменить:\n\n${listText}\n\nНазовите точнее: дату, время или название.`
      );
      return;
    }

    if (intent.type === "unknown") {
      const fallback = await extractCalendarEvent(transcript);
      if (fallback) {
        const event = await createEvent(
          fallback.title,
          fallback.start,
          fallback.end,
          userId,
          undefined,
          fallback.recurrence
        );
        const start = new Date(event.start);
        const end = new Date(event.end);
        const timeZone = "Europe/Moscow";
        const timeStr = start.toLocaleString("ru-RU", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone,
        });
        const endStr = end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone });
        const recurringHint = fallback.recurrence?.length ? " (еженедельно)" : "";
        const text =
          `Создано: *${event.summary}*${recurringHint}\n${timeStr} – ${endStr}` +
          (event.htmlLink ? `\n[Открыть в календаре](${event.htmlLink})` : "");
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          text,
          { parse_mode: "Markdown" }
        );
        return;
      }
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        "Не удалось разобрать запись. Опишите встречу подробнее: с кем, о чём и когда (день и время). Например: «Запись к Роману на ремонт во вторник в 10 утра» или «Встреча завтра в 15:00»."
      );
      return;
    }

    const event = await createEvent(
      intent.title,
      intent.start,
      intent.end,
      userId,
      undefined,
      intent.recurrence
    );
    const start = new Date(event.start);
    const end = new Date(event.end);
    const timeZone = "Europe/Moscow";
    const timeStr = start.toLocaleString("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone,
    });
    const endStr = end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone });
    const recurringHint = intent.recurrence?.length ? " (еженедельно)" : "";
    const text =
      `Создано: *${event.summary}*${recurringHint}\n${timeStr} – ${endStr}` +
      (event.htmlLink ? `\n[Открыть в календаре](${event.htmlLink})` : "");

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      text,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    if (filePath) await unlink(filePath).catch(() => {});
    if (err instanceof NoCalendarLinkedError) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        err.message
      );
      return;
    }
    const msg = err instanceof Error ? err.message : "Ошибка";
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      `Ошибка: ${msg}`
    );
  }
}
