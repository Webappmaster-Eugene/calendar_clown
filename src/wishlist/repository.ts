/**
 * CRUD repository for Wishlist mode: wishlists, items, files.
 * All queries are tribe-scoped.
 */

import { and, asc, count, countDistinct, desc, eq, getTableColumns, gt, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle.js";
import { users, wishlistItemFiles, wishlistItems, wishlists } from "../db/schema.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface Wishlist {
  id: number;
  tribeId: number;
  userId: number;
  name: string;
  emoji: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  ownerName?: string;
  itemCount?: number;
}

export interface WishlistItem {
  id: number;
  wishlistId: number;
  title: string;
  description: string | null;
  link: string | null;
  priority: number;
  isReserved: boolean;
  reservedByUserId: number | null;
  reservedByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WishlistItemFile {
  id: number;
  itemId: number;
  telegramFileId: string;
  fileType: string;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  createdAt: Date;
}

// ─── Wishlists ──────────────────────────────────────────────────────────

export async function createWishlist(
  tribeId: number,
  userId: number,
  name: string,
  emoji: string = "\u{1F381}"
): Promise<Wishlist> {
  const [row] = await db
    .insert(wishlists)
    .values({ tribeId, userId, name, emoji })
    .returning();
  return mapWishlist(row);
}

export async function getWishlistsByUser(userId: number): Promise<Wishlist[]> {
  const rows = await db
    .select({ ...getTableColumns(wishlists), itemCount: count(wishlistItems.id) })
    .from(wishlists)
    .leftJoin(wishlistItems, eq(wishlistItems.wishlistId, wishlists.id))
    .where(and(eq(wishlists.userId, userId), eq(wishlists.isActive, true)))
    .groupBy(wishlists.id)
    .orderBy(asc(wishlists.name));
  return rows.map((r) => ({
    ...mapWishlist(r),
    itemCount: r.itemCount,
  }));
}

export async function getWishlistsByTribe(tribeId: number): Promise<Wishlist[]> {
  const rows = await db
    .select({ ...getTableColumns(wishlists), firstName: users.firstName, itemCount: count(wishlistItems.id) })
    .from(wishlists)
    .innerJoin(users, eq(users.id, wishlists.userId))
    .leftJoin(wishlistItems, eq(wishlistItems.wishlistId, wishlists.id))
    .where(and(eq(wishlists.tribeId, tribeId), eq(wishlists.isActive, true)))
    .groupBy(wishlists.id, users.firstName)
    .orderBy(asc(users.firstName), asc(wishlists.name));
  return rows.map((r) => ({
    ...mapWishlist(r),
    ownerName: r.firstName,
    itemCount: r.itemCount,
  }));
}

export async function getWishlistById(wishlistId: number, tribeId: number): Promise<Wishlist | null> {
  const [row] = await db
    .select({ ...getTableColumns(wishlists), firstName: users.firstName })
    .from(wishlists)
    .innerJoin(users, eq(users.id, wishlists.userId))
    .where(and(eq(wishlists.id, wishlistId), eq(wishlists.tribeId, tribeId)));
  if (!row) return null;
  return { ...mapWishlist(row), ownerName: row.firstName };
}

export async function updateWishlist(
  wishlistId: number,
  userId: number,
  updates: { name?: string; emoji?: string }
): Promise<Wishlist | null> {
  const set: PgUpdateSetSource<typeof wishlists> = {};
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.emoji !== undefined) set.emoji = updates.emoji;
  set.updatedAt = sql`now()`;

  const [row] = await db
    .update(wishlists)
    .set(set)
    .where(and(eq(wishlists.id, wishlistId), eq(wishlists.userId, userId), eq(wishlists.isActive, true)))
    .returning();
  if (!row) return null;
  return mapWishlist(row);
}

export async function deleteWishlist(wishlistId: number, userId: number): Promise<boolean> {
  const rows = await db
    .update(wishlists)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(and(eq(wishlists.id, wishlistId), eq(wishlists.userId, userId)))
    .returning({ id: wishlists.id });
  return rows.length > 0;
}

export async function countWishlistsByUser(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(wishlists)
    .where(and(eq(wishlists.userId, userId), eq(wishlists.isActive, true)));
  return row.value;
}

// ─── Items ──────────────────────────────────────────────────────────────

export async function createItem(params: {
  wishlistId: number;
  title: string;
  description?: string | null;
  link?: string | null;
  priority?: number;
}): Promise<WishlistItem> {
  const [row] = await db
    .insert(wishlistItems)
    .values({
      wishlistId: params.wishlistId,
      title: params.title,
      description: params.description ?? null,
      link: params.link ?? null,
      priority: params.priority ?? 1,
    })
    .returning();
  return mapItem(row);
}

export async function getItemsByWishlist(
  wishlistId: number,
  limit: number = 10,
  offset: number = 0
): Promise<WishlistItem[]> {
  const rows = await db
    .select({ ...getTableColumns(wishlistItems), reservedFirstName: users.firstName })
    .from(wishlistItems)
    .leftJoin(users, eq(users.id, wishlistItems.reservedByUserId))
    .where(eq(wishlistItems.wishlistId, wishlistId))
    .orderBy(asc(wishlistItems.priority), desc(wishlistItems.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    ...mapItem(r),
    reservedByName: r.reservedFirstName ?? undefined,
  }));
}

export async function getItemById(itemId: number): Promise<WishlistItem | null> {
  const [row] = await db
    .select({ ...getTableColumns(wishlistItems), reservedFirstName: users.firstName })
    .from(wishlistItems)
    .leftJoin(users, eq(users.id, wishlistItems.reservedByUserId))
    .where(eq(wishlistItems.id, itemId));
  if (!row) return null;
  return { ...mapItem(row), reservedByName: row.reservedFirstName ?? undefined };
}

export async function updateItem(
  itemId: number,
  updates: { title?: string; description?: string | null; link?: string | null; priority?: number }
): Promise<boolean> {
  const set: PgUpdateSetSource<typeof wishlistItems> = {};
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.description !== undefined) set.description = updates.description;
  if (updates.link !== undefined) set.link = updates.link;
  if (updates.priority !== undefined) set.priority = updates.priority;

  set.updatedAt = sql`now()`;
  const rows = await db
    .update(wishlistItems)
    .set(set)
    .where(eq(wishlistItems.id, itemId))
    .returning({ id: wishlistItems.id });
  return rows.length > 0;
}

export async function deleteItem(itemId: number): Promise<boolean> {
  const rows = await db
    .delete(wishlistItems)
    .where(eq(wishlistItems.id, itemId))
    .returning({ id: wishlistItems.id });
  return rows.length > 0;
}

export async function countItemsByWishlist(wishlistId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(wishlistItems)
    .where(eq(wishlistItems.wishlistId, wishlistId));
  return row.value;
}

export async function reserveItem(itemId: number, userId: number): Promise<boolean> {
  const rows = await db
    .update(wishlistItems)
    .set({ isReserved: true, reservedByUserId: userId, updatedAt: sql`now()` })
    .where(and(eq(wishlistItems.id, itemId), eq(wishlistItems.isReserved, false)))
    .returning({ id: wishlistItems.id });
  return rows.length > 0;
}

export async function unreserveItem(itemId: number, userId: number): Promise<boolean> {
  const rows = await db
    .update(wishlistItems)
    .set({ isReserved: false, reservedByUserId: null, updatedAt: sql`now()` })
    .where(and(eq(wishlistItems.id, itemId), eq(wishlistItems.reservedByUserId, userId)))
    .returning({ id: wishlistItems.id });
  return rows.length > 0;
}

// ─── Files ──────────────────────────────────────────────────────────────

export async function addFileToItem(params: {
  itemId: number;
  telegramFileId: string;
  fileType: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
}): Promise<WishlistItemFile> {
  const [row] = await db
    .insert(wishlistItemFiles)
    .values({
      itemId: params.itemId,
      telegramFileId: params.telegramFileId,
      fileType: params.fileType,
      fileName: params.fileName ?? null,
      mimeType: params.mimeType ?? null,
      fileSizeBytes: params.fileSizeBytes ?? null,
    })
    .returning();
  return mapFile(row);
}

export async function getFilesByItem(itemId: number): Promise<WishlistItemFile[]> {
  const rows = await db
    .select()
    .from(wishlistItemFiles)
    .where(eq(wishlistItemFiles.itemId, itemId))
    .orderBy(asc(wishlistItemFiles.createdAt));
  return rows.map(mapFile);
}

export async function deleteFile(fileId: number): Promise<boolean> {
  const rows = await db
    .delete(wishlistItemFiles)
    .where(eq(wishlistItemFiles.id, fileId))
    .returning({ id: wishlistItemFiles.id });
  return rows.length > 0;
}

// ─── Helpers: get latest item across all wishlists of a user ────────────

export async function getLatestItemByOwner(userId: number): Promise<WishlistItem | null> {
  const [row] = await db
    .select(getTableColumns(wishlistItems))
    .from(wishlistItems)
    .innerJoin(wishlists, eq(wishlists.id, wishlistItems.wishlistId))
    .where(and(eq(wishlists.userId, userId), eq(wishlists.isActive, true)))
    .orderBy(desc(wishlistItems.createdAt))
    .limit(1);
  if (!row) return null;
  return mapItem(row);
}

/** Get tribe members with their wishlist counts (for "family wishlists" view). */
export async function getTribeMembersWithWishlists(tribeId: number): Promise<Array<{
  userId: number;
  firstName: string;
  wishlistCount: number;
  totalItems: number;
}>> {
  const rows = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      wishlistCount: countDistinct(wishlists.id),
      totalItems: count(wishlistItems.id),
    })
    .from(users)
    .leftJoin(
      wishlists,
      and(eq(wishlists.userId, users.id), eq(wishlists.isActive, true), eq(wishlists.tribeId, tribeId))
    )
    .leftJoin(wishlistItems, eq(wishlistItems.wishlistId, wishlists.id))
    .where(and(eq(users.tribeId, tribeId), eq(users.status, "approved")))
    .groupBy(users.id, users.firstName)
    .having(gt(countDistinct(wishlists.id), 0))
    .orderBy(asc(users.firstName));
  return rows.map((r) => ({
    userId: r.userId,
    firstName: r.firstName,
    wishlistCount: r.wishlistCount,
    totalItems: r.totalItems,
  }));
}

// ─── Admin functions ────────────────────────────────────────────────────

/** Admin: get all wishlists paginated (all users, with user info and item counts). */
export async function getAllWishlistsPaginated(
  limit: number,
  offset: number
): Promise<Array<Wishlist & { firstName: string; itemCount: number }>> {
  const rows = await db
    .select({ ...getTableColumns(wishlists), firstName: users.firstName, itemCount: count(wishlistItems.id) })
    .from(wishlists)
    .innerJoin(users, eq(users.id, wishlists.userId))
    .leftJoin(wishlistItems, eq(wishlistItems.wishlistId, wishlists.id))
    .groupBy(wishlists.id, users.firstName)
    .orderBy(desc(wishlists.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    ...mapWishlist(r),
    firstName: r.firstName,
    itemCount: r.itemCount,
  }));
}

/** Admin: count all wishlists. */
export async function countAllWishlists(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(wishlists);
  return row.value;
}

/** Admin: bulk delete wishlists by IDs. */
export async function bulkDeleteWishlists(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .delete(wishlists)
    .where(inArray(wishlists.id, ids))
    .returning({ id: wishlists.id });
  return rows.length;
}

/** Admin: delete ALL wishlists. */
export async function deleteAllWishlists(): Promise<number> {
  const rows = await db.delete(wishlists).returning({ id: wishlists.id });
  return rows.length;
}

// ─── Mappers ────────────────────────────────────────────────────────────

function mapWishlist(r: typeof wishlists.$inferSelect): Wishlist {
  return {
    id: r.id,
    tribeId: r.tribeId,
    userId: r.userId,
    name: r.name,
    emoji: r.emoji ?? "\u{1F381}",
    isActive: r.isActive ?? true,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  };
}

function mapItem(r: typeof wishlistItems.$inferSelect): WishlistItem {
  return {
    id: r.id,
    wishlistId: r.wishlistId,
    title: r.title,
    description: r.description,
    link: r.link,
    priority: r.priority,
    isReserved: r.isReserved ?? false,
    reservedByUserId: r.reservedByUserId,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  };
}

function mapFile(r: typeof wishlistItemFiles.$inferSelect): WishlistItemFile {
  return {
    id: r.id,
    itemId: r.itemId,
    telegramFileId: r.telegramFileId,
    fileType: r.fileType,
    fileName: r.fileName,
    mimeType: r.mimeType,
    fileSizeBytes: r.fileSizeBytes,
    createdAt: r.createdAt ?? new Date(),
  };
}
