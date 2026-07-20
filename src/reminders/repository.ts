import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { reminderSounds, reminderSubscribers, reminders, users } from "../db/schema.js";
import type { Reminder, ReminderSchedule, ActiveReminderWithUser, ReminderSubscriber } from "./types.js";

// ─── Mappers ────────────────────────────────────────────────────────────

function mapReminder(r: typeof reminders.$inferSelect): Reminder {
  return {
    id: r.id,
    userId: r.userId,
    tribeId: r.tribeId,
    text: r.text,
    schedule: r.schedule as ReminderSchedule,
    isActive: r.isActive,
    lastFiredAt: r.lastFiredAt,
    inputMethod: r.inputMethod,
    soundId: r.soundId,
    soundEnabled: r.soundEnabled,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────

export async function createReminder(
  userId: number,
  tribeId: number | null,
  text: string,
  schedule: ReminderSchedule,
  inputMethod: string = "text",
  soundId: number | null = null,
  soundEnabled: boolean = false
): Promise<Reminder> {
  const [row] = await db
    .insert(reminders)
    .values({ userId, tribeId, text, schedule, inputMethod, soundId, soundEnabled })
    .returning();
  return mapReminder(row);
}

export async function getReminderById(reminderId: number): Promise<Reminder | null> {
  const [row] = await db.select().from(reminders).where(eq(reminders.id, reminderId));
  if (!row) return null;
  return mapReminder(row);
}

export async function getRemindersByUser(userId: number): Promise<Reminder[]> {
  const rows = await db
    .select()
    .from(reminders)
    .where(eq(reminders.userId, userId))
    .orderBy(desc(reminders.createdAt));
  return rows.map(mapReminder);
}

export async function countActiveReminders(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(reminders)
    .where(and(eq(reminders.userId, userId), eq(reminders.isActive, true)));
  return row.value;
}

export async function updateReminderText(reminderId: number, userId: number, text: string): Promise<boolean> {
  const rows = await db
    .update(reminders)
    .set({ text, updatedAt: sql`now()` })
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)))
    .returning({ id: reminders.id });
  return rows.length > 0;
}

export async function updateReminderSchedule(
  reminderId: number,
  userId: number,
  schedule: ReminderSchedule
): Promise<boolean> {
  const rows = await db
    .update(reminders)
    .set({ schedule, updatedAt: sql`now()` })
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)))
    .returning({ id: reminders.id });
  return rows.length > 0;
}

export async function toggleReminderActive(reminderId: number, userId: number): Promise<Reminder | null> {
  const [row] = await db
    .update(reminders)
    .set({ isActive: sql`not ${reminders.isActive}`, updatedAt: sql`now()` })
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)))
    .returning();
  if (!row) return null;
  return mapReminder(row);
}

export async function deleteReminder(reminderId: number, userId: number): Promise<boolean> {
  const rows = await db
    .delete(reminders)
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)))
    .returning({ id: reminders.id });
  return rows.length > 0;
}

export async function updateReminderSound(
  reminderId: number,
  userId: number,
  soundId: number | null,
  soundEnabled: boolean
): Promise<boolean> {
  const rows = await db
    .update(reminders)
    .set({ soundId, soundEnabled, updatedAt: sql`now()` })
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)))
    .returning({ id: reminders.id });
  return rows.length > 0;
}

// ─── Scheduler queries ──────────────────────────────────────────────────

export async function getActiveRemindersWithUsers(): Promise<ActiveReminderWithUser[]> {
  const rows = await db
    .select({
      reminder: reminders,
      telegramId: users.telegramId,
      soundFilename: reminderSounds.filename,
    })
    .from(reminders)
    .innerJoin(users, eq(users.id, reminders.userId))
    .leftJoin(
      reminderSounds,
      and(eq(reminderSounds.id, reminders.soundId), eq(reminders.soundEnabled, true))
    )
    .where(eq(reminders.isActive, true))
    .orderBy(reminders.id);
  return rows.map((r) => ({
    ...mapReminder(r.reminder),
    telegramId: Number(r.telegramId),
    soundFilename: r.soundFilename,
  }));
}

export async function updateLastFiredAt(reminderId: number): Promise<void> {
  await db.update(reminders).set({ lastFiredAt: sql`now()` }).where(eq(reminders.id, reminderId));
}

export async function deactivateReminder(reminderId: number): Promise<void> {
  await db
    .update(reminders)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(eq(reminders.id, reminderId));
}

// ─── Subscribers ────────────────────────────────────────────────────────

export async function addSubscriber(reminderId: number, subscriberUserId: number): Promise<void> {
  await db.insert(reminderSubscribers).values({ reminderId, subscriberUserId }).onConflictDoNothing();
}

export async function removeSubscriber(reminderId: number, subscriberUserId: number): Promise<void> {
  await db
    .delete(reminderSubscribers)
    .where(
      and(
        eq(reminderSubscribers.reminderId, reminderId),
        eq(reminderSubscribers.subscriberUserId, subscriberUserId)
      )
    );
}

export async function getSubscribers(reminderId: number): Promise<ReminderSubscriber[]> {
  const rows = await db
    .select({
      id: reminderSubscribers.id,
      reminderId: reminderSubscribers.reminderId,
      subscriberUserId: reminderSubscribers.subscriberUserId,
      createdAt: reminderSubscribers.createdAt,
      telegramId: users.telegramId,
      firstName: users.firstName,
    })
    .from(reminderSubscribers)
    .innerJoin(users, eq(users.id, reminderSubscribers.subscriberUserId))
    .where(eq(reminderSubscribers.reminderId, reminderId))
    .orderBy(users.firstName);
  return rows.map((r) => ({
    id: r.id,
    reminderId: r.reminderId,
    subscriberUserId: r.subscriberUserId,
    createdAt: r.createdAt,
    subscriberTelegramId: Number(r.telegramId),
    subscriberName: r.firstName,
  }));
}

export async function isSubscribed(reminderId: number, subscriberUserId: number): Promise<boolean> {
  const [row] = await db
    .select({ value: count() })
    .from(reminderSubscribers)
    .where(
      and(
        eq(reminderSubscribers.reminderId, reminderId),
        eq(reminderSubscribers.subscriberUserId, subscriberUserId)
      )
    );
  return row.value > 0;
}

// ─── Admin functions ────────────────────────────────────────────────────

export async function getAllRemindersPaginated(
  limit: number,
  offset: number
): Promise<Array<Reminder & { firstName: string }>> {
  const rows = await db
    .select({ reminder: reminders, firstName: users.firstName })
    .from(reminders)
    .innerJoin(users, eq(users.id, reminders.userId))
    .orderBy(desc(reminders.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({ ...mapReminder(r.reminder), firstName: r.firstName }));
}

export async function countAllReminders(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(reminders);
  return row.value;
}

export async function bulkDeleteReminders(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.delete(reminders).where(inArray(reminders.id, ids)).returning({ id: reminders.id });
  return rows.length;
}

export async function deleteAllReminders(): Promise<number> {
  const rows = await db.delete(reminders).returning({ id: reminders.id });
  return rows.length;
}

// ─── Tribe queries ──────────────────────────────────────────────────────

export async function getTribeReminders(tribeId: number, excludeUserId: number): Promise<(Reminder & { ownerName: string })[]> {
  const rows = await db
    .select({ reminder: reminders, firstName: users.firstName })
    .from(reminders)
    .innerJoin(users, eq(users.id, reminders.userId))
    .where(
      and(
        eq(reminders.tribeId, tribeId),
        ne(reminders.userId, excludeUserId),
        eq(reminders.isActive, true)
      )
    )
    .orderBy(users.firstName, desc(reminders.createdAt));
  return rows.map((r) => ({
    ...mapReminder(r.reminder),
    ownerName: r.firstName,
  }));
}

export async function getTribeUserReminders(userId: number): Promise<Reminder[]> {
  const rows = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.userId, userId), eq(reminders.isActive, true)))
    .orderBy(desc(reminders.createdAt));
  return rows.map(mapReminder);
}
