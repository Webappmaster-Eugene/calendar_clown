/**
 * CRUD repository for Wishlist mode: wishlists, items, files.
 * All queries are tribe-scoped.
 */

import { query } from "../db/connection.js";

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
  const { rows } = await query<WishlistRow>(
    `INSERT INTO wishlists (tribe_id, user_id, name, emoji)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tribeId, userId, name, emoji]
  );
  return mapWishlist(rows[0]);
}

export async function getWishlistsByUser(userId: number): Promise<Wishlist[]> {
  const { rows } = await query<WishlistRow & { item_count: string }>(
    `SELECT w.*, COUNT(wi.id) AS item_count
     FROM wishlists w
     LEFT JOIN wishlist_items wi ON wi.wishlist_id = w.id
     WHERE w.user_id = $1 AND w.is_active = true
     GROUP BY w.id
     ORDER BY w.name`,
    [userId]
  );
  return rows.map((r) => ({
    ...mapWishlist(r),
    itemCount: parseInt(r.item_count, 10),
  }));
}

export async function getWishlistsByTribe(tribeId: number): Promise<Wishlist[]> {
  const { rows } = await query<WishlistRow & { first_name: string; item_count: string }>(
    `SELECT w.*, u.first_name, COUNT(wi.id) AS item_count
     FROM wishlists w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN wishlist_items wi ON wi.wishlist_id = w.id
     WHERE w.tribe_id = $1 AND w.is_active = true
     GROUP BY w.id, u.first_name
     ORDER BY u.first_name, w.name`,
    [tribeId]
  );
  return rows.map((r) => ({
    ...mapWishlist(r),
    ownerName: r.first_name,
    itemCount: parseInt(r.item_count, 10),
  }));
}

export async function getWishlistById(wishlistId: number, tribeId: number): Promise<Wishlist | null> {
  const { rows } = await query<WishlistRow & { first_name: string }>(
    `SELECT w.*, u.first_name
     FROM wishlists w
     JOIN users u ON u.id = w.user_id
     WHERE w.id = $1 AND w.tribe_id = $2`,
    [wishlistId, tribeId]
  );
  if (rows.length === 0) return null;
  return { ...mapWishlist(rows[0]), ownerName: rows[0].first_name };
}

export async function updateWishlist(
  wishlistId: number,
  userId: number,
  updates: { name?: string; emoji?: string }
): Promise<boolean> {
  const sets: string[] = ["updated_at = NOW()"];
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

  params.push(wishlistId, userId);

  const { rowCount } = await query(
    `UPDATE wishlists SET ${sets.join(", ")} WHERE id = $${idx++} AND user_id = $${idx} AND is_active = true`,
    params
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteWishlist(wishlistId: number, userId: number): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE wishlists SET is_active = false, updated_at = NOW() WHERE id = $1 AND user_id = $2",
    [wishlistId, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function countWishlistsByUser(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM wishlists WHERE user_id = $1 AND is_active = true",
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

// ─── Items ──────────────────────────────────────────────────────────────

export async function createItem(params: {
  wishlistId: number;
  title: string;
  description?: string | null;
  link?: string | null;
  priority?: number;
}): Promise<WishlistItem> {
  const { rows } = await query<ItemRow>(
    `INSERT INTO wishlist_items (wishlist_id, title, description, link, priority)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      params.wishlistId,
      params.title,
      params.description ?? null,
      params.link ?? null,
      params.priority ?? 1,
    ]
  );
  return mapItem(rows[0]);
}

export async function getItemsByWishlist(
  wishlistId: number,
  limit: number = 10,
  offset: number = 0
): Promise<WishlistItem[]> {
  const { rows } = await query<ItemRow & { reserved_first_name: string | null }>(
    `SELECT wi.*, u.first_name AS reserved_first_name
     FROM wishlist_items wi
     LEFT JOIN users u ON u.id = wi.reserved_by_user_id
     WHERE wi.wishlist_id = $1
     ORDER BY wi.priority ASC, wi.created_at DESC
     LIMIT $2 OFFSET $3`,
    [wishlistId, limit, offset]
  );
  return rows.map((r) => ({
    ...mapItem(r),
    reservedByName: r.reserved_first_name ?? undefined,
  }));
}

export async function getItemById(itemId: number): Promise<WishlistItem | null> {
  const { rows } = await query<ItemRow & { reserved_first_name: string | null }>(
    `SELECT wi.*, u.first_name AS reserved_first_name
     FROM wishlist_items wi
     LEFT JOIN users u ON u.id = wi.reserved_by_user_id
     WHERE wi.id = $1`,
    [itemId]
  );
  if (rows.length === 0) return null;
  return { ...mapItem(rows[0]), reservedByName: rows[0].reserved_first_name ?? undefined };
}

export async function updateItem(
  itemId: number,
  updates: { title?: string; description?: string | null; link?: string | null; priority?: number }
): Promise<boolean> {
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let idx = 1;

  if (updates.title !== undefined) {
    sets.push(`title = $${idx++}`);
    params.push(updates.title);
  }
  if (updates.description !== undefined) {
    sets.push(`description = $${idx++}`);
    params.push(updates.description);
  }
  if (updates.link !== undefined) {
    sets.push(`link = $${idx++}`);
    params.push(updates.link);
  }
  if (updates.priority !== undefined) {
    sets.push(`priority = $${idx++}`);
    params.push(updates.priority);
  }

  params.push(itemId);

  const { rowCount } = await query(
    `UPDATE wishlist_items SET ${sets.join(", ")} WHERE id = $${idx}`,
    params
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteItem(itemId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM wishlist_items WHERE id = $1",
    [itemId]
  );
  return (rowCount ?? 0) > 0;
}

export async function countItemsByWishlist(wishlistId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM wishlist_items WHERE wishlist_id = $1",
    [wishlistId]
  );
  return parseInt(rows[0].count, 10);
}

export async function reserveItem(itemId: number, userId: number): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE wishlist_items SET is_reserved = true, reserved_by_user_id = $2, updated_at = NOW() WHERE id = $1 AND is_reserved = false",
    [itemId, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function unreserveItem(itemId: number, userId: number): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE wishlist_items SET is_reserved = false, reserved_by_user_id = NULL, updated_at = NOW() WHERE id = $1 AND reserved_by_user_id = $2",
    [itemId, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function getLatestItemByUser(wishlistId: number, userId: number): Promise<WishlistItem | null> {
  const { rows } = await query<ItemRow>(
    `SELECT wi.* FROM wishlist_items wi
     JOIN wishlists w ON w.id = wi.wishlist_id
     WHERE wi.wishlist_id = $1 AND w.user_id = $2
     ORDER BY wi.created_at DESC
     LIMIT 1`,
    [wishlistId, userId]
  );
  if (rows.length === 0) return null;
  return mapItem(rows[0]);
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
  const { rows } = await query<FileRow>(
    `INSERT INTO wishlist_item_files (item_id, telegram_file_id, file_type, file_name, mime_type, file_size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      params.itemId,
      params.telegramFileId,
      params.fileType,
      params.fileName ?? null,
      params.mimeType ?? null,
      params.fileSizeBytes ?? null,
    ]
  );
  return mapFile(rows[0]);
}

export async function getFilesByItem(itemId: number): Promise<WishlistItemFile[]> {
  const { rows } = await query<FileRow>(
    "SELECT * FROM wishlist_item_files WHERE item_id = $1 ORDER BY created_at",
    [itemId]
  );
  return rows.map(mapFile);
}

export async function deleteFile(fileId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM wishlist_item_files WHERE id = $1",
    [fileId]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Helpers: get latest item across all wishlists of a user ────────────

export async function getLatestItemByOwner(userId: number): Promise<WishlistItem | null> {
  const { rows } = await query<ItemRow>(
    `SELECT wi.* FROM wishlist_items wi
     JOIN wishlists w ON w.id = wi.wishlist_id
     WHERE w.user_id = $1 AND w.is_active = true
     ORDER BY wi.created_at DESC
     LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) return null;
  return mapItem(rows[0]);
}

/** Get tribe members with their wishlist counts (for "family wishlists" view). */
export async function getTribeMembersWithWishlists(tribeId: number): Promise<Array<{
  userId: number;
  firstName: string;
  wishlistCount: number;
  totalItems: number;
}>> {
  const { rows } = await query<{
    user_id: number;
    first_name: string;
    wishlist_count: string;
    total_items: string;
  }>(
    `SELECT u.id AS user_id, u.first_name,
            COUNT(DISTINCT w.id) AS wishlist_count,
            COUNT(wi.id) AS total_items
     FROM users u
     LEFT JOIN wishlists w ON w.user_id = u.id AND w.is_active = true AND w.tribe_id = $1
     LEFT JOIN wishlist_items wi ON wi.wishlist_id = w.id
     WHERE u.tribe_id = $1 AND u.status = 'approved'
     GROUP BY u.id, u.first_name
     HAVING COUNT(DISTINCT w.id) > 0
     ORDER BY u.first_name`,
    [tribeId]
  );
  return rows.map((r) => ({
    userId: r.user_id,
    firstName: r.first_name,
    wishlistCount: parseInt(r.wishlist_count, 10),
    totalItems: parseInt(r.total_items, 10),
  }));
}

// ─── Internal ───────────────────────────────────────────────────────────

interface WishlistRow {
  id: number;
  tribe_id: number;
  user_id: number;
  name: string;
  emoji: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface ItemRow {
  id: number;
  wishlist_id: number;
  title: string;
  description: string | null;
  link: string | null;
  priority: number;
  is_reserved: boolean;
  reserved_by_user_id: number | null;
  created_at: Date;
  updated_at: Date;
}

interface FileRow {
  id: number;
  item_id: number;
  telegram_file_id: string;
  file_type: string;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  created_at: Date;
}

function mapWishlist(r: WishlistRow): Wishlist {
  return {
    id: r.id,
    tribeId: r.tribe_id,
    userId: r.user_id,
    name: r.name,
    emoji: r.emoji ?? "\u{1F381}",
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapItem(r: ItemRow): WishlistItem {
  return {
    id: r.id,
    wishlistId: r.wishlist_id,
    title: r.title,
    description: r.description,
    link: r.link,
    priority: r.priority,
    isReserved: r.is_reserved,
    reservedByUserId: r.reserved_by_user_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapFile(r: FileRow): WishlistItemFile {
  return {
    id: r.id,
    itemId: r.item_id,
    telegramFileId: r.telegram_file_id,
    fileType: r.file_type,
    fileName: r.file_name,
    mimeType: r.mime_type,
    fileSizeBytes: r.file_size_bytes,
    createdAt: r.created_at,
  };
}
