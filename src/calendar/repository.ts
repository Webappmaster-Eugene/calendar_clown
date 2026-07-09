import { and, desc, eq, inArray, ne, count, sql } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { calendarEvents, users } from "../db/schema.js";
import type { CalendarEventRecord, CreateCalendarEventParams } from "./types.js";

/** Insert a calendar event record into the database. */
export async function saveCalendarEvent(params: CreateCalendarEventParams): Promise<CalendarEventRecord> {
  const [r] = await db
    .insert(calendarEvents)
    .values({
      userId: params.userId,
      tribeId: params.tribeId as number,
      googleEventId: params.googleEventId,
      summary: params.summary,
      description: params.description ?? null,
      startTime: params.startTime,
      endTime: params.endTime,
      recurrence: params.recurrence ?? null,
      inputMethod: params.inputMethod,
      status: params.status,
      errorMessage: params.errorMessage ?? null,
      htmlLink: params.htmlLink ?? null,
    })
    .returning();

  return mapRow(r);
}

/** Mark a calendar event as deleted by its Google Event ID. Returns true if a row was updated. */
export async function markEventDeleted(googleEventId: string, userId: number): Promise<boolean> {
  const rows = await db
    .update(calendarEvents)
    .set({ status: "deleted", deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(calendarEvents.googleEventId, googleEventId),
        eq(calendarEvents.userId, userId),
        eq(calendarEvents.status, "created"),
      ),
    )
    .returning({ id: calendarEvents.id });
  return rows.length > 0;
}

// ─── Admin functions ────────────────────────────────────────────────────

/** Admin: get all calendar events paginated (all users). */
export async function getAllEventsPaginated(
  limit: number,
  offset: number
): Promise<Array<CalendarEventRecord & { firstName: string }>> {
  const rows = await db
    .select({ event: calendarEvents, firstName: users.firstName })
    .from(calendarEvents)
    .innerJoin(users, eq(users.id, calendarEvents.userId))
    .orderBy(desc(calendarEvents.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({ ...mapRow(r.event), firstName: r.firstName }));
}

/** Admin: count all calendar events. */
export async function countAllEvents(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(calendarEvents);
  return row.value;
}

/** Admin: bulk soft-delete calendar events (set status='deleted'). */
export async function bulkDeleteEvents(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(calendarEvents)
    .set({ status: "deleted", deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(inArray(calendarEvents.id, ids), ne(calendarEvents.status, "deleted")))
    .returning({ id: calendarEvents.id });
  return rows.length;
}

/** Admin: soft-delete all calendar events. */
export async function deleteAllEvents(): Promise<number> {
  const rows = await db
    .update(calendarEvents)
    .set({ status: "deleted", deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(ne(calendarEvents.status, "deleted"))
    .returning({ id: calendarEvents.id });
  return rows.length;
}

function mapRow(r: typeof calendarEvents.$inferSelect): CalendarEventRecord {
  return {
    id: r.id,
    userId: r.userId,
    tribeId: r.tribeId,
    googleEventId: r.googleEventId,
    summary: r.summary,
    description: r.description,
    startTime: r.startTime,
    endTime: r.endTime,
    recurrence: r.recurrence,
    inputMethod: r.inputMethod as CalendarEventRecord["inputMethod"],
    status: r.status as CalendarEventRecord["status"],
    errorMessage: r.errorMessage,
    htmlLink: r.htmlLink,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  };
}
