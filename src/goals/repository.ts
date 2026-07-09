/**
 * CRUD repository for Goals mode: goal sets, goals, viewers, reminders.
 * Data access via Drizzle query builder; row types inferred from the schema.
 */

import { and, count, desc, eq, getTableColumns, inArray, lte, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle.js";
import { goalReminders, goalSets, goalSetViewers, goals, users } from "../db/schema.js";
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

export interface PendingReminder {
  reminderId: number;
  goalSetId: number;
  goalSetName: string;
  goalSetEmoji: string;
  telegramId: number;
  userId: number;
}

// Aggregated goal counts, reused across the set-listing queries. Column-object
// interpolation keeps the SQL rename-safe (breaks the build, not runtime, on rename).
const goalCounts = {
  totalCount: sql<number>`count(${goals.id})`.mapWith(Number),
  completedCount: sql<number>`count(${goals.id}) filter (where ${goals.isCompleted})`.mapWith(Number),
};

// ─── Goal Sets ──────────────────────────────────────────────────────────

export async function createGoalSet(
  userId: number,
  name: string,
  period: GoalPeriod,
  deadline: Date | null,
  emoji: string = "🎯"
): Promise<GoalSet> {
  const [row] = await db
    .insert(goalSets)
    .values({ userId, name, period, deadline, emoji })
    .returning();
  return mapGoalSet(row);
}

export async function getGoalSetsByUser(userId: number): Promise<GoalSet[]> {
  const rows = await db
    .select({ ...getTableColumns(goalSets), ...goalCounts })
    .from(goalSets)
    .leftJoin(goals, eq(goals.goalSetId, goalSets.id))
    .where(eq(goalSets.userId, userId))
    .groupBy(goalSets.id)
    .orderBy(desc(goalSets.createdAt));
  return rows.map((r) => ({ ...mapGoalSet(r), completedCount: r.completedCount, totalCount: r.totalCount }));
}

export async function getGoalSetById(goalSetId: number): Promise<GoalSet | null> {
  const [row] = await db
    .select({ ...getTableColumns(goalSets), ...goalCounts })
    .from(goalSets)
    .leftJoin(goals, eq(goals.goalSetId, goalSets.id))
    .where(eq(goalSets.id, goalSetId))
    .groupBy(goalSets.id);
  if (!row) return null;
  return { ...mapGoalSet(row), completedCount: row.completedCount, totalCount: row.totalCount };
}

export async function updateGoalSet(
  goalSetId: number,
  userId: number,
  updates: { name?: string; emoji?: string; visibility?: GoalSetVisibility }
): Promise<GoalSet | null> {
  const set: PgUpdateSetSource<typeof goalSets> = {};
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.emoji !== undefined) set.emoji = updates.emoji;
  if (updates.visibility !== undefined) set.visibility = updates.visibility;

  if (Object.keys(set).length === 0) return getGoalSetById(goalSetId);

  set.updatedAt = sql`now()`;
  const [row] = await db
    .update(goalSets)
    .set(set)
    .where(and(eq(goalSets.id, goalSetId), eq(goalSets.userId, userId)))
    .returning();
  return row ? mapGoalSet(row) : null;
}

export async function deleteGoalSet(goalSetId: number, userId: number): Promise<boolean> {
  const rows = await db
    .delete(goalSets)
    .where(and(eq(goalSets.id, goalSetId), eq(goalSets.userId, userId)))
    .returning({ id: goalSets.id });
  return rows.length > 0;
}

export async function countGoalSetsByUser(userId: number): Promise<number> {
  const [row] = await db.select({ value: count() }).from(goalSets).where(eq(goalSets.userId, userId));
  return row.value;
}

// ─── Goals ──────────────────────────────────────────────────────────────

export async function createGoal(
  goalSetId: number,
  text: string,
  inputMethod: string = "text"
): Promise<Goal> {
  const [row] = await db.insert(goals).values({ goalSetId, text, inputMethod }).returning();
  return mapGoal(row);
}

export async function getGoalsBySet(goalSetId: number): Promise<Goal[]> {
  const rows = await db.select().from(goals).where(eq(goals.goalSetId, goalSetId)).orderBy(goals.createdAt);
  return rows.map(mapGoal);
}

export async function toggleGoalCompleted(goalId: number): Promise<Goal | null> {
  const [row] = await db
    .update(goals)
    .set({
      isCompleted: sql`not ${goals.isCompleted}`,
      completedAt: sql`case when not ${goals.isCompleted} then now() else null end`,
      updatedAt: sql`now()`,
    })
    .where(eq(goals.id, goalId))
    .returning();
  return row ? mapGoal(row) : null;
}

export async function updateGoalText(goalId: number, text: string): Promise<Goal | null> {
  const [row] = await db
    .update(goals)
    .set({ text, updatedAt: sql`now()` })
    .where(eq(goals.id, goalId))
    .returning();
  return row ? mapGoal(row) : null;
}

export async function deleteGoal(goalId: number): Promise<boolean> {
  const rows = await db.delete(goals).where(eq(goals.id, goalId)).returning({ id: goals.id });
  return rows.length > 0;
}

export async function getGoalSetProgress(goalSetId: number): Promise<{ completed: number; total: number }> {
  const [row] = await db
    .select({
      total: count(),
      completed: sql<number>`count(*) filter (where ${goals.isCompleted})`.mapWith(Number),
    })
    .from(goals)
    .where(eq(goals.goalSetId, goalSetId));
  return { total: row.total, completed: row.completed };
}

// ─── Viewers ────────────────────────────────────────────────────────────

export async function addViewer(goalSetId: number, viewerUserId: number): Promise<void> {
  await db.insert(goalSetViewers).values({ goalSetId, viewerUserId }).onConflictDoNothing();
}

export async function removeViewer(goalSetId: number, viewerUserId: number): Promise<void> {
  await db
    .delete(goalSetViewers)
    .where(and(eq(goalSetViewers.goalSetId, goalSetId), eq(goalSetViewers.viewerUserId, viewerUserId)));
}

export async function getViewersByGoalSet(goalSetId: number): Promise<GoalSetViewer[]> {
  return db
    .select({
      id: goalSetViewers.id,
      goalSetId: goalSetViewers.goalSetId,
      viewerUserId: goalSetViewers.viewerUserId,
      createdAt: goalSetViewers.createdAt,
      viewerName: users.firstName,
    })
    .from(goalSetViewers)
    .innerJoin(users, eq(users.id, goalSetViewers.viewerUserId))
    .where(eq(goalSetViewers.goalSetId, goalSetId))
    .orderBy(users.firstName);
}

export async function getPublicGoalSetsForViewer(viewerUserId: number): Promise<(GoalSet & { ownerName: string })[]> {
  const rows = await db
    .select({ ...getTableColumns(goalSets), ...goalCounts, ownerName: users.firstName })
    .from(goalSets)
    .innerJoin(goalSetViewers, eq(goalSetViewers.goalSetId, goalSets.id))
    .innerJoin(users, eq(users.id, goalSets.userId))
    .leftJoin(goals, eq(goals.goalSetId, goalSets.id))
    .where(and(eq(goalSetViewers.viewerUserId, viewerUserId), eq(goalSets.visibility, "public")))
    .groupBy(goalSets.id, users.firstName)
    .orderBy(users.firstName, goalSets.name);
  return rows.map((r) => ({
    ...mapGoalSet(r),
    completedCount: r.completedCount,
    totalCount: r.totalCount,
    ownerName: r.ownerName,
  }));
}

// ─── Reminders ──────────────────────────────────────────────────────────

export async function createReminders(goalSetId: number, dates: Date[]): Promise<void> {
  if (dates.length === 0) return;
  await db.insert(goalReminders).values(dates.map((remindAt) => ({ goalSetId, remindAt })));
}

export async function getPendingReminders(now: Date): Promise<PendingReminder[]> {
  const rows = await db
    .select({
      reminderId: goalReminders.id,
      goalSetId: goalSets.id,
      goalSetName: goalSets.name,
      goalSetEmoji: goalSets.emoji,
      telegramId: users.telegramId,
      userId: users.id,
    })
    .from(goalReminders)
    .innerJoin(goalSets, eq(goalSets.id, goalReminders.goalSetId))
    .innerJoin(users, eq(users.id, goalSets.userId))
    .where(and(eq(goalReminders.sent, false), lte(goalReminders.remindAt, now)))
    .orderBy(goalReminders.remindAt);
  return rows.map((r) => ({
    reminderId: r.reminderId,
    goalSetId: r.goalSetId,
    goalSetName: r.goalSetName,
    goalSetEmoji: r.goalSetEmoji ?? "🎯",
    telegramId: Number(r.telegramId),
    userId: r.userId,
  }));
}

export async function markReminderSent(reminderId: number): Promise<void> {
  await db.update(goalReminders).set({ sent: true, sentAt: sql`now()` }).where(eq(goalReminders.id, reminderId));
}

// ─── Admin functions ────────────────────────────────────────────────────

/** Admin: get all goal sets paginated (all users, with user info and progress). */
export async function getAllGoalSetsPaginated(
  limit: number,
  offset: number
): Promise<Array<GoalSet & { firstName: string; completedCount: number; totalCount: number }>> {
  const rows = await db
    .select({ ...getTableColumns(goalSets), ...goalCounts, firstName: users.firstName })
    .from(goalSets)
    .innerJoin(users, eq(users.id, goalSets.userId))
    .leftJoin(goals, eq(goals.goalSetId, goalSets.id))
    .groupBy(goalSets.id, users.firstName)
    .orderBy(desc(goalSets.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    ...mapGoalSet(r),
    firstName: r.firstName,
    completedCount: r.completedCount,
    totalCount: r.totalCount,
  }));
}

/** Admin: count all goal sets. */
export async function countAllGoalSets(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(goalSets);
  return row.value;
}

/** Admin: bulk delete goal sets by IDs. */
export async function bulkDeleteGoalSets(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.delete(goalSets).where(inArray(goalSets.id, ids)).returning({ id: goalSets.id });
  return rows.length;
}

/** Admin: delete ALL goal sets. */
export async function deleteAllGoalSets(): Promise<number> {
  const rows = await db.delete(goalSets).returning({ id: goalSets.id });
  return rows.length;
}

// ─── Mappers ────────────────────────────────────────────────────────────

function mapGoalSet(r: typeof goalSets.$inferSelect): GoalSet {
  return {
    id: r.id,
    userId: r.userId,
    name: r.name,
    emoji: r.emoji ?? "🎯",
    period: r.period as GoalPeriod,
    visibility: r.visibility as GoalSetVisibility,
    deadline: r.deadline,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapGoal(r: typeof goals.$inferSelect): Goal {
  return {
    id: r.id,
    goalSetId: r.goalSetId,
    text: r.text,
    isCompleted: r.isCompleted,
    inputMethod: r.inputMethod,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
