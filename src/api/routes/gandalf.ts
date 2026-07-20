import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
import {
  getCategories,
  addCategory,
  removeCategory,
  editCategory,
  getEntriesForCategory,
  getAllEntries,
  addEntry,
  removeEntry,
  editEntry,
  getStats,
} from "../../services/gandalfService.js";
import { logApiAction } from "../../logging/actionLogger.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

const idParam = z.object({ id: z.coerce.number().int().positive() });
const createCategoryBody = z.object({
  name: z.string(),
  emoji: z.string().optional(),
});
const updateCategoryBody = z.object({
  name: z.string().optional(),
  emoji: z.string().optional(),
});
const createEntryBody = z.object({
  categoryId: z.number(),
  title: z.string(),
  price: z.number().nullable().optional(),
  nextDate: z.string().nullable().optional(),
  additionalInfo: z.string().nullable().optional(),
  isImportant: z.boolean().optional(),
  isUrgent: z.boolean().optional(),
  visibility: z.enum(["tribe", "private"]).optional(),
});
const updateEntryBody = z.object({
  title: z.string().optional(),
  price: z.number().nullable().optional(),
  nextDate: z.string().nullable().optional(),
  additionalInfo: z.string().nullable().optional(),
  isImportant: z.boolean().optional(),
  isUrgent: z.boolean().optional(),
  visibility: z.enum(["tribe", "private"]).optional(),
  categoryId: z.number().optional(),
});

app.get("/categories", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const categories = await getCategories(telegramId);
    return c.json({ ok: true, data: categories });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get categories";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/categories", zValidator("json", createCategoryBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ name: string; emoji?: string }>();

  if (!body.name?.trim()) {
    return c.json({ ok: false, error: "name is required" }, 400);
  }

  try {
    const category = await addCategory(telegramId, body.name.trim(), body.emoji);
    logApiAction(telegramId, "gandalf_category_create", { name: body.name.trim() });
    return c.json({ ok: true, data: category });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create category";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/categories/:id", zValidator("param", idParam), zValidator("json", updateCategoryBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const categoryId = parseInt(c.req.param("id"), 10);

  if (isNaN(categoryId)) {
    return c.json({ ok: false, error: "Invalid category ID" }, 400);
  }

  const body = await c.req.json<{ name?: string; emoji?: string }>();

  if (!body.name?.trim() && !body.emoji?.trim()) {
    return c.json({ ok: false, error: "At least one field (name or emoji) is required" }, 400);
  }

  try {
    const updates: { name?: string; emoji?: string } = {};
    if (body.name?.trim()) updates.name = body.name.trim();
    if (body.emoji?.trim()) updates.emoji = body.emoji.trim();

    const result = await editCategory(telegramId, categoryId, updates);
    if (!result) {
      return c.json({ ok: false, error: "Category not found" }, 404);
    }
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update category";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/categories/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const categoryId = parseInt(c.req.param("id"), 10);

  if (isNaN(categoryId)) {
    return c.json({ ok: false, error: "Invalid category ID" }, 400);
  }

  try {
    const deleted = await removeCategory(telegramId, categoryId);
    logApiAction(telegramId, "gandalf_category_delete", { categoryId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete category";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/categories/:id/entries", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const categoryId = parseInt(c.req.param("id"), 10);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  if (isNaN(categoryId)) {
    return c.json({ ok: false, error: "Invalid category ID" }, 400);
  }

  try {
    const result = await getEntriesForCategory(telegramId, categoryId, limit, offset);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get entries";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/entries", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  const categoryId = c.req.query("categoryId");
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    const result = categoryId
      ? await getEntriesForCategory(telegramId, parseInt(categoryId, 10), limit, offset)
      : await getAllEntries(telegramId, limit, offset);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get entries";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/entries", zValidator("json", createEntryBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{
    categoryId: number;
    title: string;
    price?: number | null;
    nextDate?: string | null;
    additionalInfo?: string | null;
    isImportant?: boolean;
    isUrgent?: boolean;
    visibility?: "tribe" | "private";
  }>();

  if (!body.categoryId || !body.title?.trim()) {
    return c.json({ ok: false, error: "categoryId and title are required" }, 400);
  }

  try {
    const entry = await addEntry(telegramId, {
      categoryId: body.categoryId,
      title: body.title.trim(),
      price: body.price,
      nextDate: body.nextDate,
      additionalInfo: body.additionalInfo,
      isImportant: body.isImportant,
      isUrgent: body.isUrgent,
      visibility: body.visibility,
    });
    logApiAction(telegramId, "gandalf_entry_create", { categoryId: body.categoryId, title: body.title.trim() });
    return c.json({ ok: true, data: entry });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create entry";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/entries/:id", zValidator("param", idParam), zValidator("json", updateEntryBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const entryId = parseInt(c.req.param("id"), 10);

  if (isNaN(entryId)) {
    return c.json({ ok: false, error: "Invalid entry ID" }, 400);
  }

  const body = await c.req.json<{
    title?: string;
    price?: number | null;
    nextDate?: string | null;
    additionalInfo?: string | null;
    isImportant?: boolean;
    isUrgent?: boolean;
    visibility?: "tribe" | "private";
    categoryId?: number;
  }>();

  try {
    const result = await editEntry(telegramId, entryId, body);
    if (!result) {
      return c.json({ ok: false, error: "Entry not found" }, 404);
    }
    logApiAction(telegramId, "gandalf_entry_edit", { entryId });
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update entry";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/entries/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const entryId = parseInt(c.req.param("id"), 10);

  if (isNaN(entryId)) {
    return c.json({ ok: false, error: "Invalid entry ID" }, 400);
  }

  try {
    const deleted = await removeEntry(telegramId, entryId);
    logApiAction(telegramId, "gandalf_entry_delete", { entryId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete entry";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/stats", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const stats = await getStats(telegramId);
    return c.json({ ok: true, data: stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get stats";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
