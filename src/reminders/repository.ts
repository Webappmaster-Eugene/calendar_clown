/**
 * CRUD repository for Reminders: create/get/update/delete + subscribers.
 * All queries use raw SQL via query().
 */

import { query } from "../db/connection.js";
import type { Reminder, ReminderSchedule, ActiveReminderWithUser, ReminderSubscriber } from "./types.js";

// ─── Row types ──────────────────────────────────────────────────────────

interface ReminderRow {
  id: number;
  user_id: number;
  tribe_id: number | null;
  text: string;
  schedule: ReminderSchedule;
  is_active: boolean;
  last_fired_at: Date | null;
  input_method: string;
  created_at: Date;
  updated_at: Date;
}

// ─── Mappers ────────────────────────────────────────────────────────────

function mapReminder(r: ReminderRow): Reminder {
  return {
    id: r.id,
    userId: r.user_id,
    tribeId: r.tribe_id,
    text: r.text,
    schedule: r.schedule,
    isActive: r.is_active,
    lastFiredAt: r.last_fired_at,
    inputMethod: r.input_method,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────

export async function createReminder(
  userId: number,
  tribeId: number | null,
  text: string,
  schedule: ReminderSchedule,
  inputMethod: string = "text"
): Promise<Reminder> {
  const { rows } = await query<ReminderRow>(
    `INSERT INTO reminders (user_id, tribe_id, text, schedule, input_method)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, tribeId, text, JSON.stringify(schedule), inputMethod]
  );
  return mapReminder(rows[0]);
}

export async function getReminderById(reminderId: number): Promise<Reminder | null> {
  const { rows } = await query<ReminderRow>(
    "SELECT * FROM reminders WHERE id = $1",
    [reminderId]
  );
  if (rows.length === 0) return null;
  return mapReminder(rows[0]);
}

export async function getRemindersByUser(userId: number): Promise<Reminder[]> {
  const { rows } = await query<ReminderRow>(
    "SELECT * FROM reminders WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(mapReminder);
}

export async function countActiveReminders(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM reminders WHERE user_id = $1 AND is_active = true",
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

export async function updateReminderText(reminderId: number, userId: number, text: string): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE reminders SET text = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3",
    [text, reminderId, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function updateReminderSchedule(
  reminderId: number,
  userId: number,
  schedule: ReminderSchedule
): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE reminders SET schedule = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3",
    [JSON.stringify(schedule), reminderId, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function toggleReminderActive(reminderId: number, userId: number): Promise<Reminder | null> {
  const { rows } = await query<ReminderRow>(
    `UPDATE reminders SET is_active = NOT is_active, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [reminderId, userId]
  );
  if (rows.length === 0) return null;
  return mapReminder(rows[0]);
}

export async function deleteReminder(reminderId: number, userId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM reminders WHERE id = $1 AND user_id = $2",
    [reminderId, userId]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Scheduler queries ──────────────────────────────────────────────────

export async function getActiveRemindersWithUsers(): Promise<ActiveReminderWithUser[]> {
  const { rows } = await query<ReminderRow & { telegram_id: string }>(
    `SELECT r.*, u.telegram_id
     FROM reminders r
     JOIN users u ON u.id = r.user_id
     WHERE r.is_active = true
     ORDER BY r.id`,
    []
  );
  return rows.map((r) => ({
    ...mapReminder(r),
    telegramId: Number(r.telegram_id),
  }));
}

export async function updateLastFiredAt(reminderId: number): Promise<void> {
  await query(
    "UPDATE reminders SET last_fired_at = NOW() WHERE id = $1",
    [reminderId]
  );
}

export async function deactivateReminder(reminderId: number): Promise<void> {
  await query(
    "UPDATE reminders SET is_active = false, updated_at = NOW() WHERE id = $1",
    [reminderId]
  );
}

// ─── Subscribers ────────────────────────────────────────────────────────

export async function addSubscriber(reminderId: number, subscriberUserId: number): Promise<void> {
  await query(
    `INSERT INTO reminder_subscribers (reminder_id, subscriber_user_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [reminderId, subscriberUserId]
  );
}

export async function removeSubscriber(reminderId: number, subscriberUserId: number): Promise<void> {
  await query(
    "DELETE FROM reminder_subscribers WHERE reminder_id = $1 AND subscriber_user_id = $2",
    [reminderId, subscriberUserId]
  );
}

export async function getSubscribers(reminderId: number): Promise<ReminderSubscriber[]> {
  const { rows } = await query<{
    id: number;
    reminder_id: number;
    subscriber_user_id: number;
    created_at: Date;
    telegram_id: string;
    first_name: string;
  }>(
    `SELECT rs.*, u.telegram_id, u.first_name
     FROM reminder_subscribers rs
     JOIN users u ON u.id = rs.subscriber_user_id
     WHERE rs.reminder_id = $1
     ORDER BY u.first_name`,
    [reminderId]
  );
  return rows.map((r) => ({
    id: r.id,
    reminderId: r.reminder_id,
    subscriberUserId: r.subscriber_user_id,
    createdAt: r.created_at,
    subscriberTelegramId: Number(r.telegram_id),
    subscriberName: r.first_name,
  }));
}

export async function isSubscribed(reminderId: number, subscriberUserId: number): Promise<boolean> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM reminder_subscribers WHERE reminder_id = $1 AND subscriber_user_id = $2",
    [reminderId, subscriberUserId]
  );
  return parseInt(rows[0].count, 10) > 0;
}

// ─── Tribe queries ──────────────────────────────────────────────────────

export async function getTribeReminders(tribeId: number, excludeUserId: number): Promise<(Reminder & { ownerName: string })[]> {
  const { rows } = await query<ReminderRow & { first_name: string }>(
    `SELECT r.*, u.first_name
     FROM reminders r
     JOIN users u ON u.id = r.user_id
     WHERE r.tribe_id = $1 AND r.user_id != $2 AND r.is_active = true
     ORDER BY u.first_name, r.created_at DESC`,
    [tribeId, excludeUserId]
  );
  return rows.map((r) => ({
    ...mapReminder(r),
    ownerName: r.first_name,
  }));
}

export async function getTribeUserReminders(userId: number): Promise<Reminder[]> {
  const { rows } = await query<ReminderRow>(
    "SELECT * FROM reminders WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(mapReminder);
}
