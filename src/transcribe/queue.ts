/**
 * BullMQ queue for voice transcription jobs.
 * Provides reliable processing of voice messages with concurrency control,
 * retry logic, and rate limiting to avoid OpenRouter API limits.
 */

import { Queue, Worker } from "bullmq";
import type { Job, ConnectionOptions } from "bullmq";
import type { TranscribeJobData } from "./types.js";

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
  processor: (job: Job<TranscribeJobData>) => Promise<void>
): Worker<TranscribeJobData> {
  const connection = parseRedisUrl(redisUrl);

  transcribeWorker = new Worker<TranscribeJobData>(
    "voice-transcribe",
    processor,
    {
      connection,
      concurrency: 2,
      limiter: {
        max: 10,
        duration: 60_000,
      },
    }
  );

  transcribeWorker.on("failed", (job, err) => {
    console.error(`Transcription job ${job?.id} failed:`, err.message);
  });

  transcribeWorker.on("completed", (job) => {
    console.log(`Transcription job ${job.id} completed.`);
  });

  return transcribeWorker;
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
