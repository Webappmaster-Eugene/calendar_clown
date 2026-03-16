import { query } from "../db/connection.js";
import type {
  VoiceTranscription,
  CreateTranscriptionParams,
  TranscriptionStatus,
} from "./types.js";

/** Insert a new voice transcription record (status: pending). */
export async function createTranscription(
  params: CreateTranscriptionParams
): Promise<VoiceTranscription> {
  const { rows } = await query<TranscriptionRow>(
    `INSERT INTO voice_transcriptions
       (user_id, telegram_file_id, telegram_file_unique_id, duration_seconds,
        file_size_bytes, forwarded_from_name, forwarded_date, audio_file_path, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
     RETURNING *`,
    [
      params.userId,
      params.telegramFileId,
      params.telegramFileUniqueId,
      params.durationSeconds,
      params.fileSizeBytes,
      params.forwardedFromName,
      params.forwardedDate,
      params.audioFilePath,
    ]
  );
  return mapRow(rows[0]);
}

/** Check if a transcription already exists for a given file (deduplication). */
export async function transcriptionExists(
  telegramFileUniqueId: string
): Promise<boolean> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM voice_transcriptions WHERE telegram_file_unique_id = $1",
    [telegramFileUniqueId]
  );
  return parseInt(rows[0].count, 10) > 0;
}

/** Update transcription status to 'processing'. */
export async function markProcessing(transcriptionId: number): Promise<void> {
  await query(
    "UPDATE voice_transcriptions SET status = 'processing' WHERE id = $1",
    [transcriptionId]
  );
}

/** Mark transcription as completed with the resulting text. */
export async function markCompleted(
  transcriptionId: number,
  transcript: string,
  modelUsed: string
): Promise<void> {
  await query(
    `UPDATE voice_transcriptions
     SET status = 'completed', transcript = $1, model_used = $2, transcribed_at = NOW()
     WHERE id = $3`,
    [transcript, modelUsed, transcriptionId]
  );
}

/** Mark transcription as failed with an error message. */
export async function markFailed(
  transcriptionId: number,
  errorMessage: string
): Promise<void> {
  await query(
    `UPDATE voice_transcriptions
     SET status = 'failed', error_message = $1, transcribed_at = NOW()
     WHERE id = $2`,
    [errorMessage, transcriptionId]
  );
}

/** Get transcription by ID. */
export async function getTranscriptionById(
  transcriptionId: number
): Promise<VoiceTranscription | null> {
  const { rows } = await query<TranscriptionRow>(
    "SELECT * FROM voice_transcriptions WHERE id = $1",
    [transcriptionId]
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

/** Get transcription by ID with user ownership check. */
export async function getTranscriptionByIdForUser(
  transcriptionId: number,
  userId: number
): Promise<VoiceTranscription | null> {
  const { rows } = await query<TranscriptionRow>(
    "SELECT * FROM voice_transcriptions WHERE id = $1 AND user_id = $2",
    [transcriptionId, userId]
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

/** Count pending transcriptions for a user (for queue position display). */
export async function countPendingForUser(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM voice_transcriptions WHERE user_id = $1 AND status IN ('pending', 'processing')",
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

/** Get recent completed transcriptions for a user (most recent first). */
export async function getRecentTranscriptions(
  userId: number,
  limit: number = 10
): Promise<VoiceTranscription[]> {
  const { rows } = await query<TranscriptionRow>(
    `SELECT * FROM voice_transcriptions
     WHERE user_id = $1 AND status = 'completed'
     ORDER BY transcribed_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows.map(mapRow);
}

/** Count total completed transcriptions for a user. */
export async function countCompletedTranscriptions(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM voice_transcriptions WHERE user_id = $1 AND status = 'completed'",
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

/** Get recent completed transcriptions with offset for pagination. */
export async function getRecentTranscriptionsPaginated(
  userId: number,
  limit: number = 5,
  offset: number = 0
): Promise<VoiceTranscription[]> {
  const { rows } = await query<TranscriptionRow>(
    `SELECT * FROM voice_transcriptions
     WHERE user_id = $1 AND status = 'completed'
     ORDER BY transcribed_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows.map(mapRow);
}

/** Batch-mark all pending/processing transcriptions for a user as failed. */
export async function markUserPendingAsFailed(
  userId: number,
  errorMessage: string
): Promise<number> {
  const { rowCount } = await query(
    `UPDATE voice_transcriptions
     SET status = 'failed', error_message = $1, transcribed_at = NOW()
     WHERE user_id = $2 AND status IN ('pending', 'processing')`,
    [errorMessage, userId]
  );
  return rowCount ?? 0;
}

/** Delete a transcription record by ID (for re-queue after failure). */
export async function deleteTranscription(id: number): Promise<void> {
  await query("DELETE FROM voice_transcriptions WHERE id = $1", [id]);
}

/** Auto-fail transcriptions stuck in pending/processing for too long. */
export async function markStaleAsFailed(maxAgeMinutes: number = 15): Promise<number> {
  const { rowCount } = await query(
    `UPDATE voice_transcriptions
     SET status = 'failed', error_message = 'Превышено время ожидания', transcribed_at = NOW()
     WHERE status IN ('pending', 'processing')
       AND created_at < NOW() - INTERVAL '1 minute' * $1`,
    [maxAgeMinutes]
  );
  return rowCount ?? 0;
}

/** Get transcription by telegram_file_unique_id. */
export async function getTranscriptionByFileUniqueId(
  fileUniqueId: string
): Promise<VoiceTranscription | null> {
  const { rows } = await query<TranscriptionRow>(
    "SELECT * FROM voice_transcriptions WHERE telegram_file_unique_id = $1",
    [fileUniqueId]
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

// ─── Internal ────────────────────────────────────────────────────────────

interface TranscriptionRow {
  id: number;
  user_id: number;
  telegram_file_id: string;
  telegram_file_unique_id: string;
  duration_seconds: number;
  file_size_bytes: number | null;
  forwarded_from_name: string | null;
  forwarded_date: Date | null;
  transcript: string | null;
  model_used: string | null;
  audio_file_path: string | null;
  status: string;
  error_message: string | null;
  created_at: Date;
  transcribed_at: Date | null;
}

function mapRow(r: TranscriptionRow): VoiceTranscription {
  return {
    id: r.id,
    userId: r.user_id,
    telegramFileId: r.telegram_file_id,
    telegramFileUniqueId: r.telegram_file_unique_id,
    durationSeconds: r.duration_seconds,
    fileSizeBytes: r.file_size_bytes,
    forwardedFromName: r.forwarded_from_name,
    forwardedDate: r.forwarded_date,
    transcript: r.transcript,
    modelUsed: r.model_used,
    audioFilePath: r.audio_file_path,
    status: r.status as TranscriptionStatus,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    transcribedAt: r.transcribed_at,
  };
}
