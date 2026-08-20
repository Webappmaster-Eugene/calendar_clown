import { Markup, type Context } from "telegraf";
import type { Voice } from "telegraf/types";
import { mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { isDatabaseAvailable } from "../db/connection.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import {
  createTranscription,
  countPendingForUser,
  getTranscriptionByFileUniqueIdForUser,
  getTranscriptionByIdForUser,
  deleteTranscription,
} from "../transcribe/repository.js";
import { addTranscribeJob, isTranscribeAvailable } from "../transcribe/queue.js";
import { isImplausiblyShortTranscript } from "../voice/sttClient.js";
import { checkCostlyRateLimit, COSTLY_LIMIT_MESSAGE } from "../middleware/rateLimit.js";
import { VOICE_DIR } from "../constants.js";
import { splitMessage } from "../utils/telegram.js";
import { telegramFetch } from "../utils/proxyAgent.js";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";

const log = createLogger("transcribe");

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getForwardedFromName(ctx: Context): string | null {
  if (!ctx.message) return null;
  const msg = ctx.message as unknown as Record<string, unknown>;

  // Telegraf v4: forward_origin for newer Bot API versions
  if (msg.forward_origin && typeof msg.forward_origin === "object") {
    const origin = msg.forward_origin as Record<string, unknown>;
    if (origin.type === "user" && origin.sender_user && typeof origin.sender_user === "object") {
      const user = origin.sender_user as { first_name?: string; last_name?: string };
      return [user.first_name, user.last_name].filter(Boolean).join(" ") || null;
    }
    if (origin.type === "hidden_user" && typeof origin.sender_user_name === "string") {
      return origin.sender_user_name;
    }
    if (origin.type === "channel" && origin.chat && typeof origin.chat === "object") {
      return (origin.chat as { title?: string }).title ?? null;
    }
  }

  // Legacy fields
  if (msg.forward_from && typeof msg.forward_from === "object") {
    const user = msg.forward_from as { first_name?: string; last_name?: string };
    return [user.first_name, user.last_name].filter(Boolean).join(" ") || null;
  }
  if (typeof msg.forward_sender_name === "string") {
    return msg.forward_sender_name;
  }

  return null;
}

function getForwardedDate(ctx: Context): Date | null {
  if (!ctx.message) return null;
  const msg = ctx.message as unknown as Record<string, unknown>;

  if (msg.forward_origin && typeof msg.forward_origin === "object") {
    const origin = msg.forward_origin as { date?: number };
    if (typeof origin.date === "number") {
      return new Date(origin.date * 1000);
    }
  }

  if (typeof msg.forward_date === "number") {
    return new Date(msg.forward_date * 1000);
  }

  return null;
}

async function editStatus(ctx: Context, statusMessageId: number, text: string): Promise<void> {
  try {
    await ctx.telegram.editMessageText(ctx.chat!.id, statusMessageId, undefined, text);
  } catch (editErr) {
    log.error("Transcribe: failed to edit status message:", editErr);
    try {
      await ctx.reply(text);
    } catch {
      // Both edit and reply failed — nothing left to try
    }
  }
}

interface EnqueueParams {
  ctx: Context;
  userId: number;
  telegramId: number;
  fileId: string;
  fileUniqueId: string;
  durationSeconds: number;
  fileSizeBytes: number | null;
  forwardedFromName: string | null;
  forwardedDate: Date | null;
  statusMessageId: number;
  sequenceNumber: number;
  /** Dropped once the audio is safely downloaded — frees the (user, file) unique key for the new row. */
  replaceTranscriptionId?: number;
}

/** Shared by the incoming-voice path and the re-transcribe button. */
async function enqueueTranscription(p: EnqueueParams): Promise<void> {
  const { ctx, fileUniqueId, statusMessageId } = p;
  const chatId = ctx.chat!.id;

  log.info(`Transcribe: downloading OGG for file ${fileUniqueId}`);
  let filePath: string;
  try {
    const link = await ctx.telegram.getFileLink(p.fileId);
    const res = await telegramFetch(link.toString(), { timeoutMs: 180_000 });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir(VOICE_DIR, { recursive: true });
    filePath = join(VOICE_DIR, `tr_${fileUniqueId}.ogg`);
    await writeFile(filePath, buffer);
  } catch (dlErr) {
    log.error("Transcribe: download failed:", dlErr);
    await editStatus(ctx, statusMessageId, "Не удалось скачать голосовое сообщение.");
    return;
  }

  log.info(`Transcribe: saving to DB for file ${fileUniqueId}`);
  let transcription;
  try {
    if (p.replaceTranscriptionId != null) {
      await deleteTranscription(p.replaceTranscriptionId);
    }
    transcription = await createTranscription({
      userId: p.userId,
      telegramFileId: p.fileId,
      telegramFileUniqueId: fileUniqueId,
      durationSeconds: p.durationSeconds,
      fileSizeBytes: p.fileSizeBytes,
      forwardedFromName: p.forwardedFromName,
      forwardedDate: p.forwardedDate,
      audioFilePath: filePath,
      sequenceNumber: p.sequenceNumber,
      chatId,
      statusMessageId,
    });
  } catch (err) {
    await unlink(filePath).catch(() => {});
    log.error("Failed to create transcription record:", err);
    await editStatus(ctx, statusMessageId, "Ошибка сохранения. Попробуйте ещё раз.");
    return;
  }

  log.info(`Transcribe: enqueueing job for transcription ${transcription.id}`);
  try {
    await addTranscribeJob({
      transcriptionId: transcription.id,
      filePath,
      chatId,
      statusMessageId,
      durationSeconds: p.durationSeconds,
      sequenceNumber: p.sequenceNumber,
      userId: p.userId,
    });
  } catch (err) {
    await unlink(filePath).catch(() => {});
    await deleteTranscription(transcription.id).catch(() => {});
    log.error("Failed to enqueue transcription job:", err);
    await editStatus(ctx, statusMessageId, "Не удалось поставить в очередь. Попробуйте ещё раз.");
    return;
  }

  logAction(p.userId, p.telegramId, "transcribe_queue_add", {
    transcriptionId: transcription.id,
    durationSeconds: p.durationSeconds,
    forwarded: !!p.forwardedFromName,
    retry: p.replaceTranscriptionId != null,
  });

  try {
    const pendingCount = await countPendingForUser(p.userId);
    const durationStr = formatDuration(p.durationSeconds);
    const queueHint = pendingCount > 1 ? ` (в очереди: ${pendingCount})` : "";
    const forwardHint = p.forwardedFromName ? `\nОт: ${p.forwardedFromName}` : "";

    await ctx.telegram.editMessageText(
      chatId,
      statusMessageId,
      undefined,
      `⏳ Голосовое (${durationStr}) поставлено в очередь${queueHint}${forwardHint}`
    );
  } catch (err) {
    // Job is already enqueued — status update failure is non-critical
    log.error("Failed to update status message after enqueue:", err);
  }
}

export async function handleVoiceInTranscribeMode(
  ctx: Context,
  voice: Voice,
  statusMessageId: number
): Promise<void> {
  log.info(`Transcribe mode: starting for user ${ctx.from?.id ?? "?"}, file ${voice.file_unique_id}`);

  if (!isDatabaseAvailable() || !isTranscribeAvailable()) {
    await editStatus(ctx, statusMessageId, "Режим транскрибатора временно недоступен.");
    return;
  }

  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await editStatus(ctx, statusMessageId, "Пользователь не найден. Попробуйте /start.");
    return;
  }

  const existing = await getTranscriptionByFileUniqueIdForUser(voice.file_unique_id, dbUser.id);
  if (existing) {
    if (existing.status === "completed" && existing.transcript) {
      // A truncated result must not be cached forever: re-sending the voice message is
      // the user's only way to recover, so treat it as absent and transcribe again.
      if (isImplausiblyShortTranscript(existing.transcript, existing.durationSeconds)) {
        log.warn(
          `Transcribe: discarding cached transcript for ${voice.file_unique_id} ` +
            `(${existing.transcript.length} chars for ${existing.durationSeconds}s) and re-queueing`
        );
        await deleteTranscription(existing.id);
      } else {
        // Header and body are split on purpose: the transcript is raw user speech, so it
        // must not go through a parse_mode (stray * or _ → 400) and may exceed one message.
        try {
          await ctx.telegram.editMessageText(
            ctx.chat!.id,
            statusMessageId,
            undefined,
            "📝 Ранее расшифровано:",
            Markup.inlineKeyboard([
              [Markup.button.callback("🔄 Расшифровать заново", `tr_redo:${existing.id}`)],
            ])
          );
        } catch (err) {
          log.error("Transcribe: failed to render cached-result header:", err);
        }
        for (const chunk of splitMessage(existing.transcript)) {
          await ctx.reply(chunk);
        }
        return;
      }
    } else if (existing.status === "pending" || existing.status === "processing") {
      await editStatus(ctx, statusMessageId, "⏳ Голосовое уже в очереди, ожидайте результат.");
      return;
    } else {
      // Failed / transcript-less record: drop it so the re-queue below can recreate it
      await deleteTranscription(existing.id);
    }
  }

  await enqueueTranscription({
    ctx,
    userId: dbUser.id,
    telegramId,
    fileId: voice.file_id,
    fileUniqueId: voice.file_unique_id,
    durationSeconds: voice.duration,
    fileSizeBytes: voice.file_size ?? null,
    forwardedFromName: getForwardedFromName(ctx),
    forwardedDate: getForwardedDate(ctx),
    statusMessageId,
    // message_id as sequence number for ordered delivery
    sequenceNumber: ctx.message!.message_id,
  });
}

/** "🔄 Расшифровать заново" under a cached result — re-runs STT on the same audio. */
export async function handleTranscribeRedoCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const match = ctx.callbackQuery.data.match(/^tr_redo:(\d+)$/);
  if (!match) {
    await ctx.answerCbQuery();
    return;
  }

  const telegramId = ctx.from?.id;
  if (telegramId == null) {
    await ctx.answerCbQuery();
    return;
  }

  if (!isDatabaseAvailable() || !isTranscribeAvailable()) {
    await ctx.answerCbQuery("Режим транскрибатора временно недоступен.");
    return;
  }

  // The retry costs another STT call, so it goes through the same budget guard as voice input.
  if (!checkCostlyRateLimit(telegramId)) {
    await ctx.answerCbQuery(COSTLY_LIMIT_MESSAGE);
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден.");
    return;
  }

  const transcriptionId = parseInt(match[1], 10);
  const existing = await getTranscriptionByIdForUser(transcriptionId, dbUser.id);
  if (!existing) {
    await ctx.answerCbQuery("Запись не найдена.");
    return;
  }
  if (existing.status === "pending" || existing.status === "processing") {
    await ctx.answerCbQuery("Уже в очереди.");
    return;
  }

  const statusMessage = ctx.callbackQuery.message;
  if (!statusMessage || !ctx.chat) {
    await ctx.answerCbQuery("Сообщение недоступно.");
    return;
  }

  await ctx.answerCbQuery("Ставлю в очередь…");
  // Drops the inline keyboard too, so the retry cannot be fired twice.
  await editStatus(ctx, statusMessage.message_id, "⏳ Ставлю в очередь заново…");

  log.info(`Transcribe redo: user ${telegramId}, transcription ${transcriptionId}, file ${existing.telegramFileUniqueId}`);

  await enqueueTranscription({
    ctx,
    userId: dbUser.id,
    telegramId,
    fileId: existing.telegramFileId,
    fileUniqueId: existing.telegramFileUniqueId,
    durationSeconds: existing.durationSeconds,
    fileSizeBytes: existing.fileSizeBytes,
    forwardedFromName: existing.forwardedFromName,
    forwardedDate: existing.forwardedDate,
    statusMessageId: statusMessage.message_id,
    sequenceNumber: statusMessage.message_id,
    replaceTranscriptionId: existing.id,
  });
}
