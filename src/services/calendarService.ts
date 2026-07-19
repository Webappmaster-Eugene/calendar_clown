/**
 * Calendar business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import { parseEventText } from "../calendar/parse.js";
import {
  createEvent,
  updateEvent,
  listEvents,
  searchEvents,
  deleteEvent,
  deleteRecurringEvent,
  NoCalendarLinkedError,
  PastDateError,
  type CalendarEvent,
} from "../calendar/client.js";
import { saveCalendarEvent, markEventDeleted, markEventUpdated } from "../calendar/repository.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { TIMEZONE_MSK } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import { escapeMarkdown } from "../utils/markdown.js";
import type { CalendarEventDto, CalendarEventInputMethod, CalendarIntentEvent } from "../shared/types.js";

const log = createLogger("calendar-service");

// ─── Types ────────────────────────────────────────────────────

export interface CreateEventResult {
  event: CalendarEventDto;
  savedToDb: boolean;
}

export interface CancelResult {
  cancelled: boolean;
  event?: CalendarEventDto;
  multipleFound?: CalendarEventDto[];
  isRecurring?: boolean;
  recurringEventId?: string;
}

// ─── Helpers ──────────────────────────────────────────────────

function toDto(e: CalendarEvent): CalendarEventDto {
  return {
    id: e.id,
    summary: e.summary,
    start: e.start,
    end: e.end,
    htmlLink: e.htmlLink,
    recurringEventId: e.recurringEventId,
  };
}

async function getDbUser(telegramId: number): Promise<{ id: number; tribeId: number | null } | null> {
  if (!isDatabaseAvailable()) return null;
  return getUserByTelegramId(telegramId);
}

async function saveEventToDb(
  telegramId: number,
  params: {
    googleEventId: string | null;
    summary: string;
    startTime: Date;
    endTime: Date;
    recurrence?: string[] | null;
    inputMethod: CalendarEventInputMethod;
    status: "created" | "failed";
    errorMessage?: string;
    htmlLink?: string | null;
  }
): Promise<boolean> {
  try {
    const dbUser = await getDbUser(telegramId);
    if (!dbUser) return false;
    await saveCalendarEvent({
      userId: dbUser.id,
      tribeId: dbUser.tribeId,
      googleEventId: params.googleEventId,
      summary: params.summary,
      startTime: params.startTime,
      endTime: params.endTime,
      recurrence: params.recurrence ?? null,
      inputMethod: params.inputMethod,
      status: params.status,
      errorMessage: params.errorMessage ?? null,
      htmlLink: params.htmlLink ?? null,
    });
    return true;
  } catch (err) {
    log.error("Failed to save calendar event to DB:", err);
    return false;
  }
}

// ─── Service Functions ────────────────────────────────────────

/**
 * Create event from natural language text.
 * @param userId - Google Calendar userId (telegram_id as string)
 * @param telegramId - Numeric telegram ID for DB operations
 * @param text - Natural language text like "Встреча завтра в 15:00"
 */
export async function createEventFromText(
  userId: string,
  telegramId: number,
  text: string
): Promise<CreateEventResult> {
  const parsed = parseEventText(text);
  if (!parsed) {
    throw new Error("Не удалось разобрать дату и время. Попробуйте: «завтра в 15:00», «в понедельник 10:00».");
  }

  const event = await createEvent(parsed.title, parsed.start, parsed.end, userId);
  const savedToDb = await saveEventToDb(telegramId, {
    googleEventId: event.id ?? null,
    summary: event.summary,
    startTime: new Date(event.start),
    endTime: new Date(event.end),
    inputMethod: "text",
    status: "created",
    htmlLink: event.htmlLink ?? null,
  });

  return { event: toDto(event), savedToDb };
}

/**
 * Create events from pre-extracted LLM intent data (voice input).
 * Bypasses chrono-node parsing — dates come directly from the LLM as ISO strings with +03:00 offset.
 */
export async function createEventFromIntent(
  userId: string,
  telegramId: number,
  intentEvents: CalendarIntentEvent[]
): Promise<CreateEventResult[]> {
  const results: CreateEventResult[] = [];

  for (const ev of intentEvents) {
    const start = new Date(ev.startISO);
    const end = new Date(ev.endISO);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      log.error("Invalid ISO dates in intent event: start=%s, end=%s", ev.startISO, ev.endISO);
      continue;
    }

    try {
      const event = await createEvent(ev.title, start, end, userId, undefined, ev.recurrence);
      const savedToDb = await saveEventToDb(telegramId, {
        googleEventId: event.id ?? null,
        summary: event.summary,
        startTime: new Date(event.start),
        endTime: new Date(event.end),
        recurrence: ev.recurrence ?? null,
        inputMethod: "voice",
        status: "created",
        htmlLink: event.htmlLink ?? null,
      });

      results.push({ event: toDto(event), savedToDb });
    } catch (err) {
      log.error("Failed to create event from intent \"%s\":", ev.title, err);
      // Re-throw PastDateError and NoCalendarLinkedError for the route to handle
      if (err instanceof PastDateError || err instanceof NoCalendarLinkedError) throw err;
    }
  }

  return results;
}

/**
 * Update an existing single event's title and time range.
 * Recurring series are out of scope — this edits the addressed event/instance only.
 * @param userId - Google Calendar userId (telegram_id as string)
 * @param telegramId - Numeric telegram ID for DB operations
 */
export async function updateEventById(
  userId: string,
  telegramId: number,
  eventId: string,
  title: string,
  startISO: string,
  endISO: string,
): Promise<CreateEventResult> {
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Некорректная дата или время события.");
  }
  if (end.getTime() <= start.getTime()) {
    throw new Error("Время окончания должно быть позже времени начала.");
  }

  const event = await updateEvent(eventId, title, start, end, userId);
  log.info(`Event updated: id=${eventId}, by user ${userId}`);

  let savedToDb = false;
  const dbUser = await getDbUser(telegramId);
  if (dbUser) {
    try {
      savedToDb = await markEventUpdated(event.id, dbUser.id, {
        summary: event.summary,
        startTime: new Date(event.start),
        endTime: new Date(event.end),
      });
    } catch (err) {
      log.error("Failed to update calendar event in DB:", err);
    }
  }

  return { event: toDto(event), savedToDb };
}

export async function getEventsToday(userId: string): Promise<CalendarEventDto[]> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const events = await listEvents(start, end, userId);
  return events.map(toDto);
}

export async function getEventsWeek(userId: string): Promise<CalendarEventDto[]> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const events = await listEvents(start, end, userId);
  return events.map(toDto);
}

/**
 * Events for an arbitrary [from, from + days) window. Powers the Mini App voice
 * "покажи расписание" flow: `from` is the start-of-day instant already resolved by
 * the LLM intent (list_range), so it is used as-is rather than re-snapped to a
 * server-local midnight (which would be the wrong timezone).
 */
export async function getEventsInRange(userId: string, from: Date, days: number): Promise<CalendarEventDto[]> {
  const start = new Date(from);
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  const events = await listEvents(start, end, userId);
  return events.map(toDto);
}

export interface EventRangeView {
  isEmpty: boolean;
  /** Plain-text reply for an empty range. */
  emptyText: string;
  /** Markdown reply (header + grouped lines) when the range has events. */
  text: string;
}

const HH_MM: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE_MSK };

/**
 * Fetch and render calendar events for an arbitrary [from, from + days) range as a
 * ready-to-send message. Single-day ranges render a flat list; multi-day ranges group
 * by day. Shared by the text and voice calendar handlers.
 */
export async function formatEventRange(
  userId: string,
  from: Date,
  days: number,
  label: string,
): Promise<EventRangeView> {
  const timeMin = from;
  const timeMax = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  const events = await listEvents(timeMin, timeMax, userId);

  if (events.length === 0) {
    return { isEmpty: true, emptyText: `${label}: встреч нет.`, text: "" };
  }

  const header = `📅 *${escapeMarkdown(label)}:*`;

  if (days === 1) {
    const lines = events.map((e) => {
      const s = new Date(e.start);
      const en = new Date(e.end);
      return `• ${escapeMarkdown(e.summary)} (${s.toLocaleTimeString("ru-RU", HH_MM)} – ${en.toLocaleTimeString("ru-RU", HH_MM)})`;
    });
    return { isEmpty: false, emptyText: "", text: header + "\n" + lines.join("\n") };
  }

  const lines: string[] = [];
  let currentDay = "";
  for (const e of events) {
    const s = new Date(e.start);
    const dayKey = s.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: TIMEZONE_MSK });
    if (dayKey !== currentDay) {
      currentDay = dayKey;
      lines.push(`\n*${escapeMarkdown(dayKey)}*`);
    }
    const en = new Date(e.end);
    lines.push(`• ${escapeMarkdown(e.summary)} (${s.toLocaleTimeString("ru-RU", HH_MM)} – ${en.toLocaleTimeString("ru-RU", HH_MM)})`);
  }
  return { isEmpty: false, emptyText: "", text: header + lines.join("\n") };
}

export async function cancelEventById(
  userId: string,
  telegramId: number,
  eventId: string
): Promise<void> {
  await deleteEvent(eventId, userId);
  log.info(`Event deleted: id=${eventId}, by user ${userId}`);

  const dbUser = await getDbUser(telegramId);
  if (dbUser) {
    try {
      await markEventDeleted(eventId, dbUser.id);
    } catch (err) {
      log.error("Failed to mark event as deleted in DB:", err);
    }
  }
}

export async function cancelRecurringEvent(
  userId: string,
  recurringEventId: string
): Promise<void> {
  await deleteRecurringEvent(recurringEventId, userId);
  log.info(`All recurring instances deleted: recurringId=${recurringEventId}, by user ${userId}`);
}

/**
 * Search and cancel events by query text.
 * Returns cancel result with found events info.
 */
export async function searchAndCancelEvent(
  userId: string,
  telegramId: number,
  queryText: string,
  dateRange?: { start: Date; end: Date }
): Promise<CancelResult> {
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
  const timeMin = dateRange?.start ?? new Date(todayStr + "T00:00:00+03:00");
  const timeMax = dateRange?.end ?? new Date(timeMin.getTime() + 7 * 24 * 60 * 60 * 1000);

  const events = await searchEvents(queryText, timeMin, timeMax, userId);

  if (events.length === 0) {
    return { cancelled: false };
  }

  if (events.length === 1) {
    const ev = events[0];

    if (ev.recurringEventId) {
      return {
        cancelled: false,
        event: toDto(ev),
        isRecurring: true,
        recurringEventId: ev.recurringEventId,
      };
    }

    await cancelEventById(userId, telegramId, ev.id);
    return { cancelled: true, event: toDto(ev) };
  }

  return {
    cancelled: false,
    multipleFound: events.slice(0, 10).map(toDto),
  };
}

export { NoCalendarLinkedError, PastDateError };
