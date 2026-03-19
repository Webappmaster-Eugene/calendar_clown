/**
 * Transcription worker processor.
 * Handles each job from the BullMQ queue: transcribe audio → update DB → trigger ordered delivery.
 */

import type { Job } from "bullmq";
import type { Telegraf } from "telegraf";
import { unlink } from "fs/promises";
import { transcribeVoiceHQ } from "./transcribeHQ.js";
import { markProcessing, markCompleted, markFailed } from "./repository.js";
import { isFFmpegAvailable } from "./audioUtils.js";
import { TRANSCRIBE_MODEL_HQ } from "../constants.js";
import type { TranscribeJobData } from "./types.js";
import { createLogger } from "../utils/logger.js";
import { createProgressReporter } from "./progressReporter.js";
import { editStatusSafe } from "./telegramHelpers.js";
import { deliverCompletedInOrder } from "./deliveryQueue.js";

const log = createLogger("worker");

/**
 * Create a job processor function bound to the bot instance.
 * The bot reference is needed to trigger ordered delivery via Telegram.
 */
export function createTranscribeProcessor(bot: Telegraf) {
  // Check ffmpeg on first load — logs a warning if not available
  isFFmpegAvailable().catch(() => {});

  return async function processTranscribeJob(
    job: Job<TranscribeJobData>
  ): Promise<void> {
    const { transcriptionId, filePath, chatId, statusMessageId, durationSeconds, userId } = job.data;

    log.info(`Processing job ${job.id}: transcriptionId=${transcriptionId}, seq=${job.data.sequenceNumber}, file=${filePath}, attempt=${job.attemptsMade + 1}/${job.opts.attempts ?? 3}`);
    await markProcessing(transcriptionId);

    const reporter = createProgressReporter(bot, chatId, statusMessageId);
    reporter.onProgress("Начинаю обработку...");

    // Wrap onProgress to extend BullMQ lock on each progress update.
    // This keeps the lock alive for multi-chunk transcriptions that exceed lockDuration.
    const onProgressWithLockExtension = (msg: string): void => {
      reporter.onProgress(msg);
      const token = job.token;
      if (token) {
        job.extendLock(token, 3_600_000).catch((err) => {
          log.warn(`Lock extension failed for job ${job.id}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    };

    try {
      const transcript = await transcribeVoiceHQ(filePath, onProgressWithLockExtension, durationSeconds);

      if (!transcript) {
        await reporter.flush();
        await markFailed(transcriptionId, "Empty transcription result");
        await unlink(filePath).catch(() => {});
        deliverCompletedInOrder(bot, userId);
        return;
      }

      log.info(`Transcription ${transcriptionId} completed: ${transcript.length} chars`);
      await markCompleted(transcriptionId, transcript, TRANSCRIBE_MODEL_HQ);

      // Flush any pending progress update before delivery
      await reporter.flush();

      // Update status message to indicate waiting for ordered delivery
      await editStatusSafe(bot, chatId, statusMessageId, "✅ Расшифровано, ожидает очереди...");

      // Clean up OGG file after successful processing
      await unlink(filePath).catch(() => {});

      // Trigger ordered delivery for this user
      deliverCompletedInOrder(bot, userId);
    } catch (err) {
      await reporter.flush();

      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      log.error(`Transcription ${transcriptionId} error: ${errorMsg}`);
      if (errorStack) log.error(`Stack trace: ${errorStack}`);

      // On final attempt — mark as failed and trigger delivery.
      // On earlier attempts — leave file for retry.
      const isLastAttempt = (job.attemptsMade + 1) >= (job.opts.attempts ?? 3);
      if (isLastAttempt) {
        await markFailed(transcriptionId, errorMsg);
        await unlink(filePath).catch(() => {});
        deliverCompletedInOrder(bot, userId);
      }

      throw err; // Re-throw so BullMQ can retry on non-final attempts
    }
  };
}
