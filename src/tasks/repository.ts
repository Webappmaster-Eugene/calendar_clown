/**
 * CRUD repository for Task Tracker: task works, task items, task reminders.
 * All queries use raw SQL via query().
 */

import { query } from "../db/connection.js";

// ─── Domain Types ────────────────────────────────────────────────────────

export interface TaskWork {
  id: number;
  userId: number;
  name: string;
  emoji: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  activeCount?: number;
  completedCount?: number;
}

export interface TaskItem {
  id: number;
  workId: number;
  text: string;
  deadline: Date;
  isCompleted: boolean;
  completedAt: Date | null;
  inputMethod: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PendingTaskReminder {
  reminderId: number;
  taskItemId: number;
  taskText: string;
  deadline: Date;
  workName: string;
  workEmoji: string;
  reminderType: string;
  telegramId: number;
  userId: number;
}

// ─── Row Types (snake_case) ──────────────────────────────────────────────

interface TaskWorkRow {
  id: number;
  user_id: number;
  name: string;
  emoji: string;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
}

interface TaskItemRow {
  id: number;
  work_id: number;
  text: string;
  deadline: Date;
  is_completed: boolean;
  completed_at: Date | null;
  input_method: string;
  created_at: Date;
  updated_at: Date;
}

interface PendingReminderRow {
  reminder_id: number;
  task_item_id: number;
  task_text: string;
  deadline: Date;
  work_name: string;
  work_emoji: string;
  reminder_type: string;
  telegram_id: string; // bigint comes as string
  user_id: number;
}

// ─── Mappers ─────────────────────────────────────────────────────────────

function mapTaskWork(r: TaskWorkRow): TaskWork {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    emoji: r.emoji,
    isArchived: r.is_archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapTaskItem(r: TaskItemRow): TaskItem {
  return {
    id: r.id,
    workId: r.work_id,
    text: r.text,
    deadline: r.deadline,
    isCompleted: r.is_completed,
    completedAt: r.completed_at,
    inputMethod: r.input_method,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─── Task Works ──────────────────────────────────────────────────────────

export async function createTaskWork(
  userId: number,
  name: string,
  emoji: string = "📋",
): Promise<TaskWork> {
  const { rows } = await query<TaskWorkRow>(
    `INSERT INTO task_works (user_id, name, emoji)
     VALUES ($1, $2, $3) RETURNING *`,
    [userId, name, emoji],
  );
  return mapTaskWork(rows[0]);
}

export async function getTaskWorksByUser(userId: number): Promise<TaskWork[]> {
  const { rows } = await query<TaskWorkRow & { active_count: string; completed_count: string }>(
    `SELECT tw.*,
       COUNT(ti.id) FILTER (WHERE ti.is_completed = false) AS active_count,
       COUNT(ti.id) FILTER (WHERE ti.is_completed = true) AS completed_count
     FROM task_works tw
     LEFT JOIN task_items ti ON ti.work_id = tw.id
     WHERE tw.user_id = $1 AND tw.is_archived = false
     GROUP BY tw.id
     ORDER BY tw.created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    ...mapTaskWork(r),
    activeCount: parseInt(r.active_count, 10),
    completedCount: parseInt(r.completed_count, 10),
  }));
}

export async function getTaskWorkById(workId: number): Promise<TaskWork | null> {
  const { rows } = await query<TaskWorkRow & { active_count: string; completed_count: string }>(
    `SELECT tw.*,
       COUNT(ti.id) FILTER (WHERE ti.is_completed = false) AS active_count,
       COUNT(ti.id) FILTER (WHERE ti.is_completed = true) AS completed_count
     FROM task_works tw
     LEFT JOIN task_items ti ON ti.work_id = tw.id
     WHERE tw.id = $1
     GROUP BY tw.id`,
    [workId],
  );
  if (rows.length === 0) return null;
  return {
    ...mapTaskWork(rows[0]),
    activeCount: parseInt(rows[0].active_count, 10),
    completedCount: parseInt(rows[0].completed_count, 10),
  };
}

export async function getTaskWorkByName(userId: number, name: string): Promise<TaskWork | null> {
  const { rows } = await query<TaskWorkRow>(
    `SELECT * FROM task_works WHERE user_id = $1 AND LOWER(name) = LOWER($2)`,
    [userId, name],
  );
  if (rows.length === 0) return null;
  return mapTaskWork(rows[0]);
}

export async function updateTaskWork(
  workId: number,
  userId: number,
  updates: { name?: string; emoji?: string; isArchived?: boolean },
): Promise<TaskWork | null> {
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
  if (updates.isArchived !== undefined) {
    sets.push(`is_archived = $${idx++}`);
    params.push(updates.isArchived);
  }

  if (sets.length === 0) return getTaskWorkById(workId);

  sets.push(`updated_at = NOW()`);
  params.push(workId, userId);

  const { rows } = await query<TaskWorkRow>(
    `UPDATE task_works SET ${sets.join(", ")}
     WHERE id = $${idx++} AND user_id = $${idx}
     RETURNING *`,
    params,
  );
  if (rows.length === 0) return null;
  return mapTaskWork(rows[0]);
}

export async function deleteTaskWork(workId: number, userId: number): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM task_works WHERE id = $1 AND user_id = $2`,
    [workId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function countTaskWorksByUser(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM task_works WHERE user_id = $1 AND is_archived = false`,
    [userId],
  );
  return parseInt(rows[0].count, 10);
}

// ─── Task Items ──────────────────────────────────────────────────────────

export async function createTaskItem(
  workId: number,
  text: string,
  deadline: Date,
  inputMethod: string = "text",
): Promise<TaskItem> {
  const { rows } = await query<TaskItemRow>(
    `INSERT INTO task_items (work_id, text, deadline, input_method)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [workId, text, deadline, inputMethod],
  );
  return mapTaskItem(rows[0]);
}

export async function getTaskItemsByWork(workId: number): Promise<TaskItem[]> {
  const { rows } = await query<TaskItemRow>(
    `SELECT * FROM task_items WHERE work_id = $1 ORDER BY deadline ASC`,
    [workId],
  );
  return rows.map(mapTaskItem);
}

export async function getActiveTaskItemsByWork(workId: number): Promise<TaskItem[]> {
  const { rows } = await query<TaskItemRow>(
    `SELECT * FROM task_items WHERE work_id = $1 AND is_completed = false ORDER BY deadline ASC`,
    [workId],
  );
  return rows.map(mapTaskItem);
}

export async function getTaskItemById(taskItemId: number): Promise<TaskItem | null> {
  const { rows } = await query<TaskItemRow>(
    `SELECT * FROM task_items WHERE id = $1`,
    [taskItemId],
  );
  if (rows.length === 0) return null;
  return mapTaskItem(rows[0]);
}

export async function toggleTaskItemCompleted(taskItemId: number): Promise<TaskItem | null> {
  const { rows } = await query<TaskItemRow>(
    `UPDATE task_items
     SET is_completed = NOT is_completed,
         completed_at = CASE WHEN is_completed THEN NULL ELSE NOW() END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [taskItemId],
  );
  if (rows.length === 0) return null;
  return mapTaskItem(rows[0]);
}

export async function updateTaskItemText(taskItemId: number, text: string): Promise<TaskItem | null> {
  const { rows } = await query<TaskItemRow>(
    `UPDATE task_items SET text = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [text, taskItemId],
  );
  if (rows.length === 0) return null;
  return mapTaskItem(rows[0]);
}

export async function updateTaskItemDeadline(taskItemId: number, deadline: Date): Promise<TaskItem | null> {
  const { rows } = await query<TaskItemRow>(
    `UPDATE task_items SET deadline = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [deadline, taskItemId],
  );
  if (rows.length === 0) return null;
  return mapTaskItem(rows[0]);
}

export async function deleteTaskItem(taskItemId: number): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM task_items WHERE id = $1`,
    [taskItemId],
  );
  return (rowCount ?? 0) > 0;
}

export async function countTaskItemsByWork(workId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM task_items WHERE work_id = $1`,
    [workId],
  );
  return parseInt(rows[0].count, 10);
}

export async function getCompletedTaskItems(workId: number): Promise<TaskItem[]> {
  const { rows } = await query<TaskItemRow>(
    `SELECT * FROM task_items
     WHERE work_id = $1 AND is_completed = true
     ORDER BY completed_at DESC`,
    [workId],
  );
  return rows.map(mapTaskItem);
}

/**
 * Get the work that owns a given task item, verifying user ownership.
 * Returns null if item doesn't exist or user doesn't own the work.
 */
export async function getTaskItemWithOwnership(
  taskItemId: number,
  userId: number,
): Promise<{ item: TaskItem; work: TaskWork } | null> {
  const { rows } = await query<TaskItemRow & { w_id: number; w_user_id: number; w_name: string; w_emoji: string; w_is_archived: boolean; w_created_at: Date; w_updated_at: Date }>(
    `SELECT ti.*,
       tw.id AS w_id, tw.user_id AS w_user_id, tw.name AS w_name,
       tw.emoji AS w_emoji, tw.is_archived AS w_is_archived,
       tw.created_at AS w_created_at, tw.updated_at AS w_updated_at
     FROM task_items ti
     JOIN task_works tw ON ti.work_id = tw.id
     WHERE ti.id = $1 AND tw.user_id = $2`,
    [taskItemId, userId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    item: mapTaskItem(r),
    work: {
      id: r.w_id,
      userId: r.w_user_id,
      name: r.w_name,
      emoji: r.w_emoji,
      isArchived: r.w_is_archived,
      createdAt: r.w_created_at,
      updatedAt: r.w_updated_at,
    },
  };
}

// ─── Task Reminders ──────────────────────────────────────────────────────

export async function createTaskReminders(
  taskItemId: number,
  reminders: Array<{ remindAt: Date; reminderType: string }>,
): Promise<void> {
  if (reminders.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const r of reminders) {
    values.push(`($${idx++}, $${idx++}, $${idx++})`);
    params.push(taskItemId, r.remindAt, r.reminderType);
  }

  await query(
    `INSERT INTO task_reminders (task_item_id, remind_at, reminder_type)
     VALUES ${values.join(", ")}`,
    params,
  );
}

export async function deleteRemindersForTask(taskItemId: number): Promise<void> {
  await query(
    `DELETE FROM task_reminders WHERE task_item_id = $1`,
    [taskItemId],
  );
}

export async function getPendingTaskReminders(now: Date): Promise<PendingTaskReminder[]> {
  const { rows } = await query<PendingReminderRow>(
    `SELECT
       tr.id AS reminder_id,
       tr.task_item_id,
       ti.text AS task_text,
       ti.deadline,
       tw.name AS work_name,
       tw.emoji AS work_emoji,
       tr.reminder_type,
       u.telegram_id,
       u.id AS user_id
     FROM task_reminders tr
     JOIN task_items ti ON tr.task_item_id = ti.id
     JOIN task_works tw ON ti.work_id = tw.id
     JOIN users u ON tw.user_id = u.id
     WHERE tr.sent = false
       AND tr.remind_at <= $1
       AND ti.is_completed = false
     ORDER BY tr.remind_at ASC`,
    [now],
  );
  return rows.map((r) => ({
    reminderId: r.reminder_id,
    taskItemId: r.task_item_id,
    taskText: r.task_text,
    deadline: r.deadline,
    workName: r.work_name,
    workEmoji: r.work_emoji,
    reminderType: r.reminder_type,
    telegramId: Number(r.telegram_id),
    userId: r.user_id,
  }));
}

export async function markTaskReminderSent(reminderId: number): Promise<void> {
  await query(
    `UPDATE task_reminders SET sent = true, sent_at = NOW() WHERE id = $1`,
    [reminderId],
  );
}

// ─── Admin ───────────────────────────────────────────────────────────────

export async function getAllTaskWorksPaginated(
  limit: number,
  offset: number,
): Promise<Array<TaskWork & { firstName: string }>> {
  const { rows } = await query<TaskWorkRow & { first_name: string; active_count: string; completed_count: string }>(
    `SELECT tw.*, u.first_name,
       COUNT(ti.id) FILTER (WHERE ti.is_completed = false) AS active_count,
       COUNT(ti.id) FILTER (WHERE ti.is_completed = true) AS completed_count
     FROM task_works tw
     JOIN users u ON tw.user_id = u.id
     LEFT JOIN task_items ti ON ti.work_id = tw.id
     GROUP BY tw.id, u.first_name
     ORDER BY tw.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows.map((r) => ({
    ...mapTaskWork(r),
    activeCount: parseInt(r.active_count, 10),
    completedCount: parseInt(r.completed_count, 10),
    firstName: r.first_name,
  }));
}

export async function countAllTaskWorks(): Promise<number> {
  const { rows } = await query<{ count: string }>(`SELECT COUNT(*) AS count FROM task_works`);
  return parseInt(rows[0].count, 10);
}

export async function bulkDeleteTaskWorks(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await query(
    `DELETE FROM task_works WHERE id = ANY($1::int[])`,
    [ids],
  );
  return rowCount ?? 0;
}

export async function deleteAllTaskWorks(): Promise<number> {
  const { rowCount } = await query(`DELETE FROM task_works`);
  return rowCount ?? 0;
}
