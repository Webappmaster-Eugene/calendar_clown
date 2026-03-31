/**
 * Repository for reminder_sounds table and fired-reminder queries for Mini App polling.
 */

import { query } from "../db/connection.js";
import type { ReminderSound } from "./types.js";

// ─── Row types ──────────────────────────────────────────────────────────

interface ReminderSoundRow {
  id: number;
  name: string;
  emoji: string;
  filename: string;
  duration_seconds: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
}

interface FiredReminderRow {
  id: number;
  text: string;
  last_fired_at: Date;
  filename: string;
}

// ─── Mappers ────────────────────────────────────────────────────────────

function mapSound(r: ReminderSoundRow): ReminderSound {
  return {
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    filename: r.filename,
    durationSeconds: r.duration_seconds,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}

// ─── Queries ────────────────────────────────────────────────────────────

/** Get all active sounds ordered by sort_order. */
export async function getAvailableSounds(): Promise<ReminderSound[]> {
  const { rows } = await query<ReminderSoundRow>(
    "SELECT * FROM reminder_sounds WHERE is_active = true ORDER BY sort_order, id"
  );
  return rows.map(mapSound);
}

/** Get a single sound by ID. */
export async function getSoundById(soundId: number): Promise<ReminderSound | null> {
  const { rows } = await query<ReminderSoundRow>(
    "SELECT * FROM reminder_sounds WHERE id = $1",
    [soundId]
  );
  if (rows.length === 0) return null;
  return mapSound(rows[0]);
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
  const { rows } = await query<FiredReminderRow>(
    `SELECT r.id, r.text, r.last_fired_at, rs.filename
     FROM reminders r
     JOIN users u ON u.id = r.user_id
     JOIN reminder_sounds rs ON rs.id = r.sound_id
     WHERE u.telegram_id = $1
       AND r.is_active = true
       AND r.sound_enabled = true
       AND r.sound_id IS NOT NULL
       AND r.last_fired_at >= $2
     ORDER BY r.last_fired_at DESC`,
    [telegramId, since]
  );
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    firedAt: r.last_fired_at.toISOString(),
    soundFile: r.filename,
  }));
}
