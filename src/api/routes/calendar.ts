import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
import {
  createEventFromText,
  createEventFromIntent,
  updateEventById,
  getEventsToday,
  getEventsWeek,
  getEventsInRange,
  cancelEventById,
  cancelRecurringEvent,
  searchAndCancelEvent,
  NoCalendarLinkedError,
  PastDateError,
} from "../../services/calendarService.js";
import type { CreateEventRequest } from "../../shared/types.js";
import type { ApiEnv } from "../authMiddleware.js";
import { logApiAction } from "../../logging/actionLogger.js";

const app = new Hono<ApiEnv>();

// Event `:id` params are Google Calendar string IDs (not numeric), so no numeric
// param validation applies here.
const intentEventSchema = z.object({
  title: z.string(),
  startISO: z.string(),
  endISO: z.string(),
  recurrence: z.array(z.string()).optional(),
});
const createEventBody = z.object({
  text: z.string().optional(),
  intent: z
    .object({
      events: z.array(intentEventSchema),
    })
    .optional(),
});
const updateEventBody = z.object({
  title: z.string().min(1),
  startISO: z.string(),
  endISO: z.string(),
});
const searchAndCancelBody = z.object({
  query: z.string(),
});

app.get("/today", async (c) => {
  const initData = c.get("initData");
  const userId = String(initData.user.id);
  try {
    const events = await getEventsToday(userId);
    return c.json({ ok: true, data: events });
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      return c.json({ ok: false, error: err.message, code: "NO_CALENDAR" }, 400);
    }
    const msg = err instanceof Error ? err.message : "Calendar error";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/week", async (c) => {
  const initData = c.get("initData");
  const userId = String(initData.user.id);
  try {
    const events = await getEventsWeek(userId);
    return c.json({ ok: true, data: events });
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      return c.json({ ok: false, error: err.message, code: "NO_CALENDAR" }, 400);
    }
    const msg = err instanceof Error ? err.message : "Calendar error";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/range", async (c) => {
  const initData = c.get("initData");
  const userId = String(initData.user.id);
  const fromRaw = c.req.query("from");
  const days = parseInt(c.req.query("days") ?? "1", 10);
  if (!fromRaw || !Number.isFinite(days) || days < 1 || days > 62) {
    return c.json({ ok: false, error: "from (ISO) and days (1-62) are required" }, 400);
  }
  const from = new Date(fromRaw);
  if (Number.isNaN(from.getTime())) {
    return c.json({ ok: false, error: "invalid from date" }, 400);
  }
  try {
    const events = await getEventsInRange(userId, from, days);
    return c.json({ ok: true, data: events });
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      return c.json({ ok: false, error: err.message, code: "NO_CALENDAR" }, 400);
    }
    const msg = err instanceof Error ? err.message : "Calendar error";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/events", zValidator("json", createEventBody), async (c) => {
  const initData = c.get("initData");
  const userId = String(initData.user.id);
  const telegramId = initData.user.id;
  const body = await c.req.json<CreateEventRequest>();

  if (body.intent?.events?.length) {
    try {
      const results = await createEventFromIntent(userId, telegramId, body.intent.events);
      if (results.length === 0) {
        return c.json({ ok: false, error: "Не удалось создать событие из распознанных данных." }, 400);
      }
      // Return first event for backward compatibility with CreateEventResponse
      logApiAction(telegramId, "calendar_event_create", { source: "intent", count: results.length });
      return c.json({ ok: true, data: results[0] });
    } catch (err) {
      if (err instanceof NoCalendarLinkedError) {
        return c.json({ ok: false, error: err.message, code: "NO_CALENDAR" }, 400);
      }
      if (err instanceof PastDateError) {
        return c.json({ ok: false, error: err.message, code: "PAST_DATE" }, 400);
      }
      const msg = err instanceof Error ? err.message : "Failed to create event";
      return c.json({ ok: false, error: msg }, 500);
    }
  }

  if (!body.text?.trim()) {
    return c.json({ ok: false, error: "text or intent is required" }, 400);
  }

  try {
    const result = await createEventFromText(userId, telegramId, body.text.trim());
    logApiAction(telegramId, "calendar_event_create", { source: "text" });
    return c.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      return c.json({ ok: false, error: err.message, code: "NO_CALENDAR" }, 400);
    }
    if (err instanceof PastDateError) {
      return c.json({ ok: false, error: err.message, code: "PAST_DATE" }, 400);
    }
    const msg = err instanceof Error ? err.message : "Failed to create event";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/events/:id", zValidator("json", updateEventBody), async (c) => {
  const initData = c.get("initData");
  const userId = String(initData.user.id);
  const telegramId = initData.user.id;
  const eventId = c.req.param("id");
  const body = await c.req.json<{ title: string; startISO: string; endISO: string }>();

  const title = body.title.trim();
  if (!title) {
    return c.json({ ok: false, error: "title is required" }, 400);
  }

  try {
    const result = await updateEventById(userId, telegramId, eventId, title, body.startISO, body.endISO);
    logApiAction(telegramId, "calendar_event_update", { eventId });
    return c.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      return c.json({ ok: false, error: err.message, code: "NO_CALENDAR" }, 400);
    }
    const msg = err instanceof Error ? err.message : "Failed to update event";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/events/:id", async (c) => {
  const initData = c.get("initData");
  const userId = String(initData.user.id);
  const telegramId = initData.user.id;
  const eventId = c.req.param("id");

  try {
    await cancelEventById(userId, telegramId, eventId);
    logApiAction(telegramId, "calendar_event_cancel", { eventId });
    return c.json({ ok: true, data: { cancelled: true } });
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      return c.json({ ok: false, error: err.message, code: "NO_CALENDAR" }, 400);
    }
    const msg = err instanceof Error ? err.message : "Failed to cancel event";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/recurring/:recurringEventId", async (c) => {
  const initData = c.get("initData");
  const userId = String(initData.user.id);
  const recurringEventId = c.req.param("recurringEventId");

  try {
    await cancelRecurringEvent(userId, recurringEventId);
    logApiAction(initData.user.id, "calendar_event_cancel", { recurringEventId });
    return c.json({ ok: true, data: { cancelled: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to cancel recurring event";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/search-and-cancel", zValidator("json", searchAndCancelBody), async (c) => {
  const initData = c.get("initData");
  const userId = String(initData.user.id);
  const telegramId = initData.user.id;
  const body = await c.req.json<{ query: string }>();

  if (!body.query?.trim()) {
    return c.json({ ok: false, error: "query is required" }, 400);
  }

  try {
    const result = await searchAndCancelEvent(userId, telegramId, body.query.trim());
    logApiAction(telegramId, "calendar_event_cancel", { source: "search", query: body.query.trim() });
    return c.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      return c.json({ ok: false, error: err.message, code: "NO_CALENDAR" }, 400);
    }
    const msg = err instanceof Error ? err.message : "Search error";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
