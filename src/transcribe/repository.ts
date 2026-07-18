import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { users, voiceTranscriptions } from "../db/schema.js";
import type {
  VoiceTranscription,
  CreateTranscriptionParams,
  TranscriptionStatus,
} from "./types.js";

/** Insert a new voice transcription record (status: pending). */
export async function createTranscription(
  params: CreateTranscriptionParams
): Promise<VoiceTranscription> {
  const [row] = await db
    .insert(voiceTranscriptions)
    .values({
      userId: params.userId,
      telegramFileId: params.telegramFileId,
      telegramFileUniqueId: params.telegramFileUniqueId,
      durationSeconds: params.durationSeconds,
      fileSizeBytes: params.fileSizeBytes,
      forwardedFromName: params.forwardedFromName,
      forwardedDate: params.forwardedDate,
      audioFilePath: params.audioFilePath,
      status: "pending",
      sequenceNumber: params.sequenceNumber,
      chatId: params.chatId,
      statusMessageId: params.statusMessageId,
    })
    .returning();
  return mapRow(row);
}

/** Update transcription status to 'processing'. */
export async function markProcessing(transcriptionId: number): Promise<void> {
  await db
    .update(voiceTranscriptions)
    .set({ status: "processing" })
    .where(eq(voiceTranscriptions.id, transcriptionId));
}

/** Mark transcription as completed with the resulting text. */
export async function markCompleted(
  transcriptionId: number,
  transcript: string,
  modelUsed: string
): Promise<void> {
  await db
    .update(voiceTranscriptions)
    .set({ status: "completed", transcript, modelUsed, transcribedAt: sql`now()` })
    .where(eq(voiceTranscriptions.id, transcriptionId));
}

/** Mark transcription as failed with an error message. */
export async function markFailed(
  transcriptionId: number,
  errorMessage: string
): Promise<void> {
  await db
    .update(voiceTranscriptions)
    .set({ status: "failed", errorMessage, transcribedAt: sql`now()` })
    .where(eq(voiceTranscriptions.id, transcriptionId));
}

/** Get transcription by ID with user ownership check. */
export async function getTranscriptionByIdForUser(
  transcriptionId: number,
  userId: number
): Promise<VoiceTranscription | null> {
  const [row] = await db
    .select()
    .from(voiceTranscriptions)
    .where(and(eq(voiceTranscriptions.id, transcriptionId), eq(voiceTranscriptions.userId, userId)));
  if (!row) return null;
  return mapRow(row);
}

/** Count pending transcriptions for a user (for queue position display). */
export async function countPendingForUser(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(voiceTranscriptions)
    .where(
      and(
        eq(voiceTranscriptions.userId, userId),
        inArray(voiceTranscriptions.status, ["pending", "processing"])
      )
    );
  return row.value;
}

/** Count total completed transcriptions for a user. */
export async function countCompletedTranscriptions(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(voiceTranscriptions)
    .where(and(eq(voiceTranscriptions.userId, userId), eq(voiceTranscriptions.status, "completed")));
  return row.value;
}

/** Get recent completed transcriptions with offset for pagination. */
export async function getRecentTranscriptionsPaginated(
  userId: number,
  limit: number = 5,
  offset: number = 0
): Promise<VoiceTranscription[]> {
  const rows = await db
    .select()
    .from(voiceTranscriptions)
    .where(and(eq(voiceTranscriptions.userId, userId), eq(voiceTranscriptions.status, "completed")))
    .orderBy(desc(voiceTranscriptions.transcribedAt))
    .limit(limit)
    .offset(offset);
  return rows.map(mapRow);
}

/** Get pending/processing transcriptions for a specific user. */
export async function getPendingForUser(userId: number): Promise<VoiceTranscription[]> {
  const rows = await db
    .select()
    .from(voiceTranscriptions)
    .where(
      and(
        eq(voiceTranscriptions.userId, userId),
        inArray(voiceTranscriptions.status, ["pending", "processing"])
      )
    )
    .orderBy(voiceTranscriptions.createdAt);
  return rows.map(mapRow);
}

/** Admin: get ALL pending/processing transcriptions (all users, with user info). */
export async function getAllPending(): Promise<Array<VoiceTranscription & { firstName: string }>> {
  const rows = await db
    .select({ vt: voiceTranscriptions, firstName: users.firstName })
    .from(voiceTranscriptions)
    .innerJoin(users, eq(users.id, voiceTranscriptions.userId))
    .where(inArray(voiceTranscriptions.status, ["pending", "processing"]))
    .orderBy(voiceTranscriptions.createdAt);
  return rows.map((r) => ({ ...mapRow(r.vt), firstName: r.firstName }));
}

/** Batch-mark all pending/processing transcriptions for a user as failed. */
export async function markUserPendingAsFailed(
  userId: number,
  errorMessage: string
): Promise<number> {
  const rows = await db
    .update(voiceTranscriptions)
    .set({ status: "failed", errorMessage, transcribedAt: sql`now()` })
    .where(
      and(
        eq(voiceTranscriptions.userId, userId),
        inArray(voiceTranscriptions.status, ["pending", "processing"])
      )
    )
    .returning({ id: voiceTranscriptions.id });
  return rows.length;
}

/** Delete a transcription record by ID (for re-queue after failure). */
export async function deleteTranscription(id: number): Promise<void> {
  await db.delete(voiceTranscriptions).where(eq(voiceTranscriptions.id, id));
}

/** Auto-fail transcriptions stuck in pending/processing for too long. */
export async function markStaleAsFailed(maxAgeMinutes: number = 120): Promise<number> {
  const rows = await db
    .update(voiceTranscriptions)
    .set({
      status: "failed",
      errorMessage: "Превышено время ожидания",
      transcribedAt: sql`now()`,
    })
    .where(
      and(
        inArray(voiceTranscriptions.status, ["pending", "processing"]),
        lt(voiceTranscriptions.createdAt, sql`now() - interval '1 minute' * ${maxAgeMinutes}`)
      )
    )
    .returning({ id: voiceTranscriptions.id });
  return rows.length;
}

/** Get transcription by telegram_file_unique_id. */
export async function getTranscriptionByFileUniqueId(
  fileUniqueId: string
): Promise<VoiceTranscription | null> {
  const [row] = await db
    .select()
    .from(voiceTranscriptions)
    .where(eq(voiceTranscriptions.telegramFileUniqueId, fileUniqueId));
  if (!row) return null;
  return mapRow(row);
}

// ─── Admin functions ──────────────────────────────────────────────────────

/** Delete a transcription by ID with ownership check. */
export async function deleteTranscriptionForUser(id: number, userId: number): Promise<boolean> {
  const rows = await db
    .delete(voiceTranscriptions)
    .where(and(eq(voiceTranscriptions.id, id), eq(voiceTranscriptions.userId, userId)))
    .returning({ id: voiceTranscriptions.id });
  return rows.length > 0;
}

/** Update a transcription's transcript text by ID with ownership check. */
export async function updateTranscriptForUser(
  id: number,
  userId: number,
  transcript: string
): Promise<VoiceTranscription | null> {
  const [row] = await db
    .update(voiceTranscriptions)
    .set({ transcript })
    .where(and(eq(voiceTranscriptions.id, id), eq(voiceTranscriptions.userId, userId)))
    .returning();
  if (!row) return null;
  return mapRow(row);
}

/** Admin: delete ALL transcriptions across all users. */
export async function deleteAllTranscriptions(): Promise<number> {
  const rows = await db.delete(voiceTranscriptions).returning({ id: voiceTranscriptions.id });
  return rows.length;
}

/** Delete transcriptions by an array of IDs. */
export async function bulkDeleteTranscriptions(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .delete(voiceTranscriptions)
    .where(inArray(voiceTranscriptions.id, ids))
    .returning({ id: voiceTranscriptions.id });
  return rows.length;
}

/** Admin: get all transcriptions paginated (all users, with user info). */
export async function getAllTranscriptionsPaginated(
  limit: number,
  offset: number
): Promise<Array<VoiceTranscription & { firstName: string }>> {
  const rows = await db
    .select({ vt: voiceTranscriptions, firstName: users.firstName })
    .from(voiceTranscriptions)
    .innerJoin(users, eq(users.id, voiceTranscriptions.userId))
    .orderBy(desc(voiceTranscriptions.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({ ...mapRow(r.vt), firstName: r.firstName }));
}

/** Admin: count all transcriptions. */
export async function countAllTranscriptions(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(voiceTranscriptions);
  return row.value;
}

// ─── Internal ────────────────────────────────────────────────────────────

/** Get all undelivered transcriptions for a user, ordered by sequence_number ASC. */
export async function getUndeliveredForUser(userId: number): Promise<VoiceTranscription[]> {
  const rows = await db
    .select()
    .from(voiceTranscriptions)
    .where(and(eq(voiceTranscriptions.userId, userId), eq(voiceTranscriptions.isDelivered, false)))
    .orderBy(voiceTranscriptions.sequenceNumber);
  return rows.map(mapRow);
}

/** Mark a transcription as delivered. */
export async function markDelivered(id: number): Promise<void> {
  await db
    .update(voiceTranscriptions)
    .set({ isDelivered: true })
    .where(eq(voiceTranscriptions.id, id));
}

/** Get distinct user IDs with undelivered completed/failed transcriptions (for recovery). */
export async function getDistinctUsersWithUndelivered(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: voiceTranscriptions.userId })
    .from(voiceTranscriptions)
    .where(
      and(
        eq(voiceTranscriptions.isDelivered, false),
        inArray(voiceTranscriptions.status, ["completed", "failed"])
      )
    );
  return rows.map((r) => r.userId);
}

// ─── Internal ────────────────────────────────────────────────────────────

function mapRow(r: typeof voiceTranscriptions.$inferSelect): VoiceTranscription {
  return {
    id: r.id,
    userId: r.userId,
    telegramFileId: r.telegramFileId,
    telegramFileUniqueId: r.telegramFileUniqueId,
    durationSeconds: r.durationSeconds,
    fileSizeBytes: r.fileSizeBytes,
    forwardedFromName: r.forwardedFromName,
    forwardedDate: r.forwardedDate,
    transcript: r.transcript,
    modelUsed: r.modelUsed,
    audioFilePath: r.audioFilePath,
    status: r.status as TranscriptionStatus,
    errorMessage: r.errorMessage,
    sequenceNumber: r.sequenceNumber,
    isDelivered: r.isDelivered,
    chatId: r.chatId,
    statusMessageId: r.statusMessageId,
    createdAt: r.createdAt,
    transcribedAt: r.transcribedAt,
  };
}
