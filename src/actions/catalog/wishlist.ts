import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getUserWishlists,
  getTribeWishlists,
  createNewWishlist,
  updateWishlistDetails,
  removeWishlist,
  getWishlistItems,
  addWishlistItem,
  editWishlistItem,
  reserveWishlistItem,
  unreserveWishlistItem,
  removeWishlistItem,
} from "../../services/wishlistService.js";

const idArg = z.object({ id: z.number().int().positive() });
const itemIdArg = z.object({ itemId: z.number().int().positive() });

export const wishlistActions: Action[] = [
  defineAction({
    name: "wishlist.list", mode: "wishlist", humanTitle: "Мои вишлисты",
    description: "Показать собственные вишлисты (с id).",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getUserWishlists(ctx.telegramId) }),
  }),
  defineAction({
    name: "wishlist.tribe.list", mode: "wishlist", humanTitle: "Вишлисты трайба",
    description: "Показать вишлисты участников трайба.",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getTribeWishlists(ctx.telegramId) }),
  }),
  defineAction({
    name: "wishlist.create", mode: "wishlist", humanTitle: "Создать вишлист",
    description: "Создать список желаний.",
    argsSchema: z.object({ name: z.string().min(1), emoji: z.string().optional() }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await createNewWishlist(ctx.telegramId, a.name.trim(), a.emoji) }),
  }),
  defineAction({
    name: "wishlist.update", mode: "wishlist", humanTitle: "Изменить вишлист",
    description: "Изменить название/эмодзи вишлиста по id.",
    argsSchema: z.object({ id: z.number().int().positive(), name: z.string().optional(), emoji: z.string().optional() }),
    mutates: true,
    handler: async (ctx, a) => {
      const wl = await updateWishlistDetails(ctx.telegramId, a.id, { name: a.name, emoji: a.emoji });
      if (!wl) throw new Error("Вишлист не найден.");
      return { data: wl };
    },
  }),
  defineAction({
    name: "wishlist.delete", mode: "wishlist", humanTitle: "Удалить вишлист",
    description: "Удалить вишлист по id.",
    argsSchema: idArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeWishlist(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "wishlist.items.list", mode: "wishlist", humanTitle: "Элементы вишлиста",
    description: "Показать элементы вишлиста по id (пагинация).",
    argsSchema: z.object({ id: z.number().int().positive(), limit: z.number().int().positive().max(100).optional(), offset: z.number().int().min(0).optional() }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getWishlistItems(ctx.telegramId, a.id, a.limit ?? 10, a.offset ?? 0) }),
  }),
  defineAction({
    name: "wishlist.item.add", mode: "wishlist", humanTitle: "Добавить желание",
    description: "Добавить элемент в вишлист (title, опц. description/link/priority).",
    argsSchema: z.object({
      wishlistId: z.number().int().positive(),
      title: z.string().min(1),
      description: z.string().optional(),
      link: z.string().optional(),
      priority: z.number().int().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => ({
      data: await addWishlistItem(ctx.telegramId, a.wishlistId, {
        title: a.title.trim(), description: a.description, link: a.link, priority: a.priority,
      }),
    }),
  }),
  defineAction({
    name: "wishlist.item.edit", mode: "wishlist", humanTitle: "Изменить желание",
    description: "Изменить элемент по itemId (переданные поля).",
    argsSchema: z.object({
      itemId: z.number().int().positive(),
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      link: z.string().nullable().optional(),
      priority: z.number().int().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => {
      const { itemId, ...updates } = a;
      const item = await editWishlistItem(ctx.telegramId, itemId, updates);
      if (!item) throw new Error("Элемент не найден.");
      return { data: item };
    },
  }),
  defineAction({
    name: "wishlist.item.reserve", mode: "wishlist", humanTitle: "Забронировать",
    description: "Забронировать элемент вишлиста по itemId.",
    argsSchema: itemIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { reserved: await reserveWishlistItem(ctx.telegramId, a.itemId), itemId: a.itemId } }),
  }),
  defineAction({
    name: "wishlist.item.unreserve", mode: "wishlist", humanTitle: "Снять бронь",
    description: "Снять бронь с элемента по itemId.",
    argsSchema: itemIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { unreserved: await unreserveWishlistItem(ctx.telegramId, a.itemId), itemId: a.itemId } }),
  }),
  defineAction({
    name: "wishlist.item.delete", mode: "wishlist", humanTitle: "Удалить желание",
    description: "Удалить элемент по itemId.",
    argsSchema: itemIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeWishlistItem(ctx.telegramId, a.itemId), itemId: a.itemId } }),
  }),
];
