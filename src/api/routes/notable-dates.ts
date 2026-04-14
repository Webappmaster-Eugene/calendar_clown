import { Hono } from "hono";
import {
  getDatesPaginated,
  getUpcoming,
  getAllDates,
  createDate,
  editDate,
  removeDate,
  togglePriority,
  importDatesFromCsv,
} from "../../services/notableDatesService.js";
import type { ApiEnv } from "../authMiddleware.js";
import { logApiAction } from "../../logging/actionLogger.js";

const app = new Hono<ApiEnv>();

/** GET /api/notable-dates — list dates (paginated, with optional filter) */
app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const filter = c.req.query("filter");

  try {
    if (filter === "week") {
      const dates = await getUpcoming(telegramId, 7);
      return c.json({ ok: true, data: { dates, total: dates.length } });
    }
    if (filter === "month") {
      const currentMonth = new Date().getMonth() + 1;
      const dates = await getAllDates(telegramId, currentMonth);
      return c.json({ ok: true, data: { dates, total: dates.length } });
    }

    const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "10", 10) || 10, 1), 100);
    const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
    const result = await getDatesPaginated(telegramId, limit, offset);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get dates";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/notable-dates/upcoming — upcoming dates */
app.get("/upcoming", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const dates = await getUpcoming(telegramId);
    return c.json({ ok: true, data: dates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get upcoming dates";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/notable-dates — create date */
app.post("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{
    name: string;
    dateMonth: number;
    dateDay: number;
    eventType?: string;
    description?: string;
    emoji?: string;
    isPriority?: boolean;
  }>();

  if (!body.name?.trim() || !body.dateMonth || !body.dateDay) {
    return c.json({ ok: false, error: "name, dateMonth, and dateDay are required" }, 400);
  }

  try {
    const date = await createDate(telegramId, {
      name: body.name.trim(),
      dateMonth: body.dateMonth,
      dateDay: body.dateDay,
      eventType: body.eventType,
      description: body.description,
      emoji: body.emoji,
      isPriority: body.isPriority,
    });
    logApiAction(telegramId, "notable_date_add", { name: body.name.trim(), dateMonth: body.dateMonth, dateDay: body.dateDay });
    return c.json({ ok: true, data: date });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create date";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/notable-dates/:id/toggle — toggle priority */
app.put("/:id/toggle", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const dateId = parseInt(c.req.param("id"), 10);

  if (isNaN(dateId)) {
    return c.json({ ok: false, error: "Invalid date ID" }, 400);
  }

  try {
    const toggled = await togglePriority(telegramId, dateId);
    if (!toggled) {
      return c.json({ ok: false, error: "Date not found" }, 404);
    }
    logApiAction(telegramId, "notable_date_toggle_priority", { dateId });
    return c.json({ ok: true, data: { toggled } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to toggle priority";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/notable-dates/:id — update date */
app.put("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const dateId = parseInt(c.req.param("id"), 10);

  if (isNaN(dateId)) {
    return c.json({ ok: false, error: "Invalid date ID" }, 400);
  }

  const body = await c.req.json<{
    name?: string;
    dateMonth?: number;
    dateDay?: number;
    description?: string | null;
    eventType?: string;
    emoji?: string;
    isPriority?: boolean;
  }>();

  try {
    const updated = await editDate(telegramId, dateId, body);
    if (!updated) {
      return c.json({ ok: false, error: "Date not found" }, 404);
    }
    logApiAction(telegramId, "notable_date_edit", { dateId });
    return c.json({ ok: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update date";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/notable-dates/:id — delete date */
app.delete("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const dateId = parseInt(c.req.param("id"), 10);

  if (isNaN(dateId)) {
    return c.json({ ok: false, error: "Invalid date ID" }, 400);
  }

  try {
    const deleted = await removeDate(telegramId, dateId);
    logApiAction(telegramId, "notable_date_delete", { dateId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete date";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/notable-dates/import — import dates from CSV file */
app.post("/import", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || !(file instanceof File)) {
    return c.json({ ok: false, error: "CSV file is required" }, 400);
  }

  try {
    const csvContent = await file.text();
    const result = await importDatesFromCsv(telegramId, csvContent);
    logApiAction(telegramId, "notable_dates_csv_import", { imported: result.imported, skipped: result.skipped });
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to import CSV";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
