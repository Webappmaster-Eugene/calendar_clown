/**
 * Wishlist mode command handler.
 * Tribe-wide wishlists with items, priorities, reservations, and file attachments.
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/expenseMode.js";
import { ensureUser, getUserByTelegramId } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
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
  addFileToItem,
  getFilesByItem,
  getLatestItemByOwner,
  getTribeMembersWithWishlists,
} from "../wishlist/repository.js";
import type { WishlistItem } from "../wishlist/repository.js";
import { createLogger } from "../utils/logger.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import { logAction } from "../logging/actionLogger.js";
import { escapeMarkdown } from "../utils/markdown.js";

const log = createLogger("wishlist-mode");

const ITEMS_PAGE_SIZE = 5;
const MAX_WISHLISTS_PER_USER = 5;

// ─── State ──────────────────────────────────────────────────────────────

interface ItemCreationState {
  step: "title" | "description" | "link" | "priority";
  wishlistId: number;
  title?: string;
  description?: string | null;
  link?: string | null;
}

const itemCreationStates = new Map<number, ItemCreationState>();
const wishlistCreationWaiting = new Set<number>();

function getWishlistKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["\u{1F381} \u041C\u043E\u0438 \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u044B", "\u{1F440} \u0412\u0438\u0448\u043B\u0438\u0441\u0442\u044B \u0441\u0435\u043C\u044C\u0438"],
    ["\u2795 \u041D\u043E\u0432\u044B\u0439 \u0432\u0438\u0448\u043B\u0438\u0441\u0442"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

// ─── Main Command ───────────────────────────────────────────────────────

export async function handleWishlistCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("\u{1F381} \u0412\u0438\u0448\u043B\u0438\u0441\u0442 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D (\u043D\u0435\u0442 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F \u043A \u0431\u0430\u0437\u0435 \u0434\u0430\u043D\u043D\u044B\u0445).");
    return;
  }

  const dbUser = await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  if (!dbUser.tribeId) {
    await ctx.reply("\u{1F381} \u0412\u0438\u0448\u043B\u0438\u0441\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432 \u0441\u0435\u043C\u044C\u0438. \u041E\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044C \u043A \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0443.");
    return;
  }

  await setUserMode(telegramId, "wishlist");
  await setModeMenuCommands(ctx, "wishlist");

  const isAdmin = isBootstrapAdmin(telegramId);
  await ctx.reply(
    "\u{1F381} *\u0420\u0435\u0436\u0438\u043C \u0412\u0438\u0448\u043B\u0438\u0441\u0442 \u0430\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u043D*\n\n" +
    "\u0421\u043E\u0437\u0434\u0430\u0432\u0430\u0439\u0442\u0435 \u0441\u043F\u0438\u0441\u043A\u0438 \u0436\u0435\u043B\u0430\u043D\u0438\u0439 \u0434\u043B\u044F \u0441\u0435\u043C\u044C\u0438.\n" +
    "\u0412\u0441\u0435 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 \u0432\u0438\u0434\u044F\u0442 \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u044B \u0434\u0440\u0443\u0433 \u0434\u0440\u0443\u0433\u0430.\n" +
    "\u041C\u043E\u0436\u043D\u043E \u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u044B (\u0441\u043A\u0440\u044B\u0442\u043E \u043E\u0442 \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0430).",
    { parse_mode: "Markdown", ...getWishlistKeyboard(isAdmin) }
  );
}

// ─── My Wishlists ───────────────────────────────────────────────────────

export async function handleMyWishlistsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) {
    await ctx.reply("\u0412\u044B \u043D\u0435 \u0432 \u0441\u0435\u043C\u044C\u0435. \u041E\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044C \u043A \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0443.");
    return;
  }

  const wishlists = await getWishlistsByUser(dbUser.id);

  if (wishlists.length === 0) {
    await ctx.reply(
      "\u{1F381} \u0423 \u0432\u0430\u0441 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u043E\u0432.\n\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u00AB\u2795 \u041D\u043E\u0432\u044B\u0439 \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u00BB \u0447\u0442\u043E\u0431\u044B \u0441\u043E\u0437\u0434\u0430\u0442\u044C."
    );
    return;
  }

  const buttons = wishlists.map((w) => [
    Markup.button.callback(
      `${w.emoji} ${w.name} (${w.itemCount ?? 0})`,
      `wl_my:${w.id}`
    ),
    Markup.button.callback("\u{1F5D1}", `wl_my_del:${w.id}`),
  ]);

  await ctx.reply(`\u{1F381} *\u041C\u043E\u0438 \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u044B (${wishlists.length}):*`, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
}

// ─── Tribe Wishlists ────────────────────────────────────────────────────

export async function handleTribeWishlistsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) {
    await ctx.reply("\u0412\u044B \u043D\u0435 \u0432 \u0441\u0435\u043C\u044C\u0435.");
    return;
  }

  const members = await getTribeMembersWithWishlists(dbUser.tribeId);

  if (members.length === 0) {
    await ctx.reply("\u{1F440} \u041D\u0438 \u0443 \u043A\u043E\u0433\u043E \u0432 \u0441\u0435\u043C\u044C\u0435 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u043E\u0432.");
    return;
  }

  const buttons = members.map((m) => [
    Markup.button.callback(
      `\u{1F464} ${m.firstName} (${m.wishlistCount} \u0432\u0438\u0448\u043B., ${m.totalItems} \u044D\u043B.)`,
      `wl_tribe_user:${m.userId}`
    ),
  ]);

  await ctx.reply("\u{1F440} *\u0412\u0438\u0448\u043B\u0438\u0441\u0442\u044B \u0441\u0435\u043C\u044C\u0438:*", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
}

// ─── New Wishlist ───────────────────────────────────────────────────────

export async function handleNewWishlistButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) {
    await ctx.reply("\u0412\u044B \u043D\u0435 \u0432 \u0441\u0435\u043C\u044C\u0435.");
    return;
  }

  const count = await countWishlistsByUser(dbUser.id);
  if (count >= MAX_WISHLISTS_PER_USER) {
    await ctx.reply(`\u26A0\uFE0F \u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C ${MAX_WISHLISTS_PER_USER} \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u043E\u0432. \u0423\u0434\u0430\u043B\u0438\u0442\u0435 \u0441\u0442\u0430\u0440\u044B\u0439 \u043F\u0435\u0440\u0435\u0434 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435\u043C \u043D\u043E\u0432\u043E\u0433\u043E.`);
    return;
  }

  wishlistCreationWaiting.add(telegramId);
  await ctx.reply(
    "\u041E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043D\u043E\u0432\u043E\u0433\u043E \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u0430.\n\u041C\u043E\u0436\u043D\u043E \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u044D\u043C\u043E\u0434\u0437\u0438 \u0432 \u043D\u0430\u0447\u0430\u043B\u0435, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u00AB\u{1F3AE} \u0413\u0435\u0439\u043C\u0438\u043D\u0433\u00BB"
  );
}

// ─── Callback Handlers ──────────────────────────────────────────────────

export async function handleWlMyCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^wl_my:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const wishlistId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) { await ctx.answerCbQuery(); return; }

  await showWishlistItems(ctx, wishlistId, dbUser.tribeId, dbUser.id, 0, true);
}

export async function handleWlMyDelCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^wl_my_del:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const wishlistId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const deleted = await deleteWishlist(wishlistId, dbUser.id);
  if (deleted) {
    logAction(dbUser.id, telegramId, "wishlist_delete", { wishlistId });
    await ctx.answerCbQuery("\u0412\u0438\u0448\u043B\u0438\u0441\u0442 \u0443\u0434\u0430\u043B\u0451\u043D");
    await ctx.editMessageText("\u2705 \u0412\u0438\u0448\u043B\u0438\u0441\u0442 \u0443\u0434\u0430\u043B\u0451\u043D.");
  } else {
    await ctx.answerCbQuery("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0443\u0434\u0430\u043B\u0438\u0442\u044C");
  }
}

export async function handleWlAddCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^wl_add:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const wishlistId = parseInt(match[1], 10);
  itemCreationStates.set(telegramId, { step: "title", wishlistId });

  await ctx.answerCbQuery();
  await ctx.editMessageText("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0436\u0435\u043B\u0430\u043D\u0438\u044F:");
}

export async function handleWlItemCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^wl_item:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const itemId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) { await ctx.answerCbQuery(); return; }

  const item = await getItemById(itemId);
  if (!item) {
    await ctx.answerCbQuery("\u042D\u043B\u0435\u043C\u0435\u043D\u0442 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D");
    return;
  }

  const wishlist = await getWishlistById(item.wishlistId, dbUser.tribeId);
  if (!wishlist) { await ctx.answerCbQuery(); return; }

  const isOwner = wishlist.userId === dbUser.id;
  const files = await getFilesByItem(itemId);

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    formatItemDetail(item, wishlist.name, isOwner, dbUser.id, files.length),
    {
      parse_mode: "Markdown",
      ...buildItemDetailButtons(item, isOwner, dbUser.id, files.length),
    }
  );
}

export async function handleWlItemDelCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^wl_item_del:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const itemId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) { await ctx.answerCbQuery(); return; }

  // Verify ownership
  const item = await getItemById(itemId);
  if (!item) {
    await ctx.answerCbQuery("\u042D\u043B\u0435\u043C\u0435\u043D\u0442 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D");
    return;
  }
  const wishlist = await getWishlistById(item.wishlistId, dbUser.tribeId);
  if (!wishlist || wishlist.userId !== dbUser.id) {
    await ctx.answerCbQuery("\u041C\u043E\u0436\u043D\u043E \u0443\u0434\u0430\u043B\u044F\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u0432\u043E\u0438 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u044B");
    return;
  }

  await deleteItem(itemId);
  logAction(dbUser.id, telegramId, "wishlist_item_delete", { itemId });
  await ctx.answerCbQuery("\u042D\u043B\u0435\u043C\u0435\u043D\u0442 \u0443\u0434\u0430\u043B\u0451\u043D");
  await ctx.editMessageText("\u2705 \u042D\u043B\u0435\u043C\u0435\u043D\u0442 \u0443\u0434\u0430\u043B\u0451\u043D.");
}

export async function handleWlItemFilesCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^wl_item_files:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const itemId = parseInt(match[1], 10);
  const files = await getFilesByItem(itemId);
  await ctx.answerCbQuery();

  if (files.length === 0) {
    await ctx.reply("\u041A \u044D\u0442\u043E\u043C\u0443 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0443 \u043D\u0435\u0442 \u0444\u0430\u0439\u043B\u043E\u0432.");
    return;
  }

  for (const file of files) {
    try {
      if (file.fileType === "photo") {
        await ctx.replyWithPhoto(file.telegramFileId, {
          caption: file.fileName ?? undefined,
        });
      } else {
        await ctx.replyWithDocument(file.telegramFileId, {
          caption: file.fileName ?? undefined,
        });
      }
    } catch (err) {
      log.error(`Failed to send wishlist file ${file.id}:`, err);
      await ctx.reply(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0444\u0430\u0439\u043B: ${file.fileName ?? file.telegramFileId}`);
    }
  }
}

export async function handleWlTribeUserCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^wl_tribe_user:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const targetUserId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) { await ctx.answerCbQuery(); return; }

  const wishlists = await getWishlistsByUser(targetUserId);

  if (wishlists.length === 0) {
    await ctx.answerCbQuery("\u041D\u0435\u0442 \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u043E\u0432");
    return;
  }

  const isOwner = targetUserId === dbUser.id;
  const prefix = isOwner ? "wl_my" : "wl_tribe";

  const buttons = wishlists.map((w) => [
    Markup.button.callback(
      `${w.emoji} ${w.name} (${w.itemCount ?? 0})`,
      `${prefix}:${w.id}`
    ),
  ]);

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `\u{1F381} *\u0412\u0438\u0448\u043B\u0438\u0441\u0442\u044B (${wishlists.length}):*`,
    { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) }
  );
}

export async function handleWlTribeCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^wl_tribe:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const wishlistId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) { await ctx.answerCbQuery(); return; }

  await showWishlistItems(ctx, wishlistId, dbUser.tribeId, dbUser.id, 0, false);
}

export async function handleWlReserveCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^wl_reserve:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const itemId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const reserved = await reserveItem(itemId, dbUser.id);
  if (reserved) {
    logAction(dbUser.id, telegramId, "wishlist_item_reserve", { itemId });
    await ctx.answerCbQuery("\u2705 \u0412\u044B \u0437\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043B\u0438 \u044D\u0442\u043E\u0442 \u044D\u043B\u0435\u043C\u0435\u043D\u0442");

    // Refresh item detail
    const item = await getItemById(itemId);
    if (item && dbUser.tribeId) {
      const wishlist = await getWishlistById(item.wishlistId, dbUser.tribeId);
      if (wishlist) {
        const isOwner = wishlist.userId === dbUser.id;
        const files = await getFilesByItem(itemId);
        await ctx.editMessageText(
          formatItemDetail(item, wishlist.name, isOwner, dbUser.id, files.length),
          {
            parse_mode: "Markdown",
            ...buildItemDetailButtons(item, isOwner, dbUser.id, files.length),
          }
        );
      }
    }
  } else {
    await ctx.answerCbQuery("\u0423\u0436\u0435 \u0437\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043E");
  }
}

export async function handleWlUnreserveCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^wl_unreserve:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const itemId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const unreserved = await unreserveItem(itemId, dbUser.id);
  if (unreserved) {
    logAction(dbUser.id, telegramId, "wishlist_item_unreserve", { itemId });
    await ctx.answerCbQuery("\u0411\u0440\u043E\u043D\u044C \u0441\u043D\u044F\u0442\u0430");

    // Refresh item detail
    const item = await getItemById(itemId);
    if (item && dbUser.tribeId) {
      const wishlist = await getWishlistById(item.wishlistId, dbUser.tribeId);
      if (wishlist) {
        const isOwner = wishlist.userId === dbUser.id;
        const files = await getFilesByItem(itemId);
        await ctx.editMessageText(
          formatItemDetail(item, wishlist.name, isOwner, dbUser.id, files.length),
          {
            parse_mode: "Markdown",
            ...buildItemDetailButtons(item, isOwner, dbUser.id, files.length),
          }
        );
      }
    }
  } else {
    await ctx.answerCbQuery("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043D\u044F\u0442\u044C \u0431\u0440\u043E\u043D\u044C");
  }
}

export async function handleWlPageCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^wl_page:(\d+):(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const wishlistId = parseInt(match[1], 10);
  const offset = parseInt(match[2], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) { await ctx.answerCbQuery(); return; }

  const wishlist = await getWishlistById(wishlistId, dbUser.tribeId);
  if (!wishlist) { await ctx.answerCbQuery(); return; }

  const isOwner = wishlist.userId === dbUser.id;
  await showWishlistItems(ctx, wishlistId, dbUser.tribeId, dbUser.id, offset, isOwner);
}

// ─── Text Handler ───────────────────────────────────────────────────────

export async function handleWishlistText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;

  const text = ctx.message.text.trim();
  if (!text) return false;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) return false;

  // Wishlist creation flow
  if (wishlistCreationWaiting.has(telegramId)) {
    wishlistCreationWaiting.delete(telegramId);
    try {
      const emojiMatch = text.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*/u);
      let name = text;
      let emoji = "\u{1F381}";
      if (emojiMatch) {
        emoji = emojiMatch[1];
        name = text.slice(emojiMatch[0].length).trim();
      }
      if (!name) name = text;

      const wishlist = await createWishlist(dbUser.tribeId, dbUser.id, name, emoji);
      logAction(dbUser.id, telegramId, "wishlist_create", { wishlistId: wishlist.id, name });
      await ctx.reply(`${wishlist.emoji} \u0412\u0438\u0448\u043B\u0438\u0441\u0442 \u00AB${wishlist.name}\u00BB \u0441\u043E\u0437\u0434\u0430\u043D!`);
    } catch (err) {
      log.error("Error creating wishlist:", err);
      await ctx.reply("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0438 \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u0430. \u0412\u043E\u0437\u043C\u043E\u0436\u043D\u043E, \u0442\u0430\u043A\u043E\u0439 \u0443\u0436\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442.");
    }
    return true;
  }

  // Item creation flow
  const state = itemCreationStates.get(telegramId);
  if (!state) return false;

  if (state.step === "title") {
    state.title = text;
    state.step = "description";
    itemCreationStates.set(telegramId, state);
    await ctx.reply("\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 (\u0438\u043B\u0438 \u00AB-\u00BB \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C):");
    return true;
  }

  if (state.step === "description") {
    state.description = text === "-" ? null : text;
    state.step = "link";
    itemCreationStates.set(telegramId, state);
    await ctx.reply("\u0421\u0441\u044B\u043B\u043A\u0430 URL (\u0438\u043B\u0438 \u00AB-\u00BB \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C):");
    return true;
  }

  if (state.step === "link") {
    state.link = text === "-" ? null : text;
    state.step = "priority";
    itemCreationStates.set(telegramId, state);
    await ctx.reply("\u041F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442 (1 = \u0441\u0430\u043C\u044B\u0439 \u0432\u0430\u0436\u043D\u044B\u0439, \u0438\u043B\u0438 \u00AB-\u00BB = 1):");
    return true;
  }

  if (state.step === "priority") {
    itemCreationStates.delete(telegramId);

    let priority = 1;
    if (text !== "-") {
      const parsed = parseInt(text, 10);
      if (!isNaN(parsed) && parsed >= 1) {
        priority = parsed;
      }
    }

    try {
      const item = await createItem({
        wishlistId: state.wishlistId,
        title: state.title!,
        description: state.description,
        link: state.link,
        priority,
      });
      logAction(dbUser.id, telegramId, "wishlist_item_create", {
        itemId: item.id,
        wishlistId: state.wishlistId,
      });

      const descStr = item.description ? `\n\u{1F4DD} ${escapeMarkdown(item.description)}` : "";
      const linkStr = item.link ? `\n\u{1F517} ${item.link}` : "";
      const prioStr = `\n\u2B50 \u041F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442: ${item.priority}`;

      await ctx.reply(
        `\u2705 \u0416\u0435\u043B\u0430\u043D\u0438\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E\n\u{1F381} ${escapeMarkdown(item.title)}${descStr}${linkStr}${prioStr}\n\n\u041C\u043E\u0436\u0435\u0442\u0435 \u043F\u0440\u0438\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0444\u043E\u0442\u043E \u0438\u043B\u0438 \u0444\u0430\u0439\u043B.`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      log.error("Error creating wishlist item:", err);
      await ctx.reply("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0438 \u0436\u0435\u043B\u0430\u043D\u0438\u044F.");
    }
    return true;
  }

  return false;
}

// ─── File Attachment Handler ────────────────────────────────────────────

export async function handleWishlistFileAttachment(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) return false;

  let fileId: string | undefined;
  let fileType: string = "document";
  let fileName: string | null = null;
  let mimeType: string | null = null;
  let fileSize: number | null = null;

  if (ctx.message && "photo" in ctx.message && ctx.message.photo?.length) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    fileId = photo.file_id;
    fileType = "photo";
    fileSize = photo.file_size ?? null;
    mimeType = "image/jpeg";
  } else if (ctx.message && "document" in ctx.message && ctx.message.document) {
    const doc = ctx.message.document;
    fileId = doc.file_id;
    fileType = "document";
    fileName = doc.file_name ?? null;
    mimeType = doc.mime_type ?? null;
    fileSize = doc.file_size ?? null;
  }

  if (!fileId) return false;

  // Attach to latest item
  const latestItem = await getLatestItemByOwner(dbUser.id);
  if (!latestItem) {
    await ctx.reply("\u041D\u0435\u0442 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u043E\u0432 \u0434\u043B\u044F \u043F\u0440\u0438\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u0438\u044F \u0444\u0430\u0439\u043B\u0430. \u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0434\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u0436\u0435\u043B\u0430\u043D\u0438\u0435.");
    return true;
  }

  try {
    await addFileToItem({
      itemId: latestItem.id,
      telegramFileId: fileId,
      fileType,
      fileName,
      mimeType,
      fileSizeBytes: fileSize,
    });
    await ctx.reply(
      `\u{1F4CE} \u0424\u0430\u0439\u043B \u043F\u0440\u0438\u043A\u0440\u0435\u043F\u043B\u0451\u043D \u043A:\n\u{1F381} ${latestItem.title}`
    );
  } catch (err) {
    log.error("Error attaching file to wishlist item:", err);
    await ctx.reply("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043F\u0440\u0438\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u0438\u0438 \u0444\u0430\u0439\u043B\u0430.");
  }
  return true;
}

// ─── Helpers ────────────────────────────────────────────────────────────

async function showWishlistItems(
  ctx: Context,
  wishlistId: number,
  tribeId: number,
  viewerUserId: number,
  offset: number,
  isOwnerView: boolean
): Promise<void> {
  const wishlist = await getWishlistById(wishlistId, tribeId);
  if (!wishlist) {
    await ctx.answerCbQuery("\u0412\u0438\u0448\u043B\u0438\u0441\u0442 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D");
    return;
  }

  const isOwner = wishlist.userId === viewerUserId;
  const total = await countItemsByWishlist(wishlistId);
  const items = await getItemsByWishlist(wishlistId, ITEMS_PAGE_SIZE, offset);

  await ctx.answerCbQuery();

  if (items.length === 0 && offset === 0) {
    const text = `${wishlist.emoji} *${escapeMarkdown(wishlist.name)}*\n\n\u041F\u0443\u0441\u0442\u043E\u0439 \u0432\u0438\u0448\u043B\u0438\u0441\u0442.`;
    const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
    if (isOwner) {
      buttons.push([Markup.button.callback("\u2795 \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0436\u0435\u043B\u0430\u043D\u0438\u0435", `wl_add:${wishlistId}`)]);
    }
    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
    return;
  }

  const totalPages = Math.ceil(total / ITEMS_PAGE_SIZE);
  const currentPage = Math.floor(offset / ITEMS_PAGE_SIZE) + 1;

  const ownerLabel = wishlist.ownerName ? ` (\u{1F464} ${escapeMarkdown(wishlist.ownerName)})` : "";
  const header = `${wishlist.emoji} *${escapeMarkdown(wishlist.name)}*${ownerLabel}\n\u{1F4CB} ${currentPage}/${totalPages}, \u0432\u0441\u0435\u0433\u043E: ${total}\n\n`;

  const lines = items.map((item, i) => {
    const num = offset + i + 1;
    const reserveStatus = formatReserveStatus(item, isOwner, viewerUserId);
    const prioStr = item.priority > 1 ? ` | \u2B50${item.priority}` : " | \u2B50";
    return `*${num}.* ${escapeMarkdown(item.title)}${prioStr}${reserveStatus}`;
  });

  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = items.map((item) => [
    Markup.button.callback(`\u{1F381} #${item.id}`, `wl_item:${item.id}`),
    ...(isOwner
      ? [Markup.button.callback("\u{1F5D1}", `wl_item_del:${item.id}`)]
      : []),
  ]);

  if (isOwner) {
    buttons.push([Markup.button.callback("\u2795 \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0436\u0435\u043B\u0430\u043D\u0438\u0435", `wl_add:${wishlistId}`)]);
  }

  // Pagination
  const navButtons: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (offset > 0) {
    navButtons.push(Markup.button.callback("\u2B05\uFE0F \u041D\u0430\u0437\u0430\u0434", `wl_page:${wishlistId}:${offset - ITEMS_PAGE_SIZE}`));
  }
  if (offset + ITEMS_PAGE_SIZE < total) {
    navButtons.push(Markup.button.callback("\u0412\u043F\u0435\u0440\u0451\u0434 \u27A1\uFE0F", `wl_page:${wishlistId}:${offset + ITEMS_PAGE_SIZE}`));
  }
  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }

  await ctx.editMessageText(header + lines.join("\n"), {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
}

function formatReserveStatus(item: WishlistItem, isOwner: boolean, viewerUserId: number): string {
  if (isOwner) return ""; // Owner doesn't see reservation info (surprise!)
  if (!item.isReserved) return "";
  if (item.reservedByUserId === viewerUserId) return "\n  \u2705 \u0412\u044B \u0437\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043B\u0438";
  return "\n  \u{1F512} \u0423\u0436\u0435 \u0437\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043E";
}

function formatItemDetail(
  item: WishlistItem,
  wishlistName: string,
  isOwner: boolean,
  viewerUserId: number,
  filesCount: number
): string {
  const parts: string[] = [
    `\u{1F381} *\u042D\u043B\u0435\u043C\u0435\u043D\u0442 #${item.id}*`,
    `\u{1F4CB} ${escapeMarkdown(wishlistName)}`,
    `\u{1F4DD} ${escapeMarkdown(item.title)}`,
  ];

  if (item.description) {
    parts.push(`\u{1F4AC} ${escapeMarkdown(item.description)}`);
  }
  if (item.link) {
    parts.push(`\u{1F517} ${item.link}`);
  }
  parts.push(`\u2B50 \u041F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442: ${item.priority}`);

  if (!isOwner) {
    if (item.isReserved) {
      if (item.reservedByUserId === viewerUserId) {
        parts.push("\u2705 \u0412\u044B \u0437\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043B\u0438 \u044D\u0442\u043E\u0442 \u044D\u043B\u0435\u043C\u0435\u043D\u0442");
      } else {
        parts.push("\u{1F512} \u0423\u0436\u0435 \u0437\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0434\u0440\u0443\u0433\u0438\u043C \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u043C");
      }
    }
  }

  if (filesCount > 0) {
    parts.push(`\u{1F4CE} \u0424\u0430\u0439\u043B\u043E\u0432: ${filesCount}`);
  }

  const date = item.createdAt.toLocaleDateString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  parts.push(`_${date}_`);

  return parts.join("\n");
}

function buildItemDetailButtons(
  item: WishlistItem,
  isOwner: boolean,
  viewerUserId: number,
  filesCount: number
) {
  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  if (filesCount > 0) {
    buttons.push([
      Markup.button.callback(`\u{1F4CE} \u0424\u0430\u0439\u043B\u044B (${filesCount})`, `wl_item_files:${item.id}`),
    ]);
  }

  if (isOwner) {
    buttons.push([
      Markup.button.callback("\u{1F5D1} \u0423\u0434\u0430\u043B\u0438\u0442\u044C", `wl_item_del:${item.id}`),
    ]);
  } else {
    // Reservation buttons
    if (!item.isReserved) {
      buttons.push([
        Markup.button.callback("\u{1F381} \u0417\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C", `wl_reserve:${item.id}`),
      ]);
    } else if (item.reservedByUserId === viewerUserId) {
      buttons.push([
        Markup.button.callback("\u274C \u0421\u043D\u044F\u0442\u044C \u0431\u0440\u043E\u043D\u044C", `wl_unreserve:${item.id}`),
      ]);
    }
  }

  return Markup.inlineKeyboard(buttons);
}
