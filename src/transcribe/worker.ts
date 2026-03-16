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
import { createLogger } from "../utils/logger.js";
import { splitMessage, TELEGRAM_MAX_MESSAGE_LENGTH } from "../utils/telegram.js";
import { createProgressReporter } from "./progressReporter.js";

const log = createLogger("worker");

/**
 * Create a job processor function bound to the bot instance.
 * The bot reference is needed to send results back to the user via Telegram.
 */
export function createTranscribeProcessor(bot: Telegraf) {
  return async function processTranscribeJob(
    job: Job<TranscribeJobData>
  ): Promise<void> {
    const { transcriptionId, filePath, chatId, statusMessageId, durationSeconds } = job.data;

    log.info(`Processing job ${job.id}: transcriptionId=${transcriptionId}, file=${filePath}, attempt=${job.attemptsMade + 1}/${job.opts.attempts ?? 3}`);
    await markProcessing(transcriptionId);

    const reporter = createProgressReporter(bot, chatId, statusMessageId);
    reporter.onProgress("Начинаю обработку...");

    // Wrap onProgress to extend BullMQ lock on each progress update.
    // This keeps the lock alive for multi-chunk transcriptions that exceed lockDuration.
    const onProgressWithLockExtension = (msg: string): void => {
      reporter.onProgress(msg);
      const token = job.token;
      if (token) {
        job.extendLock(token, 1_800_000).catch((err) => {
          log.warn(`Lock extension failed for job ${job.id}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    };

    try {
      const transcript = await transcribeVoiceHQ(filePath, onProgressWithLockExtension, durationSeconds);

      if (!transcript) {
        await reporter.flush();
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

      log.info(`Transcription ${transcriptionId} completed: ${transcript.length} chars`);
      await markCompleted(transcriptionId, transcript, TRANSCRIBE_MODEL_HQ);

      // Send transcript as a new message (better UX than editing the status)
      await sendTranscriptSafe(bot, chatId, transcript);

      // Flush any pending progress update before deleting status message
      await reporter.flush();

      // Delete the status "processing" message
      await deleteMessageSafe(bot, chatId, statusMessageId);

      // Clean up OGG file after successful processing
      await unlink(filePath).catch(() => {});
    } catch (err) {
      await reporter.flush();

      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      log.error(`Transcription ${transcriptionId} error: ${errorMsg}`);
      if (errorStack) log.error(`Stack trace: ${errorStack}`);

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
      log.error("Failed to send transcript chunk:", err);
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

