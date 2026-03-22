/**
 * CRUD repository for Goals mode: goal sets, goals, viewers, reminders.
 * All queries use raw SQL via query().
 */

import { query } from "../db/connection.js";
import type { GoalPeriod } from "./service.js";

// ─── Types ──────────────────────────────────────────────────────────────

export type GoalSetVisibility = "public" | "private";

export interface GoalSet {
  id: number;
  userId: number;
  name: string;
  emoji: string;
  period: GoalPeriod;
  visibility: GoalSetVisibility;
  deadline: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedCount?: number;
  totalCount?: number;
}

export interface Goal {
  id: number;
  goalSetId: number;
  text: string;
  isCompleted: boolean;
  inputMethod: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoalSetViewer {
  id: number;
  goalSetId: number;
  viewerUserId: number;
  createdAt: Date;
  viewerName?: string;
}

export interface GoalReminder {
  id: number;
  goalSetId: number;
  remindAt: Date;
  sent: boolean;
  sentAt: Date | null;
  createdAt: Date;
}

export interface PendingReminder {
  reminderId: number;
  goalSetId: number;
  goalSetName: string;
  goalSetEmoji: string;
  telegramId: number;
  userId: number;
}

// ─── Row types ──────────────────────────────────────────────────────────

interface GoalSetRow {
  id: number;
  user_id: number;
  name: string;
  emoji: string;
  period: GoalPeriod;
  visibility: GoalSetVisibility;
  deadline: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface GoalRow {
  id: number;
  goal_set_id: number;
  text: string;
  is_completed: boolean;
  input_method: string;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ─── Goal Sets ──────────────────────────────────────────────────────────

export async function createGoalSet(
  userId: number,
  name: string,
  period: GoalPeriod,
  deadline: Date | null,
  emoji: string = "🎯"
): Promise<GoalSet> {
  const { rows } = await query<GoalSetRow>(
    `INSERT INTO goal_sets (user_id, name, period, deadline, emoji)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, name, period, deadline, emoji]
  );
  return mapGoalSet(rows[0]);
}

export async function getGoalSetsByUser(userId: number): Promise<GoalSet[]> {
  const { rows } = await query<GoalSetRow & { completed_count: string; total_count: string }>(
    `SELECT gs.*,
       COUNT(g.id) AS total_count,
       COUNT(g.id) FILTER (WHERE g.is_completed = true) AS completed_count
     FROM goal_sets gs
     LEFT JOIN goals g ON g.goal_set_id = gs.id
     WHERE gs.user_id = $1
     GROUP BY gs.id
     ORDER BY gs.created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    ...mapGoalSet(r),
    completedCount: parseInt(r.completed_count, 10),
    totalCount: parseInt(r.total_count, 10),
  }));
}

export async function getGoalSetById(goalSetId: number): Promise<GoalSet | null> {
  const { rows } = await query<GoalSetRow & { completed_count: string; total_count: string }>(
    `SELECT gs.*,
       COUNT(g.id) AS total_count,
       COUNT(g.id) FILTER (WHERE g.is_completed = true) AS completed_count
     FROM goal_sets gs
     LEFT JOIN goals g ON g.goal_set_id = gs.id
     WHERE gs.id = $1
     GROUP BY gs.id`,
    [goalSetId]
  );
  if (rows.length === 0) return null;
  return {
    ...mapGoalSet(rows[0]),
    completedCount: parseInt(rows[0].completed_count, 10),
    totalCount: parseInt(rows[0].total_count, 10),
  };
}

export async function updateGoalSet(
  goalSetId: number,
  userId: number,
  updates: { name?: string; emoji?: string; visibility?: GoalSetVisibility }
): Promise<GoalSet | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (updates.name !== undefined) {
    sets.push(`name = $${idx++}`);
    params.push(updates.name);
  }
  if (updates.emoji !== undefined) {
    sets.push(`emoji = $${idx++}`);
    params.push(updates.emoji);
  }
  if (updates.visibility !== undefined) {
    sets.push(`visibility = $${idx++}`);
    params.push(updates.visibility);
  }

  if (sets.length === 0) return getGoalSetById(goalSetId);

  sets.push(`updated_at = NOW()`);
  params.push(goalSetId, userId);

  const { rows } = await query<GoalSetRow>(
    `UPDATE goal_sets SET ${sets.join(", ")}
     WHERE id = $${idx++} AND user_id = $${idx}
     RETURNING *`,
    params
  );
  if (rows.length === 0) return null;
  return mapGoalSet(rows[0]);
}

export async function deleteGoalSet(goalSetId: number, userId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM goal_sets WHERE id = $1 AND user_id = $2",
    [goalSetId, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function countGoalSetsByUser(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM goal_sets WHERE user_id = $1",
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

// ─── Goals ──────────────────────────────────────────────────────────────

export async function createGoal(
  goalSetId: number,
  text: string,
  inputMethod: string = "text"
): Promise<Goal> {
  const { rows } = await query<GoalRow>(
    `INSERT INTO goals (goal_set_id, text, input_method)
     VALUES ($1, $2, $3) RETURNING *`,
    [goalSetId, text, inputMethod]
  );
  return mapGoal(rows[0]);
}

export async function getGoalsBySet(goalSetId: number): Promise<Goal[]> {
  const { rows } = await query<GoalRow>(
    `SELECT * FROM goals WHERE goal_set_id = $1 ORDER BY created_at`,
    [goalSetId]
  );
  return rows.map(mapGoal);
}

export async function toggleGoalCompleted(goalId: number): Promise<Goal | null> {
  const { rows } = await query<GoalRow>(
    `UPDATE goals
     SET is_completed = NOT is_completed,
         completed_at = CASE WHEN NOT is_completed THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [goalId]
  );
  if (rows.length === 0) return null;
  return mapGoal(rows[0]);
}

export async function deleteGoal(goalId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM goals WHERE id = $1",
    [goalId]
  );
  return (rowCount ?? 0) > 0;
}

export async function getGoalSetProgress(goalSetId: number): Promise<{ completed: number; total: number }> {
  const { rows } = await query<{ total: string; completed: string }>(
    `SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE is_completed = true) AS completed
     FROM goals WHERE goal_set_id = $1`,
    [goalSetId]
  );
  return {
    total: parseInt(rows[0].total, 10),
    completed: parseInt(rows[0].completed, 10),
  };
}

// ─── Viewers ────────────────────────────────────────────────────────────

export async function addViewer(goalSetId: number, viewerUserId: number): Promise<void> {
  await query(
    `INSERT INTO goal_set_viewers (goal_set_id, viewer_user_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [goalSetId, viewerUserId]
  );
}

export async function removeViewer(goalSetId: number, viewerUserId: number): Promise<void> {
  await query(
    "DELETE FROM goal_set_viewers WHERE goal_set_id = $1 AND viewer_user_id = $2",
    [goalSetId, viewerUserId]
  );
}

export async function getViewersByGoalSet(goalSetId: number): Promise<GoalSetViewer[]> {
  const { rows } = await query<{
    id: number;
    goal_set_id: number;
    viewer_user_id: number;
    created_at: Date;
    first_name: string;
  }>(
    `SELECT gsv.*, u.first_name
     FROM goal_set_viewers gsv
     JOIN users u ON u.id = gsv.viewer_user_id
     WHERE gsv.goal_set_id = $1
     ORDER BY u.first_name`,
    [goalSetId]
  );
  return rows.map((r) => ({
    id: r.id,
    goalSetId: r.goal_set_id,
    viewerUserId: r.viewer_user_id,
    createdAt: r.created_at,
    viewerName: r.first_name,
  }));
}

export async function getPublicGoalSetsForViewer(viewerUserId: number): Promise<(GoalSet & { ownerName: string })[]> {
  const { rows } = await query<GoalSetRow & { completed_count: string; total_count: string; first_name: string }>(
    `SELECT gs.*, u.first_name,
       COUNT(g.id) AS total_count,
       COUNT(g.id) FILTER (WHERE g.is_completed = true) AS completed_count
     FROM goal_sets gs
     JOIN goal_set_viewers gsv ON gsv.goal_set_id = gs.id
     JOIN users u ON u.id = gs.user_id
     LEFT JOIN goals g ON g.goal_set_id = gs.id
     WHERE gsv.viewer_user_id = $1 AND gs.visibility = 'public'
     GROUP BY gs.id, u.first_name
     ORDER BY u.first_name, gs.name`,
    [viewerUserId]
  );
  return rows.map((r) => ({
    ...mapGoalSet(r),
    completedCount: parseInt(r.completed_count, 10),
    totalCount: parseInt(r.total_count, 10),
    ownerName: r.first_name,
  }));
}

// ─── Reminders ──────────────────────────────────────────────────────────

export async function createReminders(goalSetId: number, dates: Date[]): Promise<void> {
  if (dates.length === 0) return;

  const values = dates.map((_, i) => `($1, $${i + 2})`).join(", ");
  const params: unknown[] = [goalSetId, ...dates];

  await query(
    `INSERT INTO goal_reminders (goal_set_id, remind_at) VALUES ${values}`,
    params
  );
}

export async function getPendingReminders(now: Date): Promise<PendingReminder[]> {
  const { rows } = await query<{
    reminder_id: number;
    goal_set_id: number;
    goal_set_name: string;
    goal_set_emoji: string;
    telegram_id: string;
    user_id: number;
  }>(
    `SELECT gr.id AS reminder_id, gs.id AS goal_set_id, gs.name AS goal_set_name,
       gs.emoji AS goal_set_emoji, u.telegram_id, u.id AS user_id
     FROM goal_reminders gr
     JOIN goal_sets gs ON gs.id = gr.goal_set_id
     JOIN users u ON u.id = gs.user_id
     WHERE gr.sent = false AND gr.remind_at <= $1
     ORDER BY gr.remind_at`,
    [now]
  );
  return rows.map((r) => ({
    reminderId: r.reminder_id,
    goalSetId: r.goal_set_id,
    goalSetName: r.goal_set_name,
    goalSetEmoji: r.goal_set_emoji,
    telegramId: Number(r.telegram_id),
    userId: r.user_id,
  }));
}

export async function markReminderSent(reminderId: number): Promise<void> {
  await query(
    "UPDATE goal_reminders SET sent = true, sent_at = NOW() WHERE id = $1",
    [reminderId]
  );
}

// ─── Admin functions ────────────────────────────────────────────────────

/** Admin: get all goal sets paginated (all users, with user info and progress). */
export async function getAllGoalSetsPaginated(
  limit: number,
  offset: number
): Promise<Array<GoalSet & { firstName: string; completedCount: number; totalCount: number }>> {
  const { rows } = await query<GoalSetRow & { first_name: string; completed_count: string; total_count: string }>(
    `SELECT gs.*, u.first_name,
       COUNT(g.id) AS total_count,
       COUNT(g.id) FILTER (WHERE g.is_completed = true) AS completed_count
     FROM goal_sets gs
     JOIN users u ON u.id = gs.user_id
     LEFT JOIN goals g ON g.goal_set_id = gs.id
     GROUP BY gs.id, u.first_name
     ORDER BY gs.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map((r) => ({
    ...mapGoalSet(r),
    firstName: r.first_name,
    completedCount: parseInt(r.completed_count, 10),
    totalCount: parseInt(r.total_count, 10),
  }));
}

/** Admin: count all goal sets. */
export async function countAllGoalSets(): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM goal_sets"
  );
  return parseInt(rows[0].count, 10);
}

/** Admin: bulk delete goal sets by IDs. */
export async function bulkDeleteGoalSets(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await query(
    "DELETE FROM goal_sets WHERE id = ANY($1)",
    [ids]
  );
  return rowCount ?? 0;
}

/** Admin: delete ALL goal sets. */
export async function deleteAllGoalSets(): Promise<number> {
  const { rowCount } = await query("DELETE FROM goal_sets");
  return rowCount ?? 0;
}

// ─── Mappers ────────────────────────────────────────────────────────────

function mapGoalSet(r: GoalSetRow): GoalSet {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    emoji: r.emoji,
    period: r.period,
    visibility: r.visibility,
    deadline: r.deadline,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapGoal(r: GoalRow): Goal {
  return {
    id: r.id,
    goalSetId: r.goal_set_id,
    text: r.text,
    isCompleted: r.is_completed,
    inputMethod: r.input_method,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
