import { and, asc, count, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle.js";
import { users, workAchievements, workplaces } from "../db/schema.js";
import { MAX_WORKPLACES_PER_USER } from "../constants.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface Workplace {
  id: number;
  userId: number;
  title: string;
  company: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  achievementCount?: number;
}

export interface WorkAchievement {
  id: number;
  workplaceId: number;
  text: string;
  inputMethod: string;
  createdAt: Date;
  updatedAt: Date;
}

const achievementCounts = {
  achievementCount: sql<number>`count(${workAchievements.id})`.mapWith(Number),
};

// ─── Workplaces ─────────────────────────────────────────────────────────

export async function createWorkplace(
  userId: number,
  title: string,
  company?: string
): Promise<Workplace> {
  const count = await countWorkplacesByUser(userId);
  if (count >= MAX_WORKPLACES_PER_USER) {
    throw new Error(
      `Достигнут лимит: максимум ${MAX_WORKPLACES_PER_USER} активных мест работы`
    );
  }

  const [row] = await db
    .insert(workplaces)
    .values({ userId, title, company: company ?? null })
    .returning();
  return mapWorkplace(row);
}

export async function getWorkplacesByUser(userId: number): Promise<Workplace[]> {
  const rows = await db
    .select({ ...getTableColumns(workplaces), ...achievementCounts })
    .from(workplaces)
    .leftJoin(workAchievements, eq(workAchievements.workplaceId, workplaces.id))
    .where(and(eq(workplaces.userId, userId), eq(workplaces.isActive, true)))
    .groupBy(workplaces.id)
    .orderBy(desc(workplaces.createdAt));
  return rows.map((r) => ({
    ...mapWorkplace(r),
    achievementCount: r.achievementCount,
  }));
}

export async function getWorkplaceById(
  workplaceId: number,
  userId: number
): Promise<Workplace | null> {
  const [row] = await db
    .select({ ...getTableColumns(workplaces), ...achievementCounts })
    .from(workplaces)
    .leftJoin(workAchievements, eq(workAchievements.workplaceId, workplaces.id))
    .where(
      and(
        eq(workplaces.id, workplaceId),
        eq(workplaces.userId, userId),
        eq(workplaces.isActive, true)
      )
    )
    .groupBy(workplaces.id);
  if (!row) return null;
  return {
    ...mapWorkplace(row),
    achievementCount: row.achievementCount,
  };
}

export async function updateWorkplace(
  workplaceId: number,
  userId: number,
  updates: { title?: string; company?: string }
): Promise<Workplace | null> {
  const set: PgUpdateSetSource<typeof workplaces> = {};
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.company !== undefined) set.company = updates.company;

  if (Object.keys(set).length === 0) return getWorkplaceById(workplaceId, userId);

  set.updatedAt = sql`now()`;
  const [row] = await db
    .update(workplaces)
    .set(set)
    .where(
      and(
        eq(workplaces.id, workplaceId),
        eq(workplaces.userId, userId),
        eq(workplaces.isActive, true)
      )
    )
    .returning();
  if (!row) return null;
  return mapWorkplace(row);
}

export async function deleteWorkplace(
  workplaceId: number,
  userId: number
): Promise<boolean> {
  const rows = await db
    .update(workplaces)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(
      and(
        eq(workplaces.id, workplaceId),
        eq(workplaces.userId, userId),
        eq(workplaces.isActive, true)
      )
    )
    .returning({ id: workplaces.id });
  return rows.length > 0;
}

export async function countWorkplacesByUser(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(workplaces)
    .where(and(eq(workplaces.userId, userId), eq(workplaces.isActive, true)));
  return row.value;
}

// ─── Achievements ───────────────────────────────────────────────────────

export async function createAchievement(
  workplaceId: number,
  text: string,
  inputMethod: string
): Promise<WorkAchievement> {
  const [row] = await db
    .insert(workAchievements)
    .values({ workplaceId, text, inputMethod })
    .returning();
  return mapAchievement(row);
}

export async function getAchievementsByWorkplace(
  workplaceId: number,
  limit: number = 5,
  offset: number = 0
): Promise<WorkAchievement[]> {
  const rows = await db
    .select()
    .from(workAchievements)
    .where(eq(workAchievements.workplaceId, workplaceId))
    .orderBy(desc(workAchievements.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(mapAchievement);
}

export async function updateAchievement(
  achievementId: number,
  text: string
): Promise<WorkAchievement | null> {
  const [row] = await db
    .update(workAchievements)
    .set({ text, updatedAt: sql`now()` })
    .where(eq(workAchievements.id, achievementId))
    .returning();
  if (!row) return null;
  return mapAchievement(row);
}

export async function deleteAchievement(achievementId: number): Promise<boolean> {
  const rows = await db
    .delete(workAchievements)
    .where(eq(workAchievements.id, achievementId))
    .returning({ id: workAchievements.id });
  return rows.length > 0;
}

export async function getAllAchievementsForSummary(
  workplaceId: number
): Promise<WorkAchievement[]> {
  const rows = await db
    .select()
    .from(workAchievements)
    .where(eq(workAchievements.workplaceId, workplaceId))
    .orderBy(asc(workAchievements.createdAt));
  return rows.map(mapAchievement);
}

// ─── Admin functions ────────────────────────────────────────────────────

export async function getAllWorkplacesPaginated(
  limit: number,
  offset: number
): Promise<Array<Workplace & { firstName: string }>> {
  const rows = await db
    .select({ ...getTableColumns(workplaces), firstName: users.firstName })
    .from(workplaces)
    .innerJoin(users, eq(users.id, workplaces.userId))
    .orderBy(desc(workplaces.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({ ...mapWorkplace(r), firstName: r.firstName }));
}

export async function countAllWorkplaces(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(workplaces);
  return row.value;
}

export async function bulkDeleteWorkplaces(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .delete(workplaces)
    .where(inArray(workplaces.id, ids))
    .returning({ id: workplaces.id });
  return rows.length;
}

export async function deleteAllWorkplaces(): Promise<number> {
  const rows = await db.delete(workplaces).returning({ id: workplaces.id });
  return rows.length;
}

// ─── Mappers ────────────────────────────────────────────────────────────

function mapWorkplace(r: typeof workplaces.$inferSelect): Workplace {
  return {
    id: r.id,
    userId: r.userId,
    title: r.title,
    company: r.company,
    isActive: r.isActive,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapAchievement(r: typeof workAchievements.$inferSelect): WorkAchievement {
  return {
    id: r.id,
    workplaceId: r.workplaceId,
    text: r.text,
    inputMethod: r.inputMethod,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
