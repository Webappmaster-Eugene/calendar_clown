import { Queue, Worker } from "bullmq";
import type { Job, ConnectionOptions } from "bullmq";
import type { Telegraf } from "telegraf";
import type { TranscribeJobData } from "./types.js";
import { markStaleAsFailed, markFailed, getDistinctUsersWithUndelivered } from "./repository.js";
import { deliverCompletedInOrder } from "./deliveryQueue.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("queue");

let transcribeQueue: Queue<TranscribeJobData> | null = null;
let transcribeWorker: Worker<TranscribeJobData> | null = null;

function parseRedisUrl(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const db = url.pathname?.replace("/", "");
  const dbNum = db ? parseInt(db, 10) : undefined;
  if (dbNum !== undefined && isNaN(dbNum)) {
    throw new Error(`Invalid Redis DB number in URL: "${db}"`);
  }
  return {
    host: url.hostname,
    port: parseInt(url.port || "6379", 10),
    password: url.password || undefined,
    username: url.username || undefined,
    db: dbNum,
    maxRetriesPerRequest: null,
  };
}

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

  // Clear potentially corrupted rate limit state from previous run
  transcribeQueue.removeRateLimitKey().catch(() => {});

  return transcribeQueue;
}

export function getTranscribeQueue(): Queue<TranscribeJobData> | null {
  return transcribeQueue;
}

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
      stalledInterval: 600_000,
      maxStalledCount: 3,
      limiter: {
        max: 10,
        duration: 60_000,
      },
    }
  );

  transcribeWorker.on("failed", (job, err) => {
    log.error(`Transcription job ${job?.id} failed: ${err.message}`);
    if (job) {
      const { transcriptionId, userId } = job.data;
      markFailed(transcriptionId, err.message)
        .then(() => deliverCompletedInOrder(bot, userId))
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

export async function getQueueStatus(): Promise<QueueStatus | null> {
  if (!transcribeQueue) return null;
  const [waiting, active, delayed, failed] = await Promise.all([
    transcribeQueue.getWaitingCount(),
    transcribeQueue.getActiveCount(),
    transcribeQueue.getDelayedCount(),
    transcribeQueue.getFailedCount(),
  ]);

  let workerRunning = false;
  if (transcribeWorker && !transcribeWorker.closing) {
    try {
      const client = await transcribeWorker.client;
      if (client.status === "ready") {
        workerRunning = true;
      }
    } catch {
      workerRunning = false;
    }
  }

  return { workerRunning, waiting, active, delayed, failed };
}

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

export function startStaleJobCleaner(bot: Telegraf): void {
  if (staleJobInterval) return;
  staleJobInterval = setInterval(async () => {
    await cleanStaleJobs().catch((err) => {
      log.error("Stale job cleanup error:", err);
    });
    await markStaleAsFailed(120).catch((err) => {
      log.error("Mark stale DB records as failed error:", err);
    });
    try {
      const usersToDeliver = await getDistinctUsersWithUndelivered();
      for (const userId of usersToDeliver) {
        deliverCompletedInOrder(bot, userId);
      }
    } catch (err) {
      log.error("Stale cleanup delivery trigger error:", err);
    }
  }, 5 * 60 * 1000);
  log.info("Stale job cleaner started (every 5 min)");
}

export function stopStaleJobCleaner(): void {
  if (staleJobInterval) {
    clearInterval(staleJobInterval);
    staleJobInterval = null;
  }
}

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let stuckSince: number | null = null;
const STUCK_THRESHOLD_MS = 2 * 60 * 1000;

/**
 * If waiting > 0 && active === 0 for longer than STUCK_THRESHOLD_MS, clears the rate limit key
 * and restarts the worker.
 */
export function startWorkerHealthMonitor(
  redisUrl: string,
  processor: (job: Job<TranscribeJobData>) => Promise<void>,
  bot: Telegraf
): void {
  if (healthCheckInterval) return;

  healthCheckInterval = setInterval(async () => {
    try {
      const status = await getQueueStatus();
      if (!status) return;

      if (status.waiting > 0 && status.active === 0) {
        if (!stuckSince) {
          stuckSince = Date.now();
          log.warn(`Health: ${status.waiting} waiting, 0 active — monitoring...`);
          return;
        }

        if (Date.now() - stuckSince < STUCK_THRESHOLD_MS) return;

        log.error(`Health: worker stuck for ${Math.round((Date.now() - stuckSince) / 1000)}s — restarting`);
        stuckSince = null;

        // Clear potentially corrupted rate limit key
        await transcribeQueue?.removeRateLimitKey().catch(() => {});

        if (transcribeWorker) {
          await transcribeWorker.close().catch(() => {});
          transcribeWorker = null;
        }

        startTranscribeWorker(redisUrl, processor, bot);
        log.info("Health: worker restarted successfully");
      } else {
        stuckSince = null;
      }
    } catch (err) {
      log.error("Health check error:", err instanceof Error ? err.message : err);
    }
  }, 30_000);

  log.info("Worker health monitor started (every 30s)");
}

export function stopWorkerHealthMonitor(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  stuckSince = null;
}

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
