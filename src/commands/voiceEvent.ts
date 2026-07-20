import type { Context } from "telegraf";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import { Markup } from "telegraf";
import { createEvent, deleteEvent, searchEvents, NoCalendarLinkedError } from "../calendar/client.js";
import { formatEventRange } from "../services/calendarService.js";
import { extractCalendarEvents } from "../calendar/extractViaOpenRouter.js";
import { saveCalendarEvent, markEventDeleted } from "../calendar/repository.js";
import { transcribeVoice } from "../voice/transcribe.js";
import type { TranscribeContext } from "../voice/transcribe.js";
import { SttError } from "../voice/sttClient.js";
import { extractVoiceIntent } from "../voice/extractVoiceIntent.js";
import { extractExpenseIntent } from "../voice/extractExpenseIntent.js";
import { getUserMode, isExpenseMode, isTranscribeMode, isBroadcastMode, isGandalfMode, isWishlistMode, isGoalsMode, isRemindersMode, isOsintMode, isSummarizerMode, isBloggerMode, isNeuroMode, isSimplifierMode, isTasksMode } from "../middleware/userMode.js";
import { handleGoalsVoice } from "./goalsMode.js";
import { handleTasksVoice } from "./tasksMode.js";
import { handleRemindersVoice } from "./remindersMode.js";
import { handleSummarizerVoice } from "./summarizerMode.js";
import { handleBloggerVoice } from "./bloggerMode.js";
import { handleSimplifierVoice } from "./simplifierMode.js";
import { handleVoiceExpense } from "./addExpense.js";
import { getCategories, getUserByTelegramId } from "../expenses/repository.js";
import { telegramFetch } from "../utils/proxyAgent.js";
import { handleVoiceInTranscribeMode } from "./voiceTranscribe.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { broadcastToTribe, formatBroadcastResult } from "../broadcast/service.js";
import { handleGandalfVoice } from "./gandalfMode.js";
import { handleOsintVoice } from "./osintMode.js";
import { handleNeuroVoice } from "./chatMode.js";
import { escapeMarkdown } from "../utils/markdown.js";
import { getUserId } from "../utils/telegram.js";
import { TIMEZONE_MSK, VOICE_DIR } from "../constants.js";
import type { DbUser } from "../expenses/types.js";
import { createLogger } from "../utils/logger.js";
import { truncateText } from "../utils/uiKit.js";
import { logAction } from "../logging/actionLogger.js";

const log = createLogger("voice");

export async function handleVoice(ctx: Context) {
  try {
    await handleVoiceInner(ctx);
  } catch (err) {
    log.error("Unhandled error in handleVoice:", err);
    try {
      await ctx.reply("Произошла ошибка при обработке голосового сообщения. Попробуйте ещё раз.");
    } catch {
      // reply failed — nothing we can do
    }
  }
}

async function handleVoiceInner(ctx: Context): Promise<void> {
  const userId = getUserId(ctx);
  if (!userId) return;

  if (!ctx.message) return;
  const voice = "voice" in ctx.message ? ctx.message.voice : null;
  if (!voice?.file_id) return;

  const statusMsg = await ctx.reply("Обрабатываю голосовое…");

  const telegramId = ctx.from?.id;
  logAction(null, telegramId ?? 0, "voice_message_received", { duration: voice.duration });
  if (telegramId != null && await isWishlistMode(telegramId)) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      "В режиме Вишлист голосовые сообщения не поддерживаются. Используйте текст."
    );
    return;
  }

  // Check transcribe mode early — before downloading, to route to the right handler
  if (telegramId != null && await isTranscribeMode(telegramId)) {
    try {
      await handleVoiceInTranscribeMode(ctx, voice, statusMsg.message_id);
    } catch (err) {
      log.error("Error in transcribe mode handler:", err);
      try {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          "Ошибка при обработке голосового. Попробуйте ещё раз."
        );
      } catch (editErr) {
        log.error("Failed to edit status message after transcribe error:", editErr);
        try {
          await ctx.reply("Ошибка при обработке голосового. Попробуйте ещё раз.");
        } catch (replyErr) {
          log.error("Failed to send fallback error reply:", replyErr);
        }
      }
    }
    return;
  }

  let filePath: string | null = null;
  try {
    const link = await ctx.telegram.getFileLink(voice.file_id);
    const res = await telegramFetch(link.toString());
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
    let sttContext: TranscribeContext = "calendar";
    if (telegramId != null) {
      const currentMode = await getUserMode(telegramId);
      if (currentMode === "expenses") {
        sttContext = "expense";
      } else if (currentMode === "tasks") {
        sttContext = "tasks";
      } else if (currentMode !== "calendar") {
        sttContext = "general";
      }
    }

    const transcript = await transcribeVoice(filePath, sttContext);
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

    if (telegramId != null && await isNeuroMode(telegramId)) {
      await handleNeuroVoice(ctx, transcript, statusMsg.message_id);
      return;
    }

    if (telegramId != null && await isGandalfMode(telegramId)) {
      await handleGandalfVoice(ctx, transcript, statusMsg.message_id);
      return;
    }

    if (telegramId != null && await isOsintMode(telegramId)) {
      await handleOsintVoice(ctx, transcript, statusMsg.message_id);
      return;
    }

    if (telegramId != null && await isGoalsMode(telegramId)) {
      await handleGoalsVoice(ctx, transcript, statusMsg.message_id);
      return;
    }

    if (telegramId != null && await isTasksMode(telegramId)) {
      await handleTasksVoice(ctx, transcript, statusMsg.message_id);
      return;
    }

    if (telegramId != null && await isRemindersMode(telegramId)) {
      await handleRemindersVoice(ctx, transcript, statusMsg.message_id);
      return;
    }

    if (telegramId != null && await isSummarizerMode(telegramId)) {
      await handleSummarizerVoice(ctx, transcript, statusMsg.message_id);
      return;
    }

    if (telegramId != null && await isSimplifierMode(telegramId)) {
      await handleSimplifierVoice(ctx, transcript, statusMsg.message_id);
      return;
    }

    if (telegramId != null && await isBloggerMode(telegramId)) {
      await handleBloggerVoice(ctx, transcript, statusMsg.message_id);
      return;
    }

    if (telegramId != null && await isExpenseMode(telegramId)) {
      await handleVoiceInExpenseMode(ctx, transcript, statusMsg.message_id);
      return;
    }

    if (telegramId != null && await isBroadcastMode(telegramId) && isBootstrapAdmin(telegramId)) {
      await handleVoiceInBroadcastMode(ctx, transcript, statusMsg.message_id, telegramId);
      return;
    }

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
    if (err instanceof SttError) {
      log.error(`STT failed: model=${err.model}, status=${err.status}, raw=${err.raw}`);
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
    .map((c) => {
      const aliasStr = c.aliases.length > 0
        ? ` (aliases: ${c.aliases.join(", ")})`
        : "";
      return `- ${c.name}${aliasStr}`;
    })
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

async function handleVoiceInBroadcastMode(
  ctx: Context,
  transcript: string,
  statusMsgId: number,
  telegramId: number
): Promise<void> {
  const sendMessage = async (recipientId: string, text: string): Promise<void> => {
    await ctx.telegram.sendMessage(recipientId, text);
  };

  try {
    const result = await broadcastToTribe(sendMessage, telegramId, transcript);
    const safeTranscript = escapeMarkdown(transcript);
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      `🎤 Расшифровка: "${safeTranscript}"\n\n${formatBroadcastResult(result)}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка рассылки";
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      msg
    );
  }
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

  const safeTranscript = escapeMarkdown(truncateText(transcript, 500));
  const transcriptLine = `🎤 Расшифровка: "${safeTranscript}"\n\n`;

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
        transcriptLine + `Встречи не найдены${intent.query ? ` по запросу «${intent.query}»` : ""} на ${rangeHint}.`
      );
      return;
    }

    if (events.length === 1) {
      const ev = events[0];

      if (ev.recurringEventId) {
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
          transcriptLine + `🔄 *Это повторяющееся событие:*\n*${safeSummary}*\n${timeStr}\n\nЧто удалить?`,
          { parse_mode: "Markdown" }
        );
        await ctx.reply("Выберите:", {
          ...Markup.inlineKeyboard([
            Markup.button.callback("Только это", `cancel_recurring:single:${ev.id}`),
            Markup.button.callback("Все повторы", `cancel_recurring:all:${ev.recurringEventId}`),
          ]),
        });
        return;
      }

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
        transcriptLine + `Отменено: *${safeSummary}*\n${timeStr}`,
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
      transcriptLine + `Найдено несколько встреч. Уточните, какую отменить:\n\n${listText}\n\nНазовите точнее: дату, время или название.`
    );
    return;
  }

  if (intent.type === "list_range") {
    const view = await formatEventRange(userId, intent.from, intent.days, intent.label);
    if (view.isEmpty) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsgId, undefined,
        transcriptLine + view.emptyText
      );
      return;
    }
    await ctx.telegram.editMessageText(
      ctx.chat!.id, statusMsgId, undefined,
      transcriptLine + view.text,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (intent.type === "unknown") {
    const fallbackEvents = await extractCalendarEvents(transcript);
    const fallback = fallbackEvents[0] ?? null;
    if (fallback) {
      const createdLines = await createAndSaveEvents(ctx, [fallback], userId, dbUser);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        transcriptLine + createdLines,
        { parse_mode: "Markdown" }
      );
      return;
    }
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      transcriptLine + "Не удалось разобрать запись. Опишите встречу подробнее: с кем, о чём и когда (день и время). Например: «Запись к Роману на ремонт во вторник в 10 утра» или «Встреча завтра в 15:00»."
    );
    return;
  }

  const eventsData = intent.events;
  const createdLines = await createAndSaveEvents(ctx, eventsData, userId, dbUser);
  await ctx.telegram.editMessageText(
    ctx.chat!.id,
    statusMsgId,
    undefined,
    transcriptLine + createdLines,
    { parse_mode: "Markdown" }
  );
}

function formatRecurrenceLabel(recurrence: string[]): string {
  const rule = recurrence[0] ?? "";
  if (rule.includes("FREQ=DAILY")) return "ежедневно";
  if (rule.includes("FREQ=MONTHLY")) return "ежемесячно";
  if (rule.includes("FREQ=YEARLY")) return "ежегодно";
  // FREQ=WEEKLY is the default/most common
  return "еженедельно";
}

async function createAndSaveEvents(
  ctx: Context,
  eventsData: Array<{ title: string; start: Date; end: Date; recurrence?: string[] }>,
  userId: string,
  dbUser: DbUser | null
): Promise<string> {
  const timeZone = TIMEZONE_MSK;
  const lines: string[] = [];
  let failCount = 0;

  for (const evData of eventsData) {
    try {
      const event = await createEvent(
        evData.title,
        evData.start,
        evData.end,
        userId,
        undefined,
        evData.recurrence
      );
      const start = new Date(event.start);
      const end = new Date(event.end);
      const timeStr = start.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone });
      const endStr = end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone });
      const recurringHint = evData.recurrence?.length ? ` (${formatRecurrenceLabel(evData.recurrence)})` : "";
      const safeSummary = escapeMarkdown(event.summary);
      let line = `Создано: *${safeSummary}*${recurringHint}\n${timeStr} – ${endStr}`;
      if (event.htmlLink) line += `\n[Открыть в календаре](${event.htmlLink})`;
      lines.push(line);

      if (dbUser) {
        try {
          await saveCalendarEvent({
            userId: dbUser.id,
            tribeId: dbUser.tribeId,
            googleEventId: event.id ?? null,
            summary: event.summary,
            startTime: start,
            endTime: end,
            recurrence: evData.recurrence ?? null,
            inputMethod: "voice",
            status: "created",
            htmlLink: event.htmlLink ?? null,
          });
        } catch (dbErr) {
          log.error("Failed to save calendar event to DB:", dbErr);
        }
      }
    } catch (err) {
      failCount++;
      log.error(`Failed to create event "${evData.title}":`, err);
    }
  }

  if (lines.length === 0) return "Не удалось создать событие.";
  const result = lines.join("\n\n");
  if (failCount > 0) return result + `\n\n⚠️ Не удалось создать: ${failCount}`;
  return result;
}
