/**
 * CRUD repository for Task Tracker: task works, task items, task reminders.
 * Data access via Drizzle query builder; row types inferred from the schema.
 */

import { and, count, desc, eq, getTableColumns, lte, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle.js";
import { taskItems, taskReminders, taskWorks, users } from "../db/schema.js";

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

// Aggregated item counts per work, reused across the work-listing queries.
const itemCounts = {
  activeCount: sql<number>`count(${taskItems.id}) filter (where not ${taskItems.isCompleted})`.mapWith(Number),
  completedCount: sql<number>`count(${taskItems.id}) filter (where ${taskItems.isCompleted})`.mapWith(Number),
};

// ─── Mappers ─────────────────────────────────────────────────────────────

function mapTaskWork(r: typeof taskWorks.$inferSelect): TaskWork {
  return {
    id: r.id,
    userId: r.userId,
    name: r.name,
    emoji: r.emoji,
    isArchived: r.isArchived,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapTaskItem(r: typeof taskItems.$inferSelect): TaskItem {
  return {
    id: r.id,
    workId: r.workId,
    text: r.text,
    deadline: r.deadline,
    isCompleted: r.isCompleted,
    completedAt: r.completedAt,
    inputMethod: r.inputMethod,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ─── Task Works ──────────────────────────────────────────────────────────

export async function createTaskWork(
  userId: number,
  name: string,
  emoji: string = "📋",
): Promise<TaskWork> {
  const [row] = await db.insert(taskWorks).values({ userId, name, emoji }).returning();
  return mapTaskWork(row);
}

export async function getTaskWorksByUser(userId: number): Promise<TaskWork[]> {
  const rows = await db
    .select({ ...getTableColumns(taskWorks), ...itemCounts })
    .from(taskWorks)
    .leftJoin(taskItems, eq(taskItems.workId, taskWorks.id))
    .where(and(eq(taskWorks.userId, userId), eq(taskWorks.isArchived, false)))
    .groupBy(taskWorks.id)
    .orderBy(desc(taskWorks.createdAt));
  return rows.map((r) => ({ ...mapTaskWork(r), activeCount: r.activeCount, completedCount: r.completedCount }));
}

export async function getTaskWorkById(workId: number): Promise<TaskWork | null> {
  const [row] = await db
    .select({ ...getTableColumns(taskWorks), ...itemCounts })
    .from(taskWorks)
    .leftJoin(taskItems, eq(taskItems.workId, taskWorks.id))
    .where(eq(taskWorks.id, workId))
    .groupBy(taskWorks.id);
  if (!row) return null;
  return { ...mapTaskWork(row), activeCount: row.activeCount, completedCount: row.completedCount };
}

export async function getTaskWorkByName(userId: number, name: string): Promise<TaskWork | null> {
  const [row] = await db
    .select()
    .from(taskWorks)
    .where(
      and(
        eq(taskWorks.userId, userId),
        sql`lower(${taskWorks.name}) = lower(${name})`,
        eq(taskWorks.isArchived, false),
      ),
    );
  return row ? mapTaskWork(row) : null;
}

export async function updateTaskWork(
  workId: number,
  userId: number,
  updates: { name?: string; emoji?: string; isArchived?: boolean },
): Promise<TaskWork | null> {
  const set: PgUpdateSetSource<typeof taskWorks> = {};
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.emoji !== undefined) set.emoji = updates.emoji;
  if (updates.isArchived !== undefined) set.isArchived = updates.isArchived;

  if (Object.keys(set).length === 0) return getTaskWorkById(workId);

  set.updatedAt = sql`now()`;
  const [row] = await db
    .update(taskWorks)
    .set(set)
    .where(and(eq(taskWorks.id, workId), eq(taskWorks.userId, userId)))
    .returning();
  return row ? mapTaskWork(row) : null;
}

export async function deleteTaskWork(workId: number, userId: number): Promise<boolean> {
  const rows = await db
    .delete(taskWorks)
    .where(and(eq(taskWorks.id, workId), eq(taskWorks.userId, userId)))
    .returning({ id: taskWorks.id });
  return rows.length > 0;
}

export async function countTaskWorksByUser(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(taskWorks)
    .where(and(eq(taskWorks.userId, userId), eq(taskWorks.isArchived, false)));
  return row.value;
}

// ─── Task Items ──────────────────────────────────────────────────────────

/** Create a task item and its reminders atomically. */
export async function createTaskItemWithReminders(
  workId: number,
  text: string,
  deadline: Date,
  inputMethod: string,
  reminders: Array<{ remindAt: Date; reminderType: string }>,
): Promise<TaskItem> {
  return db.transaction(async (tx) => {
    const [item] = await tx.insert(taskItems).values({ workId, text, deadline, inputMethod }).returning();
    if (reminders.length > 0) {
      await tx.insert(taskReminders).values(
        reminders.map((r) => ({ taskItemId: item.id, remindAt: r.remindAt, reminderType: r.reminderType })),
      );
    }
    return mapTaskItem(item);
  });
}

export async function getTaskItemsByWork(workId: number): Promise<TaskItem[]> {
  const rows = await db.select().from(taskItems).where(eq(taskItems.workId, workId)).orderBy(taskItems.deadline);
  return rows.map(mapTaskItem);
}

export async function toggleTaskItemCompleted(taskItemId: number): Promise<TaskItem | null> {
  const [row] = await db
    .update(taskItems)
    .set({
      isCompleted: sql`not ${taskItems.isCompleted}`,
      completedAt: sql`case when ${taskItems.isCompleted} then null else now() end`,
      updatedAt: sql`now()`,
    })
    .where(eq(taskItems.id, taskItemId))
    .returning();
  return row ? mapTaskItem(row) : null;
}

export async function updateTaskItemText(taskItemId: number, text: string): Promise<TaskItem | null> {
  const [row] = await db
    .update(taskItems)
    .set({ text, updatedAt: sql`now()` })
    .where(eq(taskItems.id, taskItemId))
    .returning();
  return row ? mapTaskItem(row) : null;
}

/** Replace a task item's deadline and regenerate its reminders atomically. */
export async function replaceTaskItemDeadline(
  taskItemId: number,
  deadline: Date,
  reminders: Array<{ remindAt: Date; reminderType: string }>,
): Promise<TaskItem | null> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(taskItems)
      .set({ deadline, updatedAt: sql`now()` })
      .where(eq(taskItems.id, taskItemId))
      .returning();
    if (!updated) return null;

    await tx.delete(taskReminders).where(eq(taskReminders.taskItemId, taskItemId));
    if (reminders.length > 0) {
      await tx.insert(taskReminders).values(
        reminders.map((r) => ({ taskItemId, remindAt: r.remindAt, reminderType: r.reminderType })),
      );
    }
    return mapTaskItem(updated);
  });
}

export async function deleteTaskItem(taskItemId: number): Promise<boolean> {
  const rows = await db.delete(taskItems).where(eq(taskItems.id, taskItemId)).returning({ id: taskItems.id });
  return rows.length > 0;
}

export async function countTaskItemsByWork(workId: number): Promise<number> {
  const [row] = await db.select({ value: count() }).from(taskItems).where(eq(taskItems.workId, workId));
  return row.value;
}

export async function getCompletedTaskItems(workId: number): Promise<TaskItem[]> {
  const rows = await db
    .select()
    .from(taskItems)
    .where(and(eq(taskItems.workId, workId), eq(taskItems.isCompleted, true)))
    .orderBy(desc(taskItems.completedAt));
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
  const [row] = await db
    .select({ item: getTableColumns(taskItems), work: getTableColumns(taskWorks) })
    .from(taskItems)
    .innerJoin(taskWorks, eq(taskItems.workId, taskWorks.id))
    .where(and(eq(taskItems.id, taskItemId), eq(taskWorks.userId, userId)));
  if (!row) return null;
  return { item: mapTaskItem(row.item), work: mapTaskWork(row.work) };
}

// ─── Task Reminders ──────────────────────────────────────────────────────

export async function getPendingTaskReminders(now: Date): Promise<PendingTaskReminder[]> {
  const rows = await db
    .select({
      reminderId: taskReminders.id,
      taskItemId: taskReminders.taskItemId,
      taskText: taskItems.text,
      deadline: taskItems.deadline,
      workName: taskWorks.name,
      workEmoji: taskWorks.emoji,
      reminderType: taskReminders.reminderType,
      telegramId: users.telegramId,
      userId: users.id,
    })
    .from(taskReminders)
    .innerJoin(taskItems, eq(taskReminders.taskItemId, taskItems.id))
    .innerJoin(taskWorks, eq(taskItems.workId, taskWorks.id))
    .innerJoin(users, eq(taskWorks.userId, users.id))
    .where(
      and(eq(taskReminders.sent, false), lte(taskReminders.remindAt, now), eq(taskItems.isCompleted, false)),
    )
    .orderBy(taskReminders.remindAt);
  return rows.map((r) => ({ ...r, telegramId: Number(r.telegramId) }));
}

export async function markTaskReminderSent(reminderId: number): Promise<void> {
  await db.update(taskReminders).set({ sent: true, sentAt: sql`now()` }).where(eq(taskReminders.id, reminderId));
}
