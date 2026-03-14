/**
 * Transcription worker processor.
 * Handles each job from the BullMQ queue: transcribe audio → update DB → notify user.
 */

import type { Job } from "bullmq";
import type { Telegraf } from "telegraf";
import { unlink } from "fs/promises";
import { transcribeVoiceHQ } from "./transcribeHQ.js";
import { markProcessing, markCompleted, markFailed } from "./repository.js";
import { TRANSCRIBE_MODEL_HQ } from "../constants.js";
import type { TranscribeJobData } from "./types.js";

/** Maximum transcript length that Telegram allows in a single message. */
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Create a job processor function bound to the bot instance.
 * The bot reference is needed to send results back to the user via Telegram.
 */
export function createTranscribeProcessor(bot: Telegraf) {
  return async function processTranscribeJob(
    job: Job<TranscribeJobData>
  ): Promise<void> {
    const { transcriptionId, filePath, chatId, statusMessageId } = job.data;

    await markProcessing(transcriptionId);

    try {
      const transcript = await transcribeVoiceHQ(filePath);

      if (!transcript) {
        await markFailed(transcriptionId, "Empty transcription result");
        await editStatusSafe(
          bot,
          chatId,
          statusMessageId,
          "Не удалось распознать речь. Аудио может быть слишком тихим или неразборчивым."
        );
        await unlink(filePath).catch(() => {});
        return;
      }

      await markCompleted(transcriptionId, transcript, TRANSCRIBE_MODEL_HQ);

      // Send transcript as a new message (better UX than editing the status)
      await sendTranscriptSafe(bot, chatId, transcript);

      // Delete the status "processing" message
      await deleteMessageSafe(bot, chatId, statusMessageId);

      // Clean up OGG file after successful processing
      await unlink(filePath).catch(() => {});
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`Transcription ${transcriptionId} error:`, errorMsg);

      // On final attempt — mark as failed and notify user.
      // On earlier attempts — leave file for retry.
      const isLastAttempt = (job.attemptsMade + 1) >= (job.opts.attempts ?? 3);
      if (isLastAttempt) {
        await markFailed(transcriptionId, errorMsg);
        await editStatusSafe(
          bot,
          chatId,
          statusMessageId,
          "Не удалось расшифровать голосовое сообщение. Попробуйте ещё раз."
        );
        await unlink(filePath).catch(() => {});
      }

      throw err; // Re-throw so BullMQ can retry on non-final attempts
    }
  };
}

/** Send transcript text, splitting into chunks if it exceeds Telegram's limit. */
async function sendTranscriptSafe(
  bot: Telegraf,
  chatId: number,
  transcript: string
): Promise<void> {
  const chunks = splitMessage(transcript, TELEGRAM_MAX_MESSAGE_LENGTH);
  for (const chunk of chunks) {
    try {
      await bot.telegram.sendMessage(chatId, chunk);
    } catch (err) {
      console.error("Failed to send transcript chunk:", err);
    }
  }
}

/** Edit the status message, swallowing errors if the message was already deleted. */
async function editStatusSafe(
  bot: Telegraf,
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  try {
    await bot.telegram.editMessageText(chatId, messageId, undefined, text);
  } catch {
    // Message may have been deleted by the user — ignore
  }
}

/** Delete a message, swallowing errors. */
async function deleteMessageSafe(
  bot: Telegraf,
  chatId: number,
  messageId: number
): Promise<void> {
  try {
    await bot.telegram.deleteMessage(chatId, messageId);
  } catch {
    // Message may have been deleted or is too old — ignore
  }
}

/** Split a long text into chunks at paragraph or sentence boundaries. */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a paragraph boundary
    let splitIdx = remaining.lastIndexOf("\n\n", maxLength);
    if (splitIdx === -1 || splitIdx < maxLength * 0.3) {
      // Try a single newline
      splitIdx = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitIdx === -1 || splitIdx < maxLength * 0.3) {
      // Try a sentence boundary
      splitIdx = remaining.lastIndexOf(". ", maxLength);
      if (splitIdx !== -1) splitIdx += 1; // Include the period
    }
    if (splitIdx === -1 || splitIdx < maxLength * 0.3) {
      // Hard split at maxLength
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
