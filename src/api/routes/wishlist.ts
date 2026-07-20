import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
import {
  getUserWishlists,
  getTribeWishlists,
  createNewWishlist,
  updateWishlistDetails,
  getWishlistItems,
  addWishlistItem,
  editWishlistItem,
  reserveWishlistItem,
  unreserveWishlistItem,
  removeWishlistItem,
  removeWishlist,
} from "../../services/wishlistService.js";
import { logApiAction } from "../../logging/actionLogger.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

const idParam = z.object({ id: z.coerce.number().int().positive() });
const itemIdParam = z.object({ itemId: z.coerce.number().int().positive() });
const createWishlistBody = z.object({
  name: z.string(),
  emoji: z.string().optional(),
});
const updateWishlistBody = z.object({
  name: z.string().optional(),
  emoji: z.string().optional(),
});
const addItemBody = z.object({
  title: z.string(),
  description: z.string().optional(),
  link: z.string().optional(),
  priority: z.number().optional(),
});
const editItemBody = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  link: z.string().nullable().optional(),
  priority: z.number().optional(),
});

app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const scope = c.req.query("scope") ?? "all";

  try {
    if (scope === "own") {
      const own = await getUserWishlists(telegramId);
      return c.json({ ok: true, data: { own, tribe: [] } });
    }
    if (scope === "tribe") {
      const tribe = await getTribeWishlists(telegramId);
      return c.json({ ok: true, data: { own: [], tribe } });
    }
    const [own, tribe] = await Promise.all([
      getUserWishlists(telegramId),
      getTribeWishlists(telegramId),
    ]);
    return c.json({ ok: true, data: { own, tribe } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get wishlists";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const wishlistId = parseInt(c.req.param("id"), 10);

  if (isNaN(wishlistId)) {
    return c.json({ ok: false, error: "Invalid wishlist ID" }, 400);
  }

  try {
    const deleted = await removeWishlist(telegramId, wishlistId);
    logApiAction(telegramId, "wishlist_delete", { wishlistId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete wishlist";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/:id", zValidator("param", idParam), zValidator("json", updateWishlistBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const wishlistId = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{ name?: string; emoji?: string }>();

  if (isNaN(wishlistId)) {
    return c.json({ ok: false, error: "Invalid wishlist ID" }, 400);
  }
  if (body.name !== undefined && !body.name.trim()) {
    return c.json({ ok: false, error: "name cannot be empty" }, 400);
  }

  try {
    const updates: { name?: string; emoji?: string } = {};
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.emoji !== undefined) updates.emoji = body.emoji;

    const wishlist = await updateWishlistDetails(telegramId, wishlistId, updates);
    if (!wishlist) {
      return c.json({ ok: false, error: "Wishlist not found or access denied" }, 404);
    }
    logApiAction(telegramId, "wishlist_update", { wishlistId });
    return c.json({ ok: true, data: wishlist });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update wishlist";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/", zValidator("json", createWishlistBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ name: string; emoji?: string }>();

  if (!body.name?.trim()) {
    return c.json({ ok: false, error: "name is required" }, 400);
  }

  try {
    const wishlist = await createNewWishlist(telegramId, body.name.trim(), body.emoji);
    logApiAction(telegramId, "wishlist_create", { name: body.name.trim() });
    return c.json({ ok: true, data: wishlist });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create wishlist";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/:id/items", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const wishlistId = parseInt(c.req.param("id"), 10);

  if (isNaN(wishlistId)) {
    return c.json({ ok: false, error: "Invalid wishlist ID" }, 400);
  }

  try {
    const result = await getWishlistItems(telegramId, wishlistId);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get wishlist items";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/:id/items", zValidator("param", idParam), zValidator("json", addItemBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const wishlistId = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{
    title: string;
    description?: string;
    link?: string;
    priority?: number;
  }>();

  if (isNaN(wishlistId)) {
    return c.json({ ok: false, error: "Invalid wishlist ID" }, 400);
  }
  if (!body.title?.trim()) {
    return c.json({ ok: false, error: "title is required" }, 400);
  }

  try {
    const item = await addWishlistItem(telegramId, wishlistId, {
      title: body.title.trim(),
      description: body.description,
      link: body.link,
      priority: body.priority,
    });
    logApiAction(telegramId, "wishlist_item_create", { wishlistId, title: body.title.trim() });
    return c.json({ ok: true, data: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add item";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/items/:itemId", zValidator("param", itemIdParam), zValidator("json", editItemBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const itemId = parseInt(c.req.param("itemId"), 10);
  const body = await c.req.json<{
    title?: string;
    description?: string | null;
    link?: string | null;
    priority?: number;
  }>();

  if (isNaN(itemId)) {
    return c.json({ ok: false, error: "Invalid item ID" }, 400);
  }

  if (body.title !== undefined && !body.title.trim()) {
    return c.json({ ok: false, error: "title cannot be empty" }, 400);
  }

  try {
    const updates: { title?: string; description?: string | null; link?: string | null; priority?: number } = {};
    if (body.title !== undefined) updates.title = body.title.trim();
    if (body.description !== undefined) updates.description = body.description;
    if (body.link !== undefined) updates.link = body.link;
    if (body.priority !== undefined) updates.priority = body.priority;

    const item = await editWishlistItem(telegramId, itemId, updates);
    if (!item) {
      return c.json({ ok: false, error: "Item not found or access denied" }, 404);
    }
    return c.json({ ok: true, data: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to edit item";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/items/:itemId/reserve", zValidator("param", itemIdParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const itemId = parseInt(c.req.param("itemId"), 10);

  if (isNaN(itemId)) {
    return c.json({ ok: false, error: "Invalid item ID" }, 400);
  }

  try {
    const reserved = await reserveWishlistItem(telegramId, itemId);
    if (!reserved) {
      const unreserved = await unreserveWishlistItem(telegramId, itemId);
      logApiAction(telegramId, "wishlist_item_unreserve", { itemId });
      return c.json({ ok: true, data: { reserved: false, unreserved } });
    }
    logApiAction(telegramId, "wishlist_item_reserve", { itemId });
    return c.json({ ok: true, data: { reserved: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to toggle reservation";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/items/:itemId", zValidator("param", itemIdParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const itemId = parseInt(c.req.param("itemId"), 10);

  if (isNaN(itemId)) {
    return c.json({ ok: false, error: "Invalid item ID" }, 400);
  }

  try {
    const deleted = await removeWishlistItem(telegramId, itemId);
    logApiAction(telegramId, "wishlist_item_delete", { itemId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete item";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
