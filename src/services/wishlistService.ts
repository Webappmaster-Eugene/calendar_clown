/**
 * Wishlist business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  createWishlist,
  getWishlistsByUser,
  getWishlistsByTribe,
  getWishlistById,
  deleteWishlist,
  countWishlistsByUser,
  createItem,
  getItemsByWishlist,
  getItemById,
  deleteItem,
  countItemsByWishlist,
  reserveItem,
  unreserveItem,
  getFilesByItem,
  getTribeMembersWithWishlists,
} from "../wishlist/repository.js";
import type { WishlistItem } from "../wishlist/repository.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import type {
  WishlistDto,
  WishlistItemDto,
  WishlistFileDto,
} from "../shared/types.js";

const log = createLogger("wishlist-service");

const MAX_WISHLISTS_PER_USER = 5;

// ─── Helpers ──────────────────────────────────────────────────

function requireDb(): void {
  if (!isDatabaseAvailable()) {
    throw new Error("База данных недоступна.");
  }
}

async function requireDbUser(telegramId: number) {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) throw new Error("Пользователь не найден.");
  return dbUser;
}

function itemToDto(item: WishlistItem, requesterId: number, files: Array<{ id: number; fileType: string; fileName: string | null }> = []): WishlistItemDto {
  return {
    id: item.id,
    wishlistId: item.wishlistId,
    title: item.title,
    description: item.description,
    link: item.link,
    priority: item.priority,
    isReserved: item.isReserved,
    reservedByName: item.reservedByName ?? null,
    canUnreserve: item.reservedByUserId === requesterId,
    files: files.map((f) => ({ id: f.id, fileType: f.fileType, fileName: f.fileName })),
    createdAt: item.createdAt.toISOString(),
  };
}

// ─── Service Functions ────────────────────────────────────────

/**
 * Get user's own wishlists.
 */
export async function getUserWishlists(telegramId: number): Promise<WishlistDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const wishlists = await getWishlistsByUser(dbUser.id);

  return wishlists.map((w) => ({
    id: w.id,
    name: w.name,
    emoji: w.emoji,
    ownerName: dbUser.firstName,
    itemCount: w.itemCount ?? 0,
    isOwn: true,
    createdAt: w.createdAt.toISOString(),
  }));
}

/**
 * Get tribe wishlists (all members).
 */
export async function getTribeWishlists(telegramId: number): Promise<WishlistDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) return [];

  const wishlists = await getWishlistsByTribe(dbUser.tribeId);

  return wishlists.map((w) => ({
    id: w.id,
    name: w.name,
    emoji: w.emoji,
    ownerName: w.ownerName ?? "",
    itemCount: w.itemCount ?? 0,
    isOwn: w.userId === dbUser.id,
    createdAt: w.createdAt.toISOString(),
  }));
}

/**
 * Create a new wishlist.
 */
export async function createNewWishlist(
  telegramId: number,
  name: string,
  emoji: string = "🎁"
): Promise<WishlistDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) throw new Error("Вишлист доступен только для участников трайба.");

  const count = await countWishlistsByUser(dbUser.id);
  if (count >= MAX_WISHLISTS_PER_USER) {
    throw new Error(`Достигнут лимит: максимум ${MAX_WISHLISTS_PER_USER} вишлистов.`);
  }

  const wishlist = await createWishlist(dbUser.tribeId, dbUser.id, name, emoji);

  return {
    id: wishlist.id,
    name: wishlist.name,
    emoji: wishlist.emoji,
    ownerName: dbUser.firstName,
    itemCount: 0,
    isOwn: true,
    createdAt: wishlist.createdAt.toISOString(),
  };
}

/**
 * Delete a wishlist.
 */
export async function removeWishlist(telegramId: number, wishlistId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return deleteWishlist(wishlistId, dbUser.id);
}

/**
 * Get items in a wishlist with pagination.
 */
export async function getWishlistItems(
  telegramId: number,
  wishlistId: number,
  limit: number = 10,
  offset: number = 0
): Promise<{ items: WishlistItemDto[]; total: number; wishlistName: string }> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) throw new Error("Нет трайба.");

  const wishlist = await getWishlistById(wishlistId, dbUser.tribeId);
  if (!wishlist) throw new Error("Вишлист не найден.");

  const [items, total] = await Promise.all([
    getItemsByWishlist(wishlistId, limit, offset),
    countItemsByWishlist(wishlistId),
  ]);

  const dtos = await Promise.all(items.map(async (item) => {
    const files = await getFilesByItem(item.id);
    return itemToDto(item, dbUser.id, files.map((f) => ({
      id: f.id,
      fileType: f.fileType,
      fileName: f.fileName,
    })));
  }));

  return { items: dtos, total, wishlistName: wishlist.name };
}

/**
 * Add an item to a wishlist.
 */
export async function addWishlistItem(
  telegramId: number,
  wishlistId: number,
  params: { title: string; description?: string; link?: string; priority?: number }
): Promise<WishlistItemDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const item = await createItem({
    wishlistId,
    title: params.title,
    description: params.description ?? null,
    link: params.link ?? null,
    priority: params.priority ?? 1,
  });

  return itemToDto(item, dbUser.id);
}

/**
 * Delete an item from a wishlist.
 */
export async function removeWishlistItem(telegramId: number, itemId: number): Promise<boolean> {
  requireDb();
  return deleteItem(itemId);
}

/**
 * Reserve an item.
 */
export async function reserveWishlistItem(telegramId: number, itemId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return reserveItem(itemId, dbUser.id);
}

/**
 * Unreserve an item.
 */
export async function unreserveWishlistItem(telegramId: number, itemId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return unreserveItem(itemId, dbUser.id);
}
