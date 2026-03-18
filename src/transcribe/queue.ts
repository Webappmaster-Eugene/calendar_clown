/**
 * BullMQ queue for voice transcription jobs.
 * Provides reliable processing of voice messages with concurrency control,
 * retry logic, and rate limiting to avoid OpenRouter API limits.
 */

import { Queue, Worker } from "bullmq";
import type { Job, ConnectionOptions } from "bullmq";
import type { Telegraf } from "telegraf";
import type { TranscribeJobData } from "./types.js";
import { markStaleAsFailed, markFailed } from "./repository.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("queue");

let transcribeQueue: Queue<TranscribeJobData> | null = null;
let transcribeWorker: Worker<TranscribeJobData> | null = null;

/** Parse Redis URL into BullMQ connection options. */
function parseRedisUrl(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || "6379", 10),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

/** Initialize the transcription queue. Call once at startup. */
export function initTranscribeQueue(redisUrl: string): Queue<TranscribeJobData> {
  if (transcribeQueue) return transcribeQueue;

  const connection = parseRedisUrl(redisUrl);
  transcribeQueue = new Queue<TranscribeJobData>("voice-transcribe", {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5_000,
      },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  });

  return transcribeQueue;
}

/** Get the transcription queue instance. Returns null if not initialized. */
export function getTranscribeQueue(): Queue<TranscribeJobData> | null {
  return transcribeQueue;
}

/**
 * Start the transcription worker.
 * @param redisUrl Redis connection URL
 * @param processor Function that processes each transcription job
 */
export function startTranscribeWorker(
  redisUrl: string,
  processor: (job: Job<TranscribeJobData>) => Promise<void>,
  bot: Telegraf
): Worker<TranscribeJobData> {
  const connection = parseRedisUrl(redisUrl);

  transcribeWorker = new Worker<TranscribeJobData>(
    "voice-transcribe",
    processor,
    {
      connection,
      concurrency: 2,
      lockDuration: 3_600_000,   // 60 min — long audio (30-60 min) needs extended lock
      stalledInterval: 600_000,  // Check for stalled jobs every 10 min
      maxStalledCount: 3,        // Allow 3 stall events before failing
      limiter: {
        max: 10,
        duration: 60_000,
      },
    }
  );

  transcribeWorker.on("failed", (job, err) => {
    log.error(`Transcription job ${job?.id} failed: ${err.message}`);
    if (job) {
      const { chatId, statusMessageId, transcriptionId } = job.data;
      editStatusSafe(bot, chatId, statusMessageId, "Не удалось расшифровать голосовое сообщение. Попробуйте ещё раз.")
        .catch((e) => log.error(`Failed to notify user about job ${job.id} failure:`, e));
      markFailed(transcriptionId, err.message)
        .catch((e) => log.error(`Failed to mark transcription ${transcriptionId} as failed:`, e));
    }
  });

  transcribeWorker.on("stalled", (jobId) => {
    log.warn(`Transcription job ${jobId} stalled — lock expired before processing completed.`);
  });

  transcribeWorker.on("completed", (job) => {
    log.info(`Transcription job ${job.id} completed.`);
  });

  transcribeWorker.on("error", (err) => {
    log.error(`Worker error: ${err.message}`);
  });

  return transcribeWorker;
}

/** Edit a Telegram message, swallowing errors if the message was already deleted. */
async function editStatusSafe(bot: Telegraf, chatId: number, messageId: number, text: string): Promise<void> {
  try {
    await bot.telegram.editMessageText(chatId, messageId, undefined, text);
  } catch {
    // Message may have been deleted by the user — ignore
  }
}

/** Add a transcription job to the queue. */
export async function addTranscribeJob(
  data: TranscribeJobData
): Promise<string | undefined> {
  const queue = getTranscribeQueue();
  if (!queue) {
    throw new Error("Transcribe queue is not initialized");
  }
  const job = await queue.add("transcribe", data);
  return job.id;
}

/** Check if the transcribe queue is initialized and available. */
export function isTranscribeAvailable(): boolean {
  return transcribeQueue !== null;
}

export interface QueueStatus {
  workerRunning: boolean;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

/** Get BullMQ queue counts and worker health status. */
export async function getQueueStatus(): Promise<QueueStatus | null> {
  if (!transcribeQueue) return null;
  const [waiting, active, delayed, failed] = await Promise.all([
    transcribeQueue.getWaitingCount(),
    transcribeQueue.getActiveCount(),
    transcribeQueue.getDelayedCount(),
    transcribeQueue.getFailedCount(),
  ]);
  return {
    workerRunning: transcribeWorker !== null && !transcribeWorker.closing,
    waiting,
    active,
    delayed,
    failed,
  };
}

/** Remove stale jobs older than maxAgeMs from the queue. */
export async function cleanStaleJobs(maxAgeMs: number = 120 * 60 * 1000): Promise<number> {
  const queue = getTranscribeQueue();
  if (!queue) return 0;

  let cleaned = 0;
  const cutoff = Date.now() - maxAgeMs;

  const waiting = await queue.getWaiting();
  for (const job of waiting) {
    if (job.timestamp < cutoff) {
      await job.remove();
      cleaned++;
    }
  }

  const delayed = await queue.getDelayed();
  for (const job of delayed) {
    if (job.timestamp < cutoff) {
      await job.remove();
      cleaned++;
    }
  }

  const active = await queue.getActive();
  for (const job of active) {
    if (job.timestamp < cutoff) {
      try {
        await job.moveToFailed(new Error("Stale active job cleaned up"), "0", true);
        cleaned++;
      } catch { /* job may have been moved already */ }
    }
  }

  if (cleaned > 0) {
    log.info(`Cleaned ${cleaned} stale jobs from queue`);
  }
  return cleaned;
}

/** Remove all waiting/delayed jobs for a specific chat. */
export async function clearUserJobs(chatId: number): Promise<number> {
  const queue = getTranscribeQueue();
  if (!queue) return 0;

  let cleared = 0;

  const waiting = await queue.getWaiting();
  for (const job of waiting) {
    if (job.data.chatId === chatId) {
      await job.remove();
      cleared++;
    }
  }

  const delayed = await queue.getDelayed();
  for (const job of delayed) {
    if (job.data.chatId === chatId) {
      await job.remove();
      cleared++;
    }
  }

  if (cleared > 0) {
    log.info(`Cleared ${cleared} jobs for chat ${chatId}`);
  }
  return cleared;
}

let staleJobInterval: ReturnType<typeof setInterval> | null = null;

/** Start periodic stale job cleaner (every 5 minutes). */
export function startStaleJobCleaner(): void {
  if (staleJobInterval) return;
  staleJobInterval = setInterval(async () => {
    await cleanStaleJobs().catch((err) => {
      log.error("Stale job cleanup error:", err);
    });
    await markStaleAsFailed(120).catch((err) => {
      log.error("Mark stale DB records as failed error:", err);
    });
  }, 5 * 60 * 1000);
  log.info("Stale job cleaner started (every 5 min)");
}

/** Stop periodic stale job cleaner. */
export function stopStaleJobCleaner(): void {
  if (staleJobInterval) {
    clearInterval(staleJobInterval);
    staleJobInterval = null;
  }
}

/** Gracefully close the queue and worker. */
export async function closeTranscribeQueue(): Promise<void> {
  if (transcribeWorker) {
    await transcribeWorker.close();
    transcribeWorker = null;
  }
  if (transcribeQueue) {
    await transcribeQueue.close();
    transcribeQueue = null;
  }
}
