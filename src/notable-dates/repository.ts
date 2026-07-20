import { and, asc, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle.js";
import { notableDates } from "../db/schema.js";

export interface NotableDate {
  id: number;
  tribeId: number;
  createdByUserId: number | null;
  name: string;
  dateMonth: number;
  dateDay: number;
  eventType: string;
  description: string | null;
  greetingTemplate: string | null;
  emoji: string;
  isPriority: boolean;
  isActive: boolean;
  createdAt: Date;
}

interface AddNotableDateParams {
  tribeId: number;
  createdByUserId: number | null;
  name: string;
  dateMonth: number;
  dateDay: number;
  eventType?: string;
  description?: string | null;
  greetingTemplate?: string | null;
  emoji?: string;
  isPriority?: boolean;
}

export async function getDatesByMonthDay(
  tribeId: number,
  month: number,
  day: number
): Promise<NotableDate[]> {
  const rows = await db
    .select()
    .from(notableDates)
    .where(
      and(
        eq(notableDates.tribeId, tribeId),
        eq(notableDates.dateMonth, month),
        eq(notableDates.dateDay, day),
        eq(notableDates.isActive, true)
      )
    )
    .orderBy(asc(notableDates.eventType), asc(notableDates.name));
  return rows.map(mapRow);
}

export async function addNotableDate(params: AddNotableDateParams): Promise<NotableDate> {
  const [row] = await db
    .insert(notableDates)
    .values({
      tribeId: params.tribeId,
      createdByUserId: params.createdByUserId,
      name: params.name,
      dateMonth: params.dateMonth,
      dateDay: params.dateDay,
      eventType: params.eventType ?? "birthday",
      description: params.description ?? null,
      greetingTemplate: params.greetingTemplate ?? null,
      emoji: params.emoji ?? "🎂",
      isPriority: params.isPriority ?? false,
    })
    .returning();
  return mapRow(row);
}

export async function toggleNotableDatePriority(id: number, tribeId: number): Promise<boolean> {
  const rows = await db
    .update(notableDates)
    .set({ isPriority: sql`not ${notableDates.isPriority}`, updatedAt: sql`now()` })
    .where(and(eq(notableDates.id, id), eq(notableDates.tribeId, tribeId)))
    .returning({ id: notableDates.id });
  return rows.length > 0;
}

export async function getNotableDateById(id: number, tribeId: number): Promise<NotableDate | null> {
  const [row] = await db
    .select()
    .from(notableDates)
    .where(and(eq(notableDates.id, id), eq(notableDates.tribeId, tribeId)));
  if (!row) return null;
  return mapRow(row);
}

export async function updateNotableDate(
  id: number,
  tribeId: number,
  fields: Partial<{ name: string; dateMonth: number; dateDay: number; description: string | null; eventType: string; emoji: string; isPriority: boolean }>
): Promise<NotableDate | null> {
  const set: PgUpdateSetSource<typeof notableDates> = {};
  if (fields.name !== undefined) set.name = fields.name;
  if (fields.dateMonth !== undefined) set.dateMonth = fields.dateMonth;
  if (fields.dateDay !== undefined) set.dateDay = fields.dateDay;
  if (fields.description !== undefined) set.description = fields.description;
  if (fields.eventType !== undefined) set.eventType = fields.eventType;
  if (fields.emoji !== undefined) set.emoji = fields.emoji;
  if (fields.isPriority !== undefined) set.isPriority = fields.isPriority;

  if (Object.keys(set).length === 0) return null;

  set.updatedAt = sql`now()`;
  const [row] = await db
    .update(notableDates)
    .set(set)
    .where(and(eq(notableDates.id, id), eq(notableDates.tribeId, tribeId)))
    .returning();
  if (!row) return null;
  return mapRow(row);
}

export async function removeNotableDate(id: number, tribeId: number): Promise<boolean> {
  const rows = await db
    .delete(notableDates)
    .where(and(eq(notableDates.id, id), eq(notableDates.tribeId, tribeId)))
    .returning({ id: notableDates.id });
  return rows.length > 0;
}

export async function listNotableDates(
  tribeId: number,
  month?: number
): Promise<NotableDate[]> {
  const conds = [eq(notableDates.tribeId, tribeId), eq(notableDates.isActive, true)];
  if (month != null) conds.push(eq(notableDates.dateMonth, month));

  const rows = await db
    .select()
    .from(notableDates)
    .where(and(...conds))
    .orderBy(
      asc(notableDates.dateMonth),
      asc(notableDates.dateDay),
      asc(notableDates.eventType),
      asc(notableDates.name)
    );
  return rows.map(mapRow);
}

export async function countNotableDates(
  tribeId: number,
  excludeHolidays: boolean = false
): Promise<number> {
  const conds = [eq(notableDates.tribeId, tribeId), eq(notableDates.isActive, true)];
  if (excludeHolidays) conds.push(ne(notableDates.eventType, "holiday"));

  const [row] = await db.select({ value: count() }).from(notableDates).where(and(...conds));
  return row.value;
}

export async function listNotableDatesPaginated(
  tribeId: number,
  limit: number,
  offset: number,
  excludeHolidays: boolean = false
): Promise<NotableDate[]> {
  const conds = [eq(notableDates.tribeId, tribeId), eq(notableDates.isActive, true)];
  if (excludeHolidays) conds.push(ne(notableDates.eventType, "holiday"));

  const rows = await db
    .select()
    .from(notableDates)
    .where(and(...conds))
    .orderBy(
      asc(notableDates.dateMonth),
      asc(notableDates.dateDay),
      asc(notableDates.eventType),
      asc(notableDates.name)
    )
    .limit(limit)
    .offset(offset);
  return rows.map(mapRow);
}

export async function getUpcomingDates(
  tribeId: number,
  days: number = 14
): Promise<NotableDate[]> {
  const pairs: Array<{ month: number; day: number }> = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    pairs.push({ month: d.getMonth() + 1, day: d.getDate() });
  }

  if (pairs.length === 0) return [];

  const dayMatch = or(
    ...pairs.map((p) => and(eq(notableDates.dateMonth, p.month), eq(notableDates.dateDay, p.day)))
  );

  const rows = await db
    .select()
    .from(notableDates)
    .where(and(eq(notableDates.tribeId, tribeId), eq(notableDates.isActive, true), dayMatch))
    .orderBy(
      asc(notableDates.dateMonth),
      asc(notableDates.dateDay),
      asc(notableDates.eventType),
      asc(notableDates.name)
    );
  return rows.map(mapRow);
}

// ─── Admin functions ────────────────────────────────────────────────────

export async function bulkDeleteDates(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .delete(notableDates)
    .where(inArray(notableDates.id, ids))
    .returning({ id: notableDates.id });
  return rows.length;
}

export async function deleteAllDates(tribeId: number): Promise<number> {
  const rows = await db
    .delete(notableDates)
    .where(eq(notableDates.tribeId, tribeId))
    .returning({ id: notableDates.id });
  return rows.length;
}

export async function getAllDatesPaginated(
  limit: number,
  offset: number
): Promise<NotableDate[]> {
  const rows = await db
    .select()
    .from(notableDates)
    .orderBy(asc(notableDates.dateMonth), asc(notableDates.dateDay), asc(notableDates.name))
    .limit(limit)
    .offset(offset);
  return rows.map(mapRow);
}

export async function countAllDates(tribeId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notableDates)
    .where(eq(notableDates.tribeId, tribeId));
  return row.value;
}

function mapRow(r: typeof notableDates.$inferSelect): NotableDate {
  return {
    id: r.id,
    tribeId: r.tribeId,
    createdByUserId: r.createdByUserId,
    name: r.name,
    dateMonth: r.dateMonth,
    dateDay: r.dateDay,
    eventType: r.eventType,
    description: r.description,
    greetingTemplate: r.greetingTemplate,
    emoji: r.emoji ?? "🎂",
    isPriority: r.isPriority ?? false,
    isActive: r.isActive ?? true,
    createdAt: r.createdAt ?? new Date(),
  };
}
