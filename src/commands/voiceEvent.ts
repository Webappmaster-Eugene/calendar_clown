import type { Context } from "telegraf";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import { createEvent, deleteEvent, searchEvents, listEvents, NoCalendarLinkedError } from "../calendar/client.js";
import { extractCalendarEvent } from "../calendar/extractViaOpenRouter.js";
import { saveCalendarEvent, markEventDeleted } from "../calendar/repository.js";
import { transcribeVoice } from "../voice/transcribe.js";
import { extractVoiceIntent } from "../voice/extractVoiceIntent.js";
import { extractExpenseIntent } from "../voice/extractExpenseIntent.js";
import { isExpenseMode, isTranscribeMode } from "../middleware/expenseMode.js";
import { handleVoiceExpense } from "./addExpense.js";
import { getCategories, getUserByTelegramId, listTribeUsers } from "../expenses/repository.js";
import { handleVoiceInTranscribeMode } from "./voiceTranscribe.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { escapeMarkdown } from "../utils/markdown.js";
import { getUserId } from "../utils/telegram.js";
import { TIMEZONE_MSK, VOICE_DIR } from "../constants.js";
import type { DbUser } from "../expenses/types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("voice");

export async function handleVoice(ctx: Context) {
  const userId = getUserId(ctx);
  if (!userId) return;

  if (!ctx.message) return;
  const voice = "voice" in ctx.message ? ctx.message.voice : null;
  if (!voice?.file_id) return;

  const statusMsg = await ctx.reply("Обрабатываю голосовое…");

  // Check transcribe mode early — before downloading, to route to the right handler
  const telegramId = ctx.from?.id;
  if (telegramId != null && await isTranscribeMode(telegramId)) {
    await handleVoiceInTranscribeMode(ctx, voice, statusMsg.message_id);
    return;
  }

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

    // If in expense mode, try expense extraction first
    if (telegramId != null && await isExpenseMode(telegramId)) {
      await handleVoiceInExpenseMode(ctx, transcript, statusMsg.message_id);
      return;
    }

    // Calendar mode — existing logic
    await handleVoiceInCalendarMode(ctx, transcript, statusMsg.message_id, userId);
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

async function handleVoiceInExpenseMode(
  ctx: Context,
  transcript: string,
  statusMsgId: number
): Promise<void> {
  const categories = await getCategories();
  const categoriesList = categories
    .map((c) => `- ${c.name}`)
    .join("\n");

  const result = await extractExpenseIntent(transcript, categoriesList);

  if (result.type === "not_expense") {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      "Это не похоже на трату. В режиме расходов отправляйте траты голосом, например: «Аптека геморрой пять тысяч»."
    );
    return;
  }

  if (result.type === "unknown") {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      "Не удалось разобрать трату из голосового сообщения. Назовите категорию, описание и сумму."
    );
    return;
  }

  await handleVoiceExpense(
    ctx,
    result.category,
    result.subcategory,
    result.amount,
    statusMsgId
  );
}

async function handleVoiceInCalendarMode(
  ctx: Context,
  transcript: string,
  statusMsgId: number,
  userId: string
): Promise<void> {
  let dbUser: DbUser | null = null;
  if (isDatabaseAvailable() && ctx.from?.id) {
    try {
      dbUser = await getUserByTelegramId(ctx.from.id);
    } catch (err) {
      log.error("Failed to resolve DB user for calendar event logging:", err);
    }
  }

  const intent = await extractVoiceIntent(transcript);

  if (intent.type === "cancel_event") {
    const timeZone = TIMEZONE_MSK;
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
        statusMsgId,
        undefined,
        `Встречи не найдены${intent.query ? ` по запросу «${intent.query}»` : ""} на ${rangeHint}.`
      );
      return;
    }

    if (events.length === 1) {
      const ev = events[0];
      await deleteEvent(ev.id, userId);

      if (dbUser) {
        try {
          await markEventDeleted(ev.id, dbUser.id);
        } catch (dbErr) {
          log.error("Failed to mark calendar event as deleted in DB:", dbErr);
        }
      }

      const start = new Date(ev.start);
      const timeStr = start.toLocaleString("ru-RU", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone,
      });
      const safeSummary = escapeMarkdown(ev.summary);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
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
      statusMsgId,
      undefined,
      `Найдено несколько встреч. Уточните, какую отменить:\n\n${listText}\n\nНазовите точнее: дату, время или название.`
    );
    return;
  }

  if (intent.type === "list_today") {
    const now = new Date();
    const todayStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
    const timeMin = new Date(todayStr + "T00:00:00+03:00");
    const timeMax = new Date(timeMin.getTime() + 24 * 60 * 60 * 1000);
    const events = await listEvents(timeMin, timeMax, userId);
    if (events.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsgId, undefined,
        "На сегодня встреч нет."
      );
      return;
    }
    const lines = events.map((e) => {
      const s = new Date(e.start);
      const en = new Date(e.end);
      const timeOpt = { hour: "2-digit" as const, minute: "2-digit" as const, timeZone: TIMEZONE_MSK };
      return `• ${escapeMarkdown(e.summary)} (${s.toLocaleTimeString("ru-RU", timeOpt)} – ${en.toLocaleTimeString("ru-RU", timeOpt)})`;
    });
    await ctx.telegram.editMessageText(
      ctx.chat!.id, statusMsgId, undefined,
      "📅 *Сегодня:*\n" + lines.join("\n"),
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (intent.type === "list_week") {
    const now = new Date();
    const todayStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
    const timeMin = new Date(todayStr + "T00:00:00+03:00");
    const timeMax = new Date(timeMin.getTime() + 7 * 24 * 60 * 60 * 1000);
    const events = await listEvents(timeMin, timeMax, userId);
    if (events.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsgId, undefined,
        "На эту неделю встреч нет."
      );
      return;
    }
    const lines: string[] = [];
    let currentDay = "";
    for (const e of events) {
      const d = new Date(e.start);
      const dayKey = d.toLocaleDateString("ru-RU", {
        weekday: "short", day: "numeric", month: "short", timeZone: TIMEZONE_MSK,
      });
      if (dayKey !== currentDay) {
        currentDay = dayKey;
        lines.push(`\n*${escapeMarkdown(dayKey)}*`);
      }
      const en = new Date(e.end);
      const timeOpt = { hour: "2-digit" as const, minute: "2-digit" as const, timeZone: TIMEZONE_MSK };
      lines.push(`• ${escapeMarkdown(e.summary)} (${d.toLocaleTimeString("ru-RU", timeOpt)} – ${en.toLocaleTimeString("ru-RU", timeOpt)})`);
    }
    await ctx.telegram.editMessageText(
      ctx.chat!.id, statusMsgId, undefined,
      "📅 *Неделя:*" + lines.join("\n"),
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (intent.type === "broadcast") {
    const adminId = process.env.ADMIN_TELEGRAM_ID;
    if (!adminId || userId !== adminId) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsgId, undefined,
        "Рассылка доступна только администратору."
      );
      return;
    }
    if (!isDatabaseAvailable()) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsgId, undefined,
        "Рассылка недоступна (нет подключения к БД)."
      );
      return;
    }
    const adminUser = await getUserByTelegramId(parseInt(adminId, 10));
    const tribeId = adminUser?.tribeId ?? 1;
    const allUsers = await listTribeUsers(tribeId);
    const recipients = allUsers
      .map((u) => String(u.telegramId))
      .filter((id) => id !== adminId);
    if (recipients.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsgId, undefined,
        "Нет пользователей для рассылки."
      );
      return;
    }
    let sent = 0;
    let failed = 0;
    for (const recipientId of recipients) {
      try {
        await ctx.telegram.sendMessage(recipientId, intent.message);
        sent++;
      } catch {
        failed++;
      }
    }
    const result = `Рассылка завершена: отправлено ${sent}` +
      (failed > 0 ? `, не удалось ${failed}` : "") +
      ` из ${recipients.length}.`;
    await ctx.telegram.editMessageText(
      ctx.chat!.id, statusMsgId, undefined, result
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
      const timeZone = TIMEZONE_MSK;
      const timeStr = start.toLocaleString("ru-RU", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone,
      });
      const endStr = end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone });
      const recurringHint = fallback.recurrence?.length ? " (еженедельно)" : "";
      const safeSummary = escapeMarkdown(event.summary);
      const text =
        `Создано: *${safeSummary}*${recurringHint}\n${timeStr} – ${endStr}` +
        (event.htmlLink ? `\n[Открыть в календаре](${event.htmlLink})` : "");

      if (dbUser) {
        try {
          await saveCalendarEvent({
            userId: dbUser.id,
            tribeId: dbUser.tribeId,
            googleEventId: event.id ?? null,
            summary: event.summary,
            startTime: start,
            endTime: end,
            recurrence: fallback.recurrence ?? null,
            inputMethod: "voice",
            status: "created",
            htmlLink: event.htmlLink ?? null,
          });
        } catch (dbErr) {
          log.error("Failed to save calendar event to DB:", dbErr);
        }
      }

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        text,
        { parse_mode: "Markdown" }
      );
      return;
    }
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
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
  const safeSummary = escapeMarkdown(event.summary);
  const text =
    `Создано: *${safeSummary}*${recurringHint}\n${timeStr} – ${endStr}` +
    (event.htmlLink ? `\n[Открыть в календаре](${event.htmlLink})` : "");

  if (dbUser) {
    try {
      await saveCalendarEvent({
        userId: dbUser.id,
        tribeId: dbUser.tribeId,
        googleEventId: event.id ?? null,
        summary: event.summary,
        startTime: start,
        endTime: end,
        recurrence: intent.recurrence ?? null,
        inputMethod: "voice",
        status: "created",
        htmlLink: event.htmlLink ?? null,
      });
    } catch (dbErr) {
      log.error("Failed to save calendar event to DB:", dbErr);
    }
  }

  await ctx.telegram.editMessageText(
    ctx.chat!.id,
    statusMsgId,
    undefined,
    text,
    { parse_mode: "Markdown" }
  );
}
