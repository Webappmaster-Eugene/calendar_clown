/**
 * Gandalf (Knowledge Base) business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  createCategory,
  getCategoriesByScope,
  getCategoryById,
  deleteCategory,
  updateCategory,
  createEntry,
  getEntriesByCategory,
  getEntriesByScope,
  getEntryByIdScoped,
  deleteEntry,
  updateEntry,
  countEntriesByCategory,
  countEntriesByScope,
  addFileToEntry,
  getFilesByEntry,
  getStatsByCategory,
  getStatsByYear,
  getStatsByUser,
  getEntriesByFlag,
  countEntriesByFlag,
  toggleEntryFlag,
  toggleEntryVisibility,
  moveEntryToCategory,
} from "../gandalf/repository.js";
import type { GandalfEntry, GandalfScope } from "../gandalf/repository.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import type {
  GandalfCategoryDto,
  GandalfEntryDto,
  GandalfFileDto,
} from "../shared/types.js";

const log = createLogger("gandalf-service");

// ─── Helpers ──────────────────────────────────────────────────

function requireDb(): void {
  if (!isDatabaseAvailable()) {
    throw new Error("База данных недоступна.");
  }
}

export function buildScope(dbUser: { id: number; tribeId: number | null }): GandalfScope {
  if (dbUser.tribeId) {
    return { type: "tribe", tribeId: dbUser.tribeId, userId: dbUser.id };
  }
  return { type: "personal", userId: dbUser.id };
}

function entryToDto(e: GandalfEntry): GandalfEntryDto {
  return {
    id: e.id,
    categoryId: e.categoryId,
    categoryName: e.categoryName ?? "",
    categoryEmoji: e.categoryEmoji ?? "📁",
    title: e.title,
    price: e.price,
    addedByName: e.addedByName ?? "",
    nextDate: e.nextDate?.toISOString() ?? null,
    additionalInfo: e.additionalInfo,
    inputMethod: e.inputMethod,
    isImportant: e.isImportant,
    isUrgent: e.isUrgent,
    visibility: e.visibility,
    createdAt: e.createdAt.toISOString(),
    files: [],
  };
}

async function requireDbUser(telegramId: number) {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) throw new Error("Пользователь не найден.");
  return dbUser;
}

// ─── Service Functions ────────────────────────────────────────

/**
 * Get categories for the user's scope.
 */
export async function getCategories(telegramId: number): Promise<GandalfCategoryDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const scope = buildScope(dbUser);
  const categories = await getCategoriesByScope(scope);

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    isActive: c.isActive,
  }));
}

/**
 * Create a new category.
 */
export async function addCategory(
  telegramId: number,
  name: string,
  emoji: string = "📁"
): Promise<GandalfCategoryDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const tribeId = dbUser.tribeId;

  const cat = await createCategory(tribeId, name, emoji, dbUser.id);
  return {
    id: cat.id,
    name: cat.name,
    emoji: cat.emoji,
    isActive: cat.isActive,
  };
}

/**
 * Delete (deactivate) a category.
 */
export async function removeCategory(telegramId: number, categoryId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return deleteCategory(categoryId, dbUser.tribeId);
}

/**
 * Get entries by category with pagination.
 */
export async function getEntriesForCategory(
  telegramId: number,
  categoryId: number,
  limit: number = 10,
  offset: number = 0
): Promise<{ entries: GandalfEntryDto[]; total: number }> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const [entries, total] = await Promise.all([
    getEntriesByCategory(dbUser.tribeId, categoryId, limit, offset),
    countEntriesByCategory(dbUser.tribeId, categoryId),
  ]);

  const dtos = await Promise.all(entries.map(async (e) => {
    const files = await getFilesByEntry(e.id);
    const dto = entryToDto(e);
    dto.files = files.map((f) => ({ id: f.id, fileType: f.fileType, fileName: f.fileName }));
    return dto;
  }));

  return { entries: dtos, total };
}

/**
 * Get all entries for the user's scope with pagination.
 */
export async function getAllEntries(
  telegramId: number,
  limit: number = 10,
  offset: number = 0
): Promise<{ entries: GandalfEntryDto[]; total: number }> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const scope = buildScope(dbUser);

  const [entries, total] = await Promise.all([
    getEntriesByScope(scope, limit, offset),
    countEntriesByScope(scope),
  ]);

  const dtos = await Promise.all(entries.map(async (e) => {
    const files = await getFilesByEntry(e.id);
    const dto = entryToDto(e);
    dto.files = files.map((f) => ({ id: f.id, fileType: f.fileType, fileName: f.fileName }));
    return dto;
  }));

  return { entries: dtos, total };
}

/**
 * Get a single entry by ID.
 */
export async function getEntry(telegramId: number, entryId: number): Promise<GandalfEntryDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const scope = buildScope(dbUser);

  const entry = await getEntryByIdScoped(entryId, scope);
  if (!entry) return null;

  const files = await getFilesByEntry(entry.id);
  const dto = entryToDto(entry);
  dto.files = files.map((f) => ({ id: f.id, fileType: f.fileType, fileName: f.fileName }));
  return dto;
}

/**
 * Create a new entry.
 */
export async function addEntry(
  telegramId: number,
  params: {
    categoryId: number;
    title: string;
    price?: number | null;
    nextDate?: string | null;
    additionalInfo?: string | null;
    isImportant?: boolean;
    isUrgent?: boolean;
    visibility?: "tribe" | "private";
    inputMethod?: string;
  }
): Promise<GandalfEntryDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const entry = await createEntry({
    tribeId: dbUser.tribeId,
    categoryId: params.categoryId,
    title: params.title,
    price: params.price ?? null,
    addedByUserId: dbUser.id,
    nextDate: params.nextDate ? new Date(params.nextDate) : null,
    additionalInfo: params.additionalInfo ?? null,
    inputMethod: params.inputMethod ?? "text",
    isImportant: params.isImportant ?? false,
    isUrgent: params.isUrgent ?? false,
    visibility: params.visibility,
  });

  return entryToDto(entry);
}

/**
 * Update an existing entry's fields.
 */
export async function editEntry(
  telegramId: number,
  entryId: number,
  updates: {
    title?: string;
    price?: number | null;
    nextDate?: string | null;
    additionalInfo?: string | null;
    isImportant?: boolean;
    isUrgent?: boolean;
    visibility?: "tribe" | "private";
    categoryId?: number;
  }
): Promise<GandalfEntryDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const scope = buildScope(dbUser);

  const entry = await getEntryByIdScoped(entryId, scope);
  if (!entry) return null;

  const repoUpdates: Parameters<typeof updateEntry>[2] = {};
  if (updates.title !== undefined) repoUpdates.title = updates.title;
  if (updates.price !== undefined) repoUpdates.price = updates.price;
  if (updates.nextDate !== undefined) {
    repoUpdates.nextDate = updates.nextDate ? new Date(updates.nextDate) : null;
  }
  if (updates.additionalInfo !== undefined) repoUpdates.additionalInfo = updates.additionalInfo;
  if (updates.isImportant !== undefined) repoUpdates.isImportant = updates.isImportant;
  if (updates.isUrgent !== undefined) repoUpdates.isUrgent = updates.isUrgent;
  if (updates.visibility !== undefined) repoUpdates.visibility = updates.visibility;
  if (updates.categoryId !== undefined) repoUpdates.categoryId = updates.categoryId;

  const updated = await updateEntry(entryId, dbUser.tribeId, repoUpdates);
  if (!updated) return null;

  return getEntry(telegramId, entryId);
}

/**
 * Update a category's name/emoji.
 */
export async function editCategory(
  telegramId: number,
  categoryId: number,
  updates: { name?: string; emoji?: string }
): Promise<GandalfCategoryDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const cat = await getCategoryById(categoryId, dbUser.tribeId);
  if (!cat) return null;

  const updated = await updateCategory(categoryId, dbUser.tribeId, updates);
  if (!updated) return null;

  const result = await getCategoryById(categoryId, dbUser.tribeId);
  if (!result) return null;

  return {
    id: result.id,
    name: result.name,
    emoji: result.emoji,
    isActive: result.isActive,
  };
}

/**
 * Delete an entry.
 */
export async function removeEntry(telegramId: number, entryId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return deleteEntry(entryId, dbUser.tribeId);
}

/**
 * Toggle important/urgent flag.
 */
export async function toggleFlag(
  telegramId: number,
  entryId: number,
  flag: "important" | "urgent"
): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const scope = buildScope(dbUser);

  const entry = await getEntryByIdScoped(entryId, scope);
  if (!entry) return false;

  return toggleEntryFlag(entryId, dbUser.tribeId, flag);
}

/**
 * Get entries by flag (important/urgent) with pagination.
 */
export async function getEntriesByFlagPaginated(
  telegramId: number,
  flag: "important" | "urgent",
  limit: number = 10,
  offset: number = 0
): Promise<{ entries: GandalfEntryDto[]; total: number }> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const scope = buildScope(dbUser);

  const [entries, total] = await Promise.all([
    getEntriesByFlag(scope, flag, limit, offset),
    countEntriesByFlag(scope, flag),
  ]);

  return {
    entries: entries.map(entryToDto),
    total,
  };
}

/**
 * Get category statistics.
 */
export async function getStats(telegramId: number): Promise<{
  byCategory: Array<{ categoryId: number; categoryName: string; categoryEmoji: string; totalEntries: number; totalPrice: number | null }>;
  byYear: Array<{ year: number; totalEntries: number; totalPrice: number | null }>;
  byUser: Array<{ userId: number; firstName: string; totalEntries: number; totalPrice: number | null }>;
}> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const scope = buildScope(dbUser);
  const tribeId = dbUser.tribeId;

  const effectiveTribeId = tribeId ?? 0;
  const [byCategory, byYear, byUser] = await Promise.all([
    getStatsByCategory(effectiveTribeId),
    getStatsByYear(effectiveTribeId),
    getStatsByUser(effectiveTribeId),
  ]);

  return { byCategory, byYear, byUser };
}
