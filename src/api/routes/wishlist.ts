import { Hono } from "hono";
import {
  getUserWishlists,
  createNewWishlist,
  getWishlistItems,
  addWishlistItem,
  reserveWishlistItem,
  unreserveWishlistItem,
  removeWishlistItem,
} from "../../services/wishlistService.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

/** GET /api/wishlist — list wishlists */
app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const wishlists = await getUserWishlists(telegramId);
    return c.json({ ok: true, data: wishlists });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get wishlists";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/wishlist — create wishlist */
app.post("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ name: string; emoji?: string }>();

  if (!body.name?.trim()) {
    return c.json({ ok: false, error: "name is required" }, 400);
  }

  try {
    const wishlist = await createNewWishlist(telegramId, body.name.trim(), body.emoji);
    return c.json({ ok: true, data: wishlist });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create wishlist";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/wishlist/:id/items — list items */
app.get("/:id/items", async (c) => {
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

/** POST /api/wishlist/:id/items — add item */
app.post("/:id/items", async (c) => {
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
    return c.json({ ok: true, data: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add item";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/wishlist/items/:itemId/reserve — toggle reserve */
app.put("/items/:itemId/reserve", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const itemId = parseInt(c.req.param("itemId"), 10);

  if (isNaN(itemId)) {
    return c.json({ ok: false, error: "Invalid item ID" }, 400);
  }

  try {
    // Try to reserve; if already reserved by this user, unreserve
    const reserved = await reserveWishlistItem(telegramId, itemId);
    if (!reserved) {
      const unreserved = await unreserveWishlistItem(telegramId, itemId);
      return c.json({ ok: true, data: { reserved: false, unreserved } });
    }
    return c.json({ ok: true, data: { reserved: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to toggle reservation";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/wishlist/items/:itemId — delete item */
app.delete("/items/:itemId", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const itemId = parseInt(c.req.param("itemId"), 10);

  if (isNaN(itemId)) {
    return c.json({ ok: false, error: "Invalid item ID" }, 400);
  }

  try {
    const deleted = await removeWishlistItem(telegramId, itemId);
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete item";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
