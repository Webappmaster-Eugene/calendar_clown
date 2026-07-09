/**
 * Repository for reminder_sounds table and fired-reminder queries for Mini App polling.
 */

import { and, asc, desc, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { reminderSounds, reminders, users } from "../db/schema.js";
import type { ReminderSound } from "./types.js";

// ─── Mappers ────────────────────────────────────────────────────────────

function mapSound(r: typeof reminderSounds.$inferSelect): ReminderSound {
  return {
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    filename: r.filename,
    durationSeconds: r.durationSeconds,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
    createdAt: r.createdAt,
  };
}

// ─── Queries ────────────────────────────────────────────────────────────

/** Get all active sounds ordered by sort_order. */
export async function getAvailableSounds(): Promise<ReminderSound[]> {
  const rows = await db
    .select()
    .from(reminderSounds)
    .where(eq(reminderSounds.isActive, true))
    .orderBy(asc(reminderSounds.sortOrder), asc(reminderSounds.id));
  return rows.map(mapSound);
}

/** Get a single sound by ID. */
export async function getSoundById(soundId: number): Promise<ReminderSound | null> {
  const [row] = await db.select().from(reminderSounds).where(eq(reminderSounds.id, soundId));
  if (!row) return null;
  return mapSound(row);
}

/** Fired reminder result shape. */
interface FiredReminderResult {
  id: number;
  text: string;
  firedAt: string;
  soundFile: string;
}

/**
 * Get recently fired reminders with sound enabled for a given user.
 * Used by Mini App polling to trigger audio playback.
 */
export async function getFiredRemindersWithSound(
  telegramId: number,
  since: Date
): Promise<FiredReminderResult[]> {
  const rows = await db
    .select({
      id: reminders.id,
      text: reminders.text,
      lastFiredAt: reminders.lastFiredAt,
      filename: reminderSounds.filename,
    })
    .from(reminders)
    .innerJoin(users, eq(users.id, reminders.userId))
    .innerJoin(reminderSounds, eq(reminderSounds.id, reminders.soundId))
    .where(
      and(
        eq(users.telegramId, BigInt(telegramId)),
        eq(reminders.isActive, true),
        eq(reminders.soundEnabled, true),
        isNotNull(reminders.soundId),
        gte(reminders.lastFiredAt, since)
      )
    )
    .orderBy(desc(reminders.lastFiredAt));
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    firedAt: (r.lastFiredAt as Date).toISOString(),
    soundFile: r.filename,
  }));
}
