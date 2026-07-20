import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { thoughtSimplifications } from "../db/schema.js";

// ─── Types ──────────────────────────────────────────────────────

export interface Simplification {
  id: number;
  userId: number;
  inputMethod: string;
  originalText: string;
  simplifiedText: string | null;
  modelUsed: string | null;
  status: string;
  errorMessage: string | null;
  sequenceNumber: number;
  isDelivered: boolean;
  chatId: number | null;
  statusMessageId: number | null;
  createdAt: Date;
  simplifiedAt: Date | null;
}

function mapRow(row: typeof thoughtSimplifications.$inferSelect): Simplification {
  return {
    id: row.id,
    userId: row.userId,
    inputMethod: row.inputMethod,
    originalText: row.originalText,
    simplifiedText: row.simplifiedText,
    modelUsed: row.modelUsed,
    status: row.status,
    errorMessage: row.errorMessage,
    sequenceNumber: row.sequenceNumber,
    isDelivered: row.isDelivered,
    chatId: row.chatId,
    statusMessageId: row.statusMessageId,
    createdAt: row.createdAt,
    simplifiedAt: row.simplifiedAt,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────

export async function createSimplification(
  userId: number,
  inputMethod: string,
  originalText: string,
  sequenceNumber: number,
  chatId: number | null,
  statusMessageId: number | null,
): Promise<Simplification> {
  const [row] = await db
    .insert(thoughtSimplifications)
    .values({
      userId,
      inputMethod,
      originalText,
      status: "pending",
      sequenceNumber,
      chatId,
      statusMessageId,
    })
    .returning();
  return mapRow(row);
}

export async function markSimplificationProcessing(id: number): Promise<void> {
  await db
    .update(thoughtSimplifications)
    .set({ status: "processing" })
    .where(eq(thoughtSimplifications.id, id));
}

export async function markSimplificationCompleted(
  id: number,
  simplifiedText: string,
  modelUsed: string,
): Promise<void> {
  await db
    .update(thoughtSimplifications)
    .set({ status: "completed", simplifiedText, modelUsed, simplifiedAt: sql`now()` })
    .where(eq(thoughtSimplifications.id, id));
}

export async function markSimplificationFailed(
  id: number,
  errorMessage: string,
): Promise<void> {
  await db
    .update(thoughtSimplifications)
    .set({ status: "failed", errorMessage, simplifiedAt: sql`now()` })
    .where(eq(thoughtSimplifications.id, id));
}

export async function markSimplificationDelivered(id: number): Promise<void> {
  await db
    .update(thoughtSimplifications)
    .set({ isDelivered: true })
    .where(eq(thoughtSimplifications.id, id));
}

// ─── Delivery Queries ───────────────────────────────────────────

export async function getUndeliveredSimplificationsForUser(
  userId: number,
): Promise<Simplification[]> {
  const rows = await db
    .select()
    .from(thoughtSimplifications)
    .where(and(eq(thoughtSimplifications.userId, userId), eq(thoughtSimplifications.isDelivered, false)))
    .orderBy(thoughtSimplifications.sequenceNumber);
  return rows.map(mapRow);
}

export async function getDistinctUsersWithUndeliveredSimplifications(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: thoughtSimplifications.userId })
    .from(thoughtSimplifications)
    .where(
      and(
        eq(thoughtSimplifications.isDelivered, false),
        inArray(thoughtSimplifications.status, ["completed", "failed"]),
      ),
    );
  return rows.map((r) => r.userId);
}

export async function markStaleSimplificationsAsFailed(
  maxAgeMinutes: number = 30,
): Promise<number> {
  const rows = await db
    .update(thoughtSimplifications)
    .set({ status: "failed", errorMessage: "Превышено время ожидания", simplifiedAt: sql`now()` })
    .where(
      and(
        inArray(thoughtSimplifications.status, ["pending", "processing"]),
        lt(thoughtSimplifications.createdAt, sql`now() - interval '1 minute' * ${maxAgeMinutes}`),
      ),
    )
    .returning({ id: thoughtSimplifications.id });
  return rows.length;
}

// ─── History Queries ────────────────────────────────────────────

export async function getSimplificationsPaginated(
  userId: number,
  limit: number,
  offset: number,
): Promise<Simplification[]> {
  const rows = await db
    .select()
    .from(thoughtSimplifications)
    .where(eq(thoughtSimplifications.userId, userId))
    .orderBy(desc(thoughtSimplifications.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(mapRow);
}

export async function countSimplifications(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(thoughtSimplifications)
    .where(eq(thoughtSimplifications.userId, userId));
  return row.value;
}

export async function getSimplificationById(
  id: number,
  userId: number,
): Promise<Simplification | null> {
  const [row] = await db
    .select()
    .from(thoughtSimplifications)
    .where(and(eq(thoughtSimplifications.id, id), eq(thoughtSimplifications.userId, userId)));
  return row ? mapRow(row) : null;
}

export async function deleteSimplification(
  id: number,
  userId: number,
): Promise<boolean> {
  const rows = await db
    .delete(thoughtSimplifications)
    .where(and(eq(thoughtSimplifications.id, id), eq(thoughtSimplifications.userId, userId)))
    .returning({ id: thoughtSimplifications.id });
  return rows.length > 0;
}
