/**
 * CRUD repository for Gandalf mode (База знаний): categories, entries, files.
 * Supports both tribe-scoped and personal (no tribe) queries.
 * Data access via Drizzle query builder; row types inferred from the schema.
 */

import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle.js";
import { gandalfCategories, gandalfEntries, gandalfEntryFiles, users } from "../db/schema.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface GandalfCategory {
  id: number;
  tribeId: number | null;
  name: string;
  emoji: string;
  createdByUserId: number | null;
  isActive: boolean;
  createdAt: Date;
}

export interface GandalfEntry {
  id: number;
  tribeId: number | null;
  categoryId: number;
  title: string;
  price: number | null;
  createdByUserId: number;
  nextDate: Date | null;
  additionalInfo: string | null;
  inputMethod: string;
  isImportant: boolean;
  isUrgent: boolean;
  visibility: "tribe" | "private";
  createdAt: Date;
  updatedAt: Date;
  categoryName?: string;
  categoryEmoji?: string;
  addedByName?: string;
}

export interface GandalfEntryFile {
  id: number;
  entryId: number;
  telegramFileId: string;
  fileType: string;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  createdAt: Date;
}

export interface CategoryStats {
  categoryId: number;
  categoryName: string;
  categoryEmoji: string;
  totalEntries: number;
  totalPrice: number | null;
}

export interface UserStats {
  userId: number;
  firstName: string;
  totalEntries: number;
  totalPrice: number | null;
}

export interface YearStats {
  year: number;
  totalEntries: number;
  totalPrice: number | null;
}

/**
 * Scope for queries: either tribe-scoped or personal (by userId).
 */
export interface TribeScope {
  type: "tribe";
  tribeId: number;
  userId: number;
}

export interface PersonalScope {
  type: "personal";
  userId: number;
}

export type GandalfScope = TribeScope | PersonalScope;

// Entry row joined with category name/emoji and author first name, reused
// across the entry-listing queries.
const entryWithJoins = {
  id: gandalfEntries.id,
  tribeId: gandalfEntries.tribeId,
  categoryId: gandalfEntries.categoryId,
  title: gandalfEntries.title,
  price: gandalfEntries.price,
  createdByUserId: gandalfEntries.createdByUserId,
  nextDate: gandalfEntries.nextDate,
  additionalInfo: gandalfEntries.additionalInfo,
  inputMethod: gandalfEntries.inputMethod,
  isImportant: gandalfEntries.isImportant,
  isUrgent: gandalfEntries.isUrgent,
  visibility: gandalfEntries.visibility,
  createdAt: gandalfEntries.createdAt,
  updatedAt: gandalfEntries.updatedAt,
  categoryName: gandalfCategories.name,
  categoryEmoji: gandalfCategories.emoji,
  firstName: users.firstName,
};

// ─── Categories ─────────────────────────────────────────────────────────

export async function createCategory(
  tribeId: number | null,
  name: string,
  emoji: string = "📁",
  createdByUserId: number
): Promise<GandalfCategory> {
  const [row] = await db
    .insert(gandalfCategories)
    .values({ tribeId, name, emoji, createdByUserId })
    .returning();
  return mapCategory(row);
}

export async function getCategoriesByTribe(tribeId: number): Promise<GandalfCategory[]> {
  const rows = await db
    .select()
    .from(gandalfCategories)
    .where(and(eq(gandalfCategories.tribeId, tribeId), eq(gandalfCategories.isActive, true)))
    .orderBy(gandalfCategories.name);
  return rows.map(mapCategory);
}

export async function getCategoriesByUser(userId: number): Promise<GandalfCategory[]> {
  const rows = await db
    .select()
    .from(gandalfCategories)
    .where(
      and(
        isNull(gandalfCategories.tribeId),
        eq(gandalfCategories.createdByUserId, userId),
        eq(gandalfCategories.isActive, true)
      )
    )
    .orderBy(gandalfCategories.name);
  return rows.map(mapCategory);
}

export async function getCategoriesByScope(scope: GandalfScope): Promise<GandalfCategory[]> {
  if (scope.type === "tribe") return getCategoriesByTribe(scope.tribeId);
  return getCategoriesByUser(scope.userId);
}

export async function getCategoryById(categoryId: number, tribeId: number | null): Promise<GandalfCategory | null> {
  const [row] = await db
    .select()
    .from(gandalfCategories)
    .where(
      and(
        eq(gandalfCategories.id, categoryId),
        tribeId != null ? eq(gandalfCategories.tribeId, tribeId) : isNull(gandalfCategories.tribeId)
      )
    );
  if (!row) return null;
  return mapCategory(row);
}

export async function deleteCategory(categoryId: number, tribeId: number | null): Promise<boolean> {
  const rows = await db
    .update(gandalfCategories)
    .set({ isActive: false })
    .where(
      and(
        eq(gandalfCategories.id, categoryId),
        tribeId != null ? eq(gandalfCategories.tribeId, tribeId) : isNull(gandalfCategories.tribeId)
      )
    )
    .returning({ id: gandalfCategories.id });
  return rows.length > 0;
}

export async function updateCategory(
  categoryId: number,
  tribeId: number | null,
  updates: { name?: string; emoji?: string }
): Promise<boolean> {
  const set: PgUpdateSetSource<typeof gandalfCategories> = {};
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.emoji !== undefined) set.emoji = updates.emoji;

  if (Object.keys(set).length === 0) return false;

  const rows = await db
    .update(gandalfCategories)
    .set(set)
    .where(
      and(
        eq(gandalfCategories.id, categoryId),
        tribeId != null ? eq(gandalfCategories.tribeId, tribeId) : isNull(gandalfCategories.tribeId),
        eq(gandalfCategories.isActive, true)
      )
    )
    .returning({ id: gandalfCategories.id });
  return rows.length > 0;
}

// ─── Entries ────────────────────────────────────────────────────────────

export async function createEntry(params: {
  tribeId: number | null;
  categoryId: number;
  title: string;
  price?: number | null;
  createdByUserId: number;
  nextDate?: Date | null;
  additionalInfo?: string | null;
  inputMethod?: string;
  isImportant?: boolean;
  isUrgent?: boolean;
  visibility?: "tribe" | "private";
}): Promise<GandalfEntry> {
  const visibility = params.visibility ?? (params.tribeId ? "tribe" : "private");
  const price = params.price ?? null;
  const [inserted] = await db
    .insert(gandalfEntries)
    .values({
      tribeId: params.tribeId,
      categoryId: params.categoryId,
      title: params.title,
      price: price != null ? String(price) : null,
      createdByUserId: params.createdByUserId,
      nextDate: params.nextDate ?? null,
      additionalInfo: params.additionalInfo ?? null,
      inputMethod: params.inputMethod ?? "text",
      isImportant: params.isImportant ?? false,
      isUrgent: params.isUrgent ?? false,
      visibility,
    })
    .returning({ id: gandalfEntries.id });
  const entry = await getEntryByIdInternal(inserted.id);
  return entry!;
}

/** Internal: get entry by ID without scope check (used after insert). */
async function getEntryByIdInternal(entryId: number): Promise<GandalfEntry | null> {
  const [row] = await db
    .select(entryWithJoins)
    .from(gandalfEntries)
    .innerJoin(gandalfCategories, eq(gandalfCategories.id, gandalfEntries.categoryId))
    .innerJoin(users, eq(users.id, gandalfEntries.createdByUserId))
    .where(eq(gandalfEntries.id, entryId));
  if (!row) return null;
  return mapEntryWithJoins(row);
}

export async function getEntryById(entryId: number, tribeId: number | null): Promise<GandalfEntry | null> {
  const [row] = await db
    .select(entryWithJoins)
    .from(gandalfEntries)
    .innerJoin(gandalfCategories, eq(gandalfCategories.id, gandalfEntries.categoryId))
    .innerJoin(users, eq(users.id, gandalfEntries.createdByUserId))
    .where(
      and(
        eq(gandalfEntries.id, entryId),
        tribeId != null ? eq(gandalfEntries.tribeId, tribeId) : isNull(gandalfEntries.tribeId)
      )
    );
  if (!row) return null;
  return mapEntryWithJoins(row);
}

/** Get entry by ID using scope (tribe: shows tribe+own private; personal: own only). */
export async function getEntryByIdScoped(entryId: number, scope: GandalfScope): Promise<GandalfEntry | null> {
  if (scope.type === "personal") {
    return getEntryById(entryId, null);
  }
  // Tribe scope: entry must be in tribe AND (visibility=tribe OR own private)
  const [row] = await db
    .select(entryWithJoins)
    .from(gandalfEntries)
    .innerJoin(gandalfCategories, eq(gandalfCategories.id, gandalfEntries.categoryId))
    .innerJoin(users, eq(users.id, gandalfEntries.createdByUserId))
    .where(
      and(
        eq(gandalfEntries.id, entryId),
        eq(gandalfEntries.tribeId, scope.tribeId),
        or(eq(gandalfEntries.visibility, "tribe"), eq(gandalfEntries.createdByUserId, scope.userId))
      )
    );
  if (!row) return null;
  return mapEntryWithJoins(row);
}

export async function getEntriesByCategory(
  tribeId: number | null,
  categoryId: number,
  limit: number = 10,
  offset: number = 0
): Promise<GandalfEntry[]> {
  const rows = await db
    .select(entryWithJoins)
    .from(gandalfEntries)
    .innerJoin(gandalfCategories, eq(gandalfCategories.id, gandalfEntries.categoryId))
    .innerJoin(users, eq(users.id, gandalfEntries.createdByUserId))
    .where(
      and(
        tribeId != null ? eq(gandalfEntries.tribeId, tribeId) : isNull(gandalfEntries.tribeId),
        eq(gandalfEntries.categoryId, categoryId)
      )
    )
    .orderBy(desc(gandalfEntries.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(mapEntryWithJoins);
}

/** Get visible entries for scope (tribe: tribe+own private; personal: own). */
export async function getEntriesByScope(
  scope: GandalfScope,
  limit: number = 10,
  offset: number = 0
): Promise<GandalfEntry[]> {
  const where =
    scope.type === "personal"
      ? and(isNull(gandalfEntries.tribeId), eq(gandalfEntries.createdByUserId, scope.userId))
      : and(
          eq(gandalfEntries.tribeId, scope.tribeId),
          or(eq(gandalfEntries.visibility, "tribe"), eq(gandalfEntries.createdByUserId, scope.userId))
        );
  const rows = await db
    .select(entryWithJoins)
    .from(gandalfEntries)
    .innerJoin(gandalfCategories, eq(gandalfCategories.id, gandalfEntries.categoryId))
    .innerJoin(users, eq(users.id, gandalfEntries.createdByUserId))
    .where(where)
    .orderBy(desc(gandalfEntries.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(mapEntryWithJoins);
}

export async function updateEntry(
  entryId: number,
  tribeId: number | null,
  updates: {
    title?: string;
    price?: number | null;
    nextDate?: Date | null;
    additionalInfo?: string | null;
    isImportant?: boolean;
    isUrgent?: boolean;
    visibility?: "tribe" | "private";
    categoryId?: number;
  }
): Promise<boolean> {
  const set: PgUpdateSetSource<typeof gandalfEntries> = {};
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.price !== undefined) set.price = updates.price != null ? String(updates.price) : null;
  if (updates.nextDate !== undefined) set.nextDate = updates.nextDate;
  if (updates.additionalInfo !== undefined) set.additionalInfo = updates.additionalInfo;
  if (updates.isImportant !== undefined) set.isImportant = updates.isImportant;
  if (updates.isUrgent !== undefined) set.isUrgent = updates.isUrgent;
  if (updates.visibility !== undefined) set.visibility = updates.visibility;
  if (updates.categoryId !== undefined) set.categoryId = updates.categoryId;

  set.updatedAt = sql`now()`;

  const rows = await db
    .update(gandalfEntries)
    .set(set)
    .where(
      and(
        eq(gandalfEntries.id, entryId),
        tribeId != null ? eq(gandalfEntries.tribeId, tribeId) : isNull(gandalfEntries.tribeId)
      )
    )
    .returning({ id: gandalfEntries.id });
  return rows.length > 0;
}

export async function deleteEntry(entryId: number, tribeId: number | null): Promise<boolean> {
  const rows = await db
    .delete(gandalfEntries)
    .where(
      and(
        eq(gandalfEntries.id, entryId),
        tribeId != null ? eq(gandalfEntries.tribeId, tribeId) : isNull(gandalfEntries.tribeId)
      )
    )
    .returning({ id: gandalfEntries.id });
  return rows.length > 0;
}

/**
 * Get entry count and total price for all categories in one query.
 * Handles both tribe and personal (null tribeId) scopes.
 */
export async function getCategoryEntryCounts(
  tribeId: number | null
): Promise<Map<number, { count: number; totalPrice: number | null }>> {
  const rows = await db
    .select({
      categoryId: gandalfEntries.categoryId,
      count: sql<string>`count(*)`,
      totalPrice: sql<string | null>`sum(${gandalfEntries.price})`,
    })
    .from(gandalfEntries)
    .where(tribeId != null ? eq(gandalfEntries.tribeId, tribeId) : isNull(gandalfEntries.tribeId))
    .groupBy(gandalfEntries.categoryId);

  const map = new Map<number, { count: number; totalPrice: number | null }>();
  for (const r of rows) {
    map.set(r.categoryId, {
      count: parseInt(r.count, 10),
      totalPrice: r.totalPrice != null ? parseFloat(r.totalPrice) : null,
    });
  }
  return map;
}

export async function countEntriesByCategory(tribeId: number | null, categoryId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(gandalfEntries)
    .where(
      and(
        tribeId != null ? eq(gandalfEntries.tribeId, tribeId) : isNull(gandalfEntries.tribeId),
        eq(gandalfEntries.categoryId, categoryId)
      )
    );
  return row.value;
}

export async function countEntriesByScope(scope: GandalfScope): Promise<number> {
  const where =
    scope.type === "personal"
      ? and(isNull(gandalfEntries.tribeId), eq(gandalfEntries.createdByUserId, scope.userId))
      : and(
          eq(gandalfEntries.tribeId, scope.tribeId),
          or(eq(gandalfEntries.visibility, "tribe"), eq(gandalfEntries.createdByUserId, scope.userId))
        );
  const [row] = await db.select({ value: count() }).from(gandalfEntries).where(where);
  return row.value;
}

// ─── Flag operations ────────────────────────────────────────────────────

export async function getEntriesByFlag(
  scope: GandalfScope,
  flag: "important" | "urgent",
  limit: number = 10,
  offset: number = 0
): Promise<GandalfEntry[]> {
  const flagCol = flag === "important" ? gandalfEntries.isImportant : gandalfEntries.isUrgent;
  const where =
    scope.type === "personal"
      ? and(isNull(gandalfEntries.tribeId), eq(gandalfEntries.createdByUserId, scope.userId), eq(flagCol, true))
      : and(
          eq(gandalfEntries.tribeId, scope.tribeId),
          eq(flagCol, true),
          or(eq(gandalfEntries.visibility, "tribe"), eq(gandalfEntries.createdByUserId, scope.userId))
        );
  const rows = await db
    .select(entryWithJoins)
    .from(gandalfEntries)
    .innerJoin(gandalfCategories, eq(gandalfCategories.id, gandalfEntries.categoryId))
    .innerJoin(users, eq(users.id, gandalfEntries.createdByUserId))
    .where(where)
    .orderBy(desc(gandalfEntries.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(mapEntryWithJoins);
}

export async function countEntriesByFlag(
  scope: GandalfScope,
  flag: "important" | "urgent"
): Promise<number> {
  const flagCol = flag === "important" ? gandalfEntries.isImportant : gandalfEntries.isUrgent;
  const where =
    scope.type === "personal"
      ? and(isNull(gandalfEntries.tribeId), eq(gandalfEntries.createdByUserId, scope.userId), eq(flagCol, true))
      : and(
          eq(gandalfEntries.tribeId, scope.tribeId),
          eq(flagCol, true),
          or(eq(gandalfEntries.visibility, "tribe"), eq(gandalfEntries.createdByUserId, scope.userId))
        );
  const [row] = await db.select({ value: count() }).from(gandalfEntries).where(where);
  return row.value;
}

export async function toggleEntryFlag(
  entryId: number,
  tribeId: number | null,
  flag: "important" | "urgent"
): Promise<boolean> {
  const flagCol = flag === "important" ? gandalfEntries.isImportant : gandalfEntries.isUrgent;
  const rows = await db
    .update(gandalfEntries)
    .set({ [flag === "important" ? "isImportant" : "isUrgent"]: sql`not ${flagCol}`, updatedAt: sql`now()` })
    .where(
      and(
        eq(gandalfEntries.id, entryId),
        tribeId != null ? eq(gandalfEntries.tribeId, tribeId) : isNull(gandalfEntries.tribeId)
      )
    )
    .returning({ id: gandalfEntries.id });
  return rows.length > 0;
}

export async function toggleEntryVisibility(
  entryId: number,
  tribeId: number | null
): Promise<"tribe" | "private" | null> {
  const [row] = await db
    .update(gandalfEntries)
    .set({
      visibility: sql`case when ${gandalfEntries.visibility} = 'tribe' then 'private' else 'tribe' end`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(gandalfEntries.id, entryId),
        tribeId != null ? eq(gandalfEntries.tribeId, tribeId) : isNull(gandalfEntries.tribeId)
      )
    )
    .returning({ visibility: gandalfEntries.visibility });
  if (!row) return null;
  return row.visibility as "tribe" | "private";
}

export async function moveEntryToCategory(
  entryId: number,
  tribeId: number | null,
  newCategoryId: number
): Promise<boolean> {
  const rows = await db
    .update(gandalfEntries)
    .set({ categoryId: newCategoryId, updatedAt: sql`now()` })
    .where(
      and(
        eq(gandalfEntries.id, entryId),
        tribeId != null ? eq(gandalfEntries.tribeId, tribeId) : isNull(gandalfEntries.tribeId)
      )
    )
    .returning({ id: gandalfEntries.id });
  return rows.length > 0;
}

// ─── Files ──────────────────────────────────────────────────────────────

export async function addFileToEntry(params: {
  entryId: number;
  telegramFileId: string;
  fileType: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
}): Promise<GandalfEntryFile> {
  const [row] = await db
    .insert(gandalfEntryFiles)
    .values({
      entryId: params.entryId,
      telegramFileId: params.telegramFileId,
      fileType: params.fileType,
      fileName: params.fileName ?? null,
      mimeType: params.mimeType ?? null,
      fileSizeBytes: params.fileSizeBytes ?? null,
    })
    .returning();
  return mapFile(row);
}

export async function getFilesByEntry(entryId: number): Promise<GandalfEntryFile[]> {
  const rows = await db
    .select()
    .from(gandalfEntryFiles)
    .where(eq(gandalfEntryFiles.entryId, entryId))
    .orderBy(gandalfEntryFiles.createdAt);
  return rows.map(mapFile);
}

export async function deleteFile(fileId: number): Promise<boolean> {
  const rows = await db
    .delete(gandalfEntryFiles)
    .where(eq(gandalfEntryFiles.id, fileId))
    .returning({ id: gandalfEntryFiles.id });
  return rows.length > 0;
}

// ─── Aggregation ────────────────────────────────────────────────────────

export async function getStatsByCategory(tribeId: number, year?: number): Promise<CategoryStats[]> {
  const joinCond = year
    ? and(
        eq(gandalfEntries.categoryId, gandalfCategories.id),
        sql`extract(year from ${gandalfEntries.createdAt}) = ${year}`
      )
    : eq(gandalfEntries.categoryId, gandalfCategories.id);

  const rows = await db
    .select({
      categoryId: gandalfCategories.id,
      categoryName: gandalfCategories.name,
      categoryEmoji: gandalfCategories.emoji,
      totalEntries: sql<string>`count(${gandalfEntries.id})`,
      totalPrice: sql<string | null>`sum(${gandalfEntries.price})`,
    })
    .from(gandalfCategories)
    .leftJoin(gandalfEntries, joinCond)
    .where(and(eq(gandalfCategories.tribeId, tribeId), eq(gandalfCategories.isActive, true)))
    .groupBy(gandalfCategories.id, gandalfCategories.name, gandalfCategories.emoji)
    .orderBy(gandalfCategories.name);
  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categoryEmoji: r.categoryEmoji ?? "📁",
    totalEntries: parseInt(r.totalEntries, 10),
    totalPrice: r.totalPrice ? parseFloat(r.totalPrice) : null,
  }));
}

export async function getStatsByYear(tribeId: number): Promise<YearStats[]> {
  const rows = await db
    .select({
      year: sql<number>`extract(year from ${gandalfEntries.createdAt})::int`,
      totalEntries: sql<string>`count(*)`,
      totalPrice: sql<string | null>`sum(${gandalfEntries.price})`,
    })
    .from(gandalfEntries)
    .where(eq(gandalfEntries.tribeId, tribeId))
    .groupBy(sql`extract(year from ${gandalfEntries.createdAt})::int`)
    .orderBy(sql`extract(year from ${gandalfEntries.createdAt})::int desc`);
  return rows.map((r) => ({
    year: r.year,
    totalEntries: parseInt(r.totalEntries, 10),
    totalPrice: r.totalPrice ? parseFloat(r.totalPrice) : null,
  }));
}

export async function getStatsByUser(tribeId: number, year?: number): Promise<UserStats[]> {
  const conds = [eq(gandalfEntries.tribeId, tribeId)];
  if (year) conds.push(sql`extract(year from ${gandalfEntries.createdAt}) = ${year}`);

  const rows = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      totalEntries: sql<string>`count(${gandalfEntries.id})`,
      totalPrice: sql<string | null>`sum(${gandalfEntries.price})`,
    })
    .from(gandalfEntries)
    .innerJoin(users, eq(users.id, gandalfEntries.createdByUserId))
    .where(and(...conds))
    .groupBy(users.id, users.firstName)
    .orderBy(desc(sql`count(${gandalfEntries.id})`));
  return rows.map((r) => ({
    userId: r.userId,
    firstName: r.firstName,
    totalEntries: parseInt(r.totalEntries, 10),
    totalPrice: r.totalPrice ? parseFloat(r.totalPrice) : null,
  }));
}

/** Get the latest entry for a user (for file attachment). */
export async function getLatestEntryByUser(tribeId: number | null, userId: number): Promise<GandalfEntry | null> {
  const [row] = await db
    .select(entryWithJoins)
    .from(gandalfEntries)
    .innerJoin(gandalfCategories, eq(gandalfCategories.id, gandalfEntries.categoryId))
    .innerJoin(users, eq(users.id, gandalfEntries.createdByUserId))
    .where(
      and(
        tribeId != null ? eq(gandalfEntries.tribeId, tribeId) : isNull(gandalfEntries.tribeId),
        eq(gandalfEntries.createdByUserId, userId)
      )
    )
    .orderBy(desc(gandalfEntries.createdAt))
    .limit(1);
  if (!row) return null;
  return mapEntryWithJoins(row);
}

// ─── Admin functions ────────────────────────────────────────────────────

/** Admin: update entry title/price. */
export async function updateEntryFields(
  entryId: number,
  fields: { title?: string; price?: number | null }
): Promise<boolean> {
  const set: PgUpdateSetSource<typeof gandalfEntries> = {};
  if (fields.title !== undefined) set.title = fields.title;
  if (fields.price !== undefined) set.price = fields.price != null ? String(fields.price) : null;

  if (Object.keys(set).length === 0) return false; // only updated_at

  set.updatedAt = sql`now()`;

  const rows = await db
    .update(gandalfEntries)
    .set(set)
    .where(eq(gandalfEntries.id, entryId))
    .returning({ id: gandalfEntries.id });
  return rows.length > 0;
}

/** Admin: bulk delete entries by ID array. */
export async function bulkDeleteEntries(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .delete(gandalfEntries)
    .where(inArray(gandalfEntries.id, ids))
    .returning({ id: gandalfEntries.id });
  return rows.length;
}

/** Admin: delete all entries for a tribe. */
export async function deleteAllEntries(tribeId: number): Promise<number> {
  const rows = await db
    .delete(gandalfEntries)
    .where(eq(gandalfEntries.tribeId, tribeId))
    .returning({ id: gandalfEntries.id });
  return rows.length;
}

/** Admin: get all entries paginated (with joins). */
export async function getAllEntriesPaginated(
  limit: number,
  offset: number
): Promise<GandalfEntry[]> {
  const rows = await db
    .select(entryWithJoins)
    .from(gandalfEntries)
    .innerJoin(gandalfCategories, eq(gandalfCategories.id, gandalfEntries.categoryId))
    .innerJoin(users, eq(users.id, gandalfEntries.createdByUserId))
    .orderBy(desc(gandalfEntries.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(mapEntryWithJoins);
}

/** Admin: count all entries for a tribe. */
export async function countAllEntries(tribeId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(gandalfEntries)
    .where(eq(gandalfEntries.tribeId, tribeId));
  return row.value;
}

// ─── Mappers ────────────────────────────────────────────────────────────

function mapCategory(r: typeof gandalfCategories.$inferSelect): GandalfCategory {
  return {
    id: r.id,
    tribeId: r.tribeId,
    name: r.name,
    emoji: r.emoji ?? "📁",
    createdByUserId: r.createdByUserId,
    isActive: r.isActive ?? true,
    createdAt: r.createdAt ?? new Date(),
  };
}

function mapEntry(r: typeof gandalfEntries.$inferSelect): GandalfEntry {
  return {
    id: r.id,
    tribeId: r.tribeId,
    categoryId: r.categoryId,
    title: r.title,
    price: r.price != null ? parseFloat(r.price) : null,
    createdByUserId: r.createdByUserId,
    nextDate: r.nextDate,
    additionalInfo: r.additionalInfo,
    inputMethod: r.inputMethod ?? "text",
    isImportant: r.isImportant ?? false,
    isUrgent: r.isUrgent ?? false,
    visibility: (r.visibility === "private" ? "private" : "tribe") as "tribe" | "private",
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  };
}

function mapEntryWithJoins(
  r: typeof gandalfEntries.$inferSelect & { categoryName: string; categoryEmoji: string | null; firstName: string }
): GandalfEntry {
  return {
    ...mapEntry(r),
    categoryName: r.categoryName,
    categoryEmoji: r.categoryEmoji ?? "📁",
    addedByName: r.firstName,
  };
}

function mapFile(r: typeof gandalfEntryFiles.$inferSelect): GandalfEntryFile {
  return {
    id: r.id,
    entryId: r.entryId,
    telegramFileId: r.telegramFileId,
    fileType: r.fileType,
    fileName: r.fileName,
    mimeType: r.mimeType,
    fileSizeBytes: r.fileSizeBytes,
    createdAt: r.createdAt ?? new Date(),
  };
}
