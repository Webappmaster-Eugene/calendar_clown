/**
 * Voice message handler for the transcribe mode.
 * Downloads the OGG file, saves metadata to DB, and enqueues a BullMQ job
 * for high-quality transcription.
 */

import type { Context } from "telegraf";
import type { Voice } from "telegraf/types";
import { mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { isDatabaseAvailable } from "../db/connection.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { createTranscription, transcriptionExists, countPendingForUser } from "../transcribe/repository.js";
import { addTranscribeJob, isTranscribeAvailable } from "../transcribe/queue.js";
import { VOICE_DIR } from "../constants.js";

/** Format duration in seconds to "M:SS" string. */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Extract forwarded-from name from message context (if forwarded). */
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

/** Extract forwarded date from message context (if forwarded). */
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

/**
 * Handle a voice message in transcribe mode.
 * Downloads the file, creates a DB record, and enqueues the transcription job.
 */
export async function handleVoiceInTranscribeMode(
  ctx: Context,
  voice: Voice,
  statusMessageId: number
): Promise<void> {
  if (!isDatabaseAvailable() || !isTranscribeAvailable()) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMessageId,
      undefined,
      "Режим транскрибатора временно недоступен."
    );
    return;
  }

  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  // Resolve DB user
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMessageId,
      undefined,
      "Пользователь не найден. Попробуйте /start."
    );
    return;
  }

  // Deduplication check
  const alreadyExists = await transcriptionExists(voice.file_unique_id);
  if (alreadyExists) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMessageId,
      undefined,
      "Это голосовое уже было обработано ранее."
    );
    return;
  }

  // Download OGG file
  let filePath: string;
  try {
    const link = await ctx.telegram.getFileLink(voice.file_id);
    const res = await fetch(link.toString());
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir(VOICE_DIR, { recursive: true });
    filePath = join(VOICE_DIR, `tr_${voice.file_unique_id}.ogg`);
    await writeFile(filePath, buffer);
  } catch {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMessageId,
      undefined,
      "Не удалось скачать голосовое сообщение."
    );
    return;
  }

  // Extract forwarded message info
  const forwardedFromName = getForwardedFromName(ctx);
  const forwardedDate = getForwardedDate(ctx);

  // Save to DB
  let transcription;
  try {
    transcription = await createTranscription({
      userId: dbUser.id,
      telegramFileId: voice.file_id,
      telegramFileUniqueId: voice.file_unique_id,
      durationSeconds: voice.duration,
      fileSizeBytes: voice.file_size ?? null,
      forwardedFromName,
      forwardedDate,
      audioFilePath: filePath,
    });
  } catch (err) {
    await unlink(filePath).catch(() => {});
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMessageId,
      undefined,
      "Ошибка сохранения. Попробуйте ещё раз."
    );
    console.error("Failed to create transcription record:", err);
    return;
  }

  // Enqueue BullMQ job
  try {
    await addTranscribeJob({
      transcriptionId: transcription.id,
      filePath,
      chatId: ctx.chat!.id,
      statusMessageId,
    });
  } catch (err) {
    await unlink(filePath).catch(() => {});
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMessageId,
      undefined,
      "Не удалось поставить в очередь. Попробуйте ещё раз."
    );
    console.error("Failed to enqueue transcription job:", err);
    return;
  }

  // Show queue position to the user
  const pendingCount = await countPendingForUser(dbUser.id);
  const durationStr = formatDuration(voice.duration);
  const queueHint = pendingCount > 1 ? ` (в очереди: ${pendingCount})` : "";
  const forwardHint = forwardedFromName ? `\nОт: ${forwardedFromName}` : "";

  await ctx.telegram.editMessageText(
    ctx.chat!.id,
    statusMessageId,
    undefined,
    `⏳ Голосовое (${durationStr}) поставлено в очередь${queueHint}${forwardHint}`
  );
}
