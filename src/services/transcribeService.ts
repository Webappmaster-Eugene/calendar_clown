/**
 * Transcribe business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  getRecentTranscriptionsPaginated,
  countCompletedTranscriptions,
  getTranscriptionByIdForUser,
  deleteTranscriptionForUser,
  getPendingForUser,
} from "../transcribe/repository.js";
import { getQueueStatus } from "../transcribe/queue.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import type {
  TranscriptionDto,
  TranscribeHistoryResponse,
  TranscribeQueueStatusDto,
} from "../shared/types.js";

const log = createLogger("transcribe-service");

// ─── Helpers ──────────────────────────────────────────────────

function requireDb(): void {
  if (!isDatabaseAvailable()) {
    throw new Error("База данных недоступна.");
  }
}

async function requireDbUser(telegramId: number) {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) throw new Error("Пользователь не найден.");
  return dbUser;
}

function transcriptionToDto(t: {
  id: number;
  durationSeconds: number;
  forwardedFromName: string | null;
  transcript: string | null;
  status: string;
  errorMessage: string | null;
  isDelivered: boolean;
  createdAt: Date;
  transcribedAt: Date | null;
}): TranscriptionDto {
  return {
    id: t.id,
    durationSeconds: t.durationSeconds,
    forwardedFromName: t.forwardedFromName,
    transcript: t.transcript,
    status: t.status as TranscriptionDto["status"],
    errorMessage: t.errorMessage,
    isDelivered: t.isDelivered,
    createdAt: t.createdAt.toISOString(),
    transcribedAt: t.transcribedAt?.toISOString() ?? null,
  };
}

// ─── Service Functions ────────────────────────────────────────

/**
 * Get transcription history with pagination.
 */
export async function getHistory(
  telegramId: number,
  limit: number = 5,
  offset: number = 0
): Promise<TranscribeHistoryResponse> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const [transcriptions, total] = await Promise.all([
    getRecentTranscriptionsPaginated(dbUser.id, limit, offset),
    countCompletedTranscriptions(dbUser.id),
  ]);

  return {
    transcriptions: transcriptions.map(transcriptionToDto),
    total,
  };
}

/**
 * Get a single transcription by ID.
 */
export async function getTranscription(
  telegramId: number,
  transcriptionId: number
): Promise<TranscriptionDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const t = await getTranscriptionByIdForUser(transcriptionId, dbUser.id);
  if (!t) return null;
  return transcriptionToDto(t);
}

/**
 * Delete a transcription.
 */
export async function removeTranscription(
  telegramId: number,
  transcriptionId: number
): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return deleteTranscriptionForUser(transcriptionId, dbUser.id);
}

/**
 * Get pending transcriptions for user.
 */
export async function getPending(telegramId: number): Promise<TranscriptionDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const pending = await getPendingForUser(dbUser.id);
  return pending.map(transcriptionToDto);
}

/**
 * Get queue status (global counts by status).
 */
export async function getQueueInfo(): Promise<TranscribeQueueStatusDto | null> {
  const status = await getQueueStatus();
  if (!status) return null;

  return {
    pending: status.waiting,
    processing: status.active,
    completed: 0,
    failed: 0,
  };
}
