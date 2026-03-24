import { Hono } from "hono";
import {
  createEventFromText,
  getEventsToday,
  getEventsWeek,
  cancelEventById,
  cancelRecurringEvent,
  searchAndCancelEvent,
  NoCalendarLinkedError,
  PastDateError,
} from "../../services/calendarService.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

/** GET /api/calendar/today */
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

/** GET /api/calendar/week */
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

/** POST /api/calendar/events — create event from text */
app.post("/events", async (c) => {
  const initData = c.get("initData");
  const userId = String(initData.user.id);
  const telegramId = initData.user.id;
  const body = await c.req.json<{ text: string }>();

  if (!body.text?.trim()) {
    return c.json({ ok: false, error: "text is required" }, 400);
  }

  try {
    const result = await createEventFromText(userId, telegramId, body.text.trim());
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

/** DELETE /api/calendar/events/:id — cancel single event */
app.delete("/events/:id", async (c) => {
  const initData = c.get("initData");
  const userId = String(initData.user.id);
  const telegramId = initData.user.id;
  const eventId = c.req.param("id");

  try {
    await cancelEventById(userId, telegramId, eventId);
    return c.json({ ok: true, data: { cancelled: true } });
  } catch (err) {
    if (err instanceof NoCalendarLinkedError) {
      return c.json({ ok: false, error: err.message, code: "NO_CALENDAR" }, 400);
    }
    const msg = err instanceof Error ? err.message : "Failed to cancel event";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/calendar/recurring/:recurringEventId — cancel all recurring */
app.delete("/recurring/:recurringEventId", async (c) => {
  const initData = c.get("initData");
  const userId = String(initData.user.id);
  const recurringEventId = c.req.param("recurringEventId");

  try {
    await cancelRecurringEvent(userId, recurringEventId);
    return c.json({ ok: true, data: { cancelled: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to cancel recurring event";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/calendar/search-and-cancel — search by query, cancel if single match */
app.post("/search-and-cancel", async (c) => {
  const initData = c.get("initData");
  const userId = String(initData.user.id);
  const telegramId = initData.user.id;
  const body = await c.req.json<{ query: string }>();

  if (!body.query?.trim()) {
    return c.json({ ok: false, error: "query is required" }, 400);
  }

  try {
    const result = await searchAndCancelEvent(userId, telegramId, body.query.trim());
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
