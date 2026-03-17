/**
 * CRUD repository for Gandalf mode: categories, entries, files.
 * All queries are tribe-scoped.
 */

import { query } from "../db/connection.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface GandalfCategory {
  id: number;
  tribeId: number;
  name: string;
  emoji: string;
  createdByUserId: number | null;
  isActive: boolean;
  createdAt: Date;
}

export interface GandalfEntry {
  id: number;
  tribeId: number;
  categoryId: number;
  title: string;
  price: number | null;
  addedByUserId: number;
  nextDate: Date | null;
  additionalInfo: string | null;
  inputMethod: string;
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

// ─── Categories ─────────────────────────────────────────────────────────

export async function createCategory(
  tribeId: number,
  name: string,
  emoji: string = "📁",
  createdByUserId: number
): Promise<GandalfCategory> {
  const { rows } = await query<CategoryRow>(
    `INSERT INTO gandalf_categories (tribe_id, name, emoji, created_by_user_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tribeId, name, emoji, createdByUserId]
  );
  return mapCategory(rows[0]);
}

export async function getCategoriesByTribe(tribeId: number): Promise<GandalfCategory[]> {
  const { rows } = await query<CategoryRow>(
    "SELECT * FROM gandalf_categories WHERE tribe_id = $1 AND is_active = true ORDER BY name",
    [tribeId]
  );
  return rows.map(mapCategory);
}

export async function getCategoryById(categoryId: number, tribeId: number): Promise<GandalfCategory | null> {
  const { rows } = await query<CategoryRow>(
    "SELECT * FROM gandalf_categories WHERE id = $1 AND tribe_id = $2",
    [categoryId, tribeId]
  );
  if (rows.length === 0) return null;
  return mapCategory(rows[0]);
}

export async function deleteCategory(categoryId: number, tribeId: number): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE gandalf_categories SET is_active = false WHERE id = $1 AND tribe_id = $2",
    [categoryId, tribeId]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Entries ────────────────────────────────────────────────────────────

export async function createEntry(params: {
  tribeId: number;
  categoryId: number;
  title: string;
  price?: number | null;
  addedByUserId: number;
  nextDate?: Date | null;
  additionalInfo?: string | null;
  inputMethod?: string;
}): Promise<GandalfEntry> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO gandalf_entries
       (tribe_id, category_id, title, price, added_by_user_id, next_date, additional_info, input_method)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      params.tribeId,
      params.categoryId,
      params.title,
      params.price ?? null,
      params.addedByUserId,
      params.nextDate ?? null,
      params.additionalInfo ?? null,
      params.inputMethod ?? "text",
    ]
  );
  const entry = await getEntryById(rows[0].id, params.tribeId);
  return entry!;
}

export async function getEntryById(entryId: number, tribeId: number): Promise<GandalfEntry | null> {
  const { rows } = await query<EntryRow & { category_name: string; category_emoji: string; first_name: string }>(
    `SELECT e.*, c.name AS category_name, c.emoji AS category_emoji, u.first_name
     FROM gandalf_entries e
     JOIN gandalf_categories c ON c.id = e.category_id
     JOIN users u ON u.id = e.added_by_user_id
     WHERE e.id = $1 AND e.tribe_id = $2`,
    [entryId, tribeId]
  );
  if (rows.length === 0) return null;
  return mapEntryWithJoins(rows[0]);
}

export async function getEntriesByCategory(
  tribeId: number,
  categoryId: number,
  limit: number = 10,
  offset: number = 0
): Promise<GandalfEntry[]> {
  const { rows } = await query<EntryRow & { category_name: string; category_emoji: string; first_name: string }>(
    `SELECT e.*, c.name AS category_name, c.emoji AS category_emoji, u.first_name
     FROM gandalf_entries e
     JOIN gandalf_categories c ON c.id = e.category_id
     JOIN users u ON u.id = e.added_by_user_id
     WHERE e.tribe_id = $1 AND e.category_id = $2
     ORDER BY e.created_at DESC
     LIMIT $3 OFFSET $4`,
    [tribeId, categoryId, limit, offset]
  );
  return rows.map(mapEntryWithJoins);
}

export async function getEntriesByTribe(
  tribeId: number,
  limit: number = 10,
  offset: number = 0
): Promise<GandalfEntry[]> {
  const { rows } = await query<EntryRow & { category_name: string; category_emoji: string; first_name: string }>(
    `SELECT e.*, c.name AS category_name, c.emoji AS category_emoji, u.first_name
     FROM gandalf_entries e
     JOIN gandalf_categories c ON c.id = e.category_id
     JOIN users u ON u.id = e.added_by_user_id
     WHERE e.tribe_id = $1
     ORDER BY e.created_at DESC
     LIMIT $2 OFFSET $3`,
    [tribeId, limit, offset]
  );
  return rows.map(mapEntryWithJoins);
}

export async function updateEntry(
  entryId: number,
  tribeId: number,
  updates: {
    title?: string;
    price?: number | null;
    nextDate?: Date | null;
    additionalInfo?: string | null;
  }
): Promise<boolean> {
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let idx = 1;

  if (updates.title !== undefined) {
    sets.push(`title = $${idx++}`);
    params.push(updates.title);
  }
  if (updates.price !== undefined) {
    sets.push(`price = $${idx++}`);
    params.push(updates.price);
  }
  if (updates.nextDate !== undefined) {
    sets.push(`next_date = $${idx++}`);
    params.push(updates.nextDate);
  }
  if (updates.additionalInfo !== undefined) {
    sets.push(`additional_info = $${idx++}`);
    params.push(updates.additionalInfo);
  }

  params.push(entryId, tribeId);

  const { rowCount } = await query(
    `UPDATE gandalf_entries SET ${sets.join(", ")} WHERE id = $${idx++} AND tribe_id = $${idx}`,
    params
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteEntry(entryId: number, tribeId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM gandalf_entries WHERE id = $1 AND tribe_id = $2",
    [entryId, tribeId]
  );
  return (rowCount ?? 0) > 0;
}

export async function countEntriesByCategory(tribeId: number, categoryId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM gandalf_entries WHERE tribe_id = $1 AND category_id = $2",
    [tribeId, categoryId]
  );
  return parseInt(rows[0].count, 10);
}

export async function countEntriesByTribe(tribeId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM gandalf_entries WHERE tribe_id = $1",
    [tribeId]
  );
  return parseInt(rows[0].count, 10);
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
  const { rows } = await query<FileRow>(
    `INSERT INTO gandalf_entry_files (entry_id, telegram_file_id, file_type, file_name, mime_type, file_size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      params.entryId,
      params.telegramFileId,
      params.fileType,
      params.fileName ?? null,
      params.mimeType ?? null,
      params.fileSizeBytes ?? null,
    ]
  );
  return mapFile(rows[0]);
}

export async function getFilesByEntry(entryId: number): Promise<GandalfEntryFile[]> {
  const { rows } = await query<FileRow>(
    "SELECT * FROM gandalf_entry_files WHERE entry_id = $1 ORDER BY created_at",
    [entryId]
  );
  return rows.map(mapFile);
}

export async function deleteFile(fileId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM gandalf_entry_files WHERE id = $1",
    [fileId]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Aggregation ────────────────────────────────────────────────────────

export async function getStatsByCategory(tribeId: number, year?: number): Promise<CategoryStats[]> {
  const yearFilter = year
    ? "AND EXTRACT(YEAR FROM e.created_at) = $2"
    : "";
  const params: unknown[] = [tribeId];
  if (year) params.push(year);

  const { rows } = await query<{
    category_id: number;
    category_name: string;
    category_emoji: string;
    total_entries: string;
    total_price: string | null;
  }>(
    `SELECT c.id AS category_id, c.name AS category_name, c.emoji AS category_emoji,
            COUNT(e.id) AS total_entries,
            SUM(e.price) AS total_price
     FROM gandalf_categories c
     LEFT JOIN gandalf_entries e ON e.category_id = c.id ${yearFilter}
     WHERE c.tribe_id = $1 AND c.is_active = true
     GROUP BY c.id, c.name, c.emoji
     ORDER BY c.name`,
    params
  );
  return rows.map((r) => ({
    categoryId: r.category_id,
    categoryName: r.category_name,
    categoryEmoji: r.category_emoji,
    totalEntries: parseInt(r.total_entries, 10),
    totalPrice: r.total_price ? parseFloat(r.total_price) : null,
  }));
}

export async function getStatsByYear(tribeId: number): Promise<YearStats[]> {
  const { rows } = await query<{
    year: number;
    total_entries: string;
    total_price: string | null;
  }>(
    `SELECT EXTRACT(YEAR FROM created_at)::int AS year,
            COUNT(*) AS total_entries,
            SUM(price) AS total_price
     FROM gandalf_entries
     WHERE tribe_id = $1
     GROUP BY year
     ORDER BY year DESC`,
    [tribeId]
  );
  return rows.map((r) => ({
    year: r.year,
    totalEntries: parseInt(r.total_entries, 10),
    totalPrice: r.total_price ? parseFloat(r.total_price) : null,
  }));
}

export async function getStatsByUser(tribeId: number, year?: number): Promise<UserStats[]> {
  const yearFilter = year
    ? "AND EXTRACT(YEAR FROM e.created_at) = $2"
    : "";
  const params: unknown[] = [tribeId];
  if (year) params.push(year);

  const { rows } = await query<{
    user_id: number;
    first_name: string;
    total_entries: string;
    total_price: string | null;
  }>(
    `SELECT u.id AS user_id, u.first_name,
            COUNT(e.id) AS total_entries,
            SUM(e.price) AS total_price
     FROM gandalf_entries e
     JOIN users u ON u.id = e.added_by_user_id
     WHERE e.tribe_id = $1 ${yearFilter}
     GROUP BY u.id, u.first_name
     ORDER BY total_entries DESC`,
    params
  );
  return rows.map((r) => ({
    userId: r.user_id,
    firstName: r.first_name,
    totalEntries: parseInt(r.total_entries, 10),
    totalPrice: r.total_price ? parseFloat(r.total_price) : null,
  }));
}

export async function getTotalByTribe(tribeId: number, year?: number): Promise<{ totalEntries: number; totalPrice: number | null }> {
  const yearFilter = year
    ? "AND EXTRACT(YEAR FROM created_at) = $2"
    : "";
  const params: unknown[] = [tribeId];
  if (year) params.push(year);

  const { rows } = await query<{ total_entries: string; total_price: string | null }>(
    `SELECT COUNT(*) AS total_entries, SUM(price) AS total_price
     FROM gandalf_entries
     WHERE tribe_id = $1 ${yearFilter}`,
    params
  );
  return {
    totalEntries: parseInt(rows[0].total_entries, 10),
    totalPrice: rows[0].total_price ? parseFloat(rows[0].total_price) : null,
  };
}

/** Get the latest entry for a user in a tribe (for file attachment). */
export async function getLatestEntryByUser(tribeId: number, userId: number): Promise<GandalfEntry | null> {
  const { rows } = await query<EntryRow & { category_name: string; category_emoji: string; first_name: string }>(
    `SELECT e.*, c.name AS category_name, c.emoji AS category_emoji, u.first_name
     FROM gandalf_entries e
     JOIN gandalf_categories c ON c.id = e.category_id
     JOIN users u ON u.id = e.added_by_user_id
     WHERE e.tribe_id = $1 AND e.added_by_user_id = $2
     ORDER BY e.created_at DESC
     LIMIT 1`,
    [tribeId, userId]
  );
  if (rows.length === 0) return null;
  return mapEntryWithJoins(rows[0]);
}

// ─── Admin functions ────────────────────────────────────────────────────

/** Admin: update entry title/price. */
export async function updateEntryFields(
  entryId: number,
  fields: { title?: string; price?: number | null }
): Promise<boolean> {
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let idx = 1;

  if (fields.title !== undefined) {
    sets.push(`title = $${idx++}`);
    params.push(fields.title);
  }
  if (fields.price !== undefined) {
    sets.push(`price = $${idx++}`);
    params.push(fields.price);
  }

  if (sets.length === 1) return false; // only updated_at
  params.push(entryId);

  const { rowCount } = await query(
    `UPDATE gandalf_entries SET ${sets.join(", ")} WHERE id = $${idx}`,
    params
  );
  return (rowCount ?? 0) > 0;
}

/** Admin: bulk delete entries by ID array. */
export async function bulkDeleteEntries(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await query(
    "DELETE FROM gandalf_entries WHERE id = ANY($1)",
    [ids]
  );
  return rowCount ?? 0;
}

/** Admin: delete all entries for a tribe. */
export async function deleteAllEntries(tribeId: number): Promise<number> {
  const { rowCount } = await query(
    "DELETE FROM gandalf_entries WHERE tribe_id = $1",
    [tribeId]
  );
  return rowCount ?? 0;
}

/** Admin: get all entries paginated (with joins). */
export async function getAllEntriesPaginated(
  limit: number,
  offset: number
): Promise<GandalfEntry[]> {
  const { rows } = await query<EntryRow & { category_name: string; category_emoji: string; first_name: string }>(
    `SELECT e.*, c.name AS category_name, c.emoji AS category_emoji, u.first_name
     FROM gandalf_entries e
     JOIN gandalf_categories c ON c.id = e.category_id
     JOIN users u ON u.id = e.added_by_user_id
     ORDER BY e.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map(mapEntryWithJoins);
}

/** Admin: count all entries for a tribe. */
export async function countAllEntries(tribeId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM gandalf_entries WHERE tribe_id = $1",
    [tribeId]
  );
  return parseInt(rows[0].count, 10);
}

// ─── Internal ───────────────────────────────────────────────────────────

interface CategoryRow {
  id: number;
  tribe_id: number;
  name: string;
  emoji: string;
  created_by_user_id: number | null;
  is_active: boolean;
  created_at: Date;
}

interface EntryRow {
  id: number;
  tribe_id: number;
  category_id: number;
  title: string;
  price: string | null;
  added_by_user_id: number;
  next_date: Date | null;
  additional_info: string | null;
  input_method: string;
  created_at: Date;
  updated_at: Date;
}

interface FileRow {
  id: number;
  entry_id: number;
  telegram_file_id: string;
  file_type: string;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  created_at: Date;
}

function mapCategory(r: CategoryRow): GandalfCategory {
  return {
    id: r.id,
    tribeId: r.tribe_id,
    name: r.name,
    emoji: r.emoji ?? "📁",
    createdByUserId: r.created_by_user_id,
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}

function mapEntry(r: EntryRow): GandalfEntry {
  return {
    id: r.id,
    tribeId: r.tribe_id,
    categoryId: r.category_id,
    title: r.title,
    price: r.price != null ? parseFloat(r.price) : null,
    addedByUserId: r.added_by_user_id,
    nextDate: r.next_date,
    additionalInfo: r.additional_info,
    inputMethod: r.input_method,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapEntryWithJoins(
  r: EntryRow & { category_name: string; category_emoji: string; first_name: string }
): GandalfEntry {
  return {
    ...mapEntry(r),
    categoryName: r.category_name,
    categoryEmoji: r.category_emoji,
    addedByName: r.first_name,
  };
}

function mapFile(r: FileRow): GandalfEntryFile {
  return {
    id: r.id,
    entryId: r.entry_id,
    telegramFileId: r.telegram_file_id,
    fileType: r.file_type,
    fileName: r.file_name,
    mimeType: r.mime_type,
    fileSizeBytes: r.file_size_bytes,
    createdAt: r.created_at,
  };
}
