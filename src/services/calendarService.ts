/**
 * Calendar business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import { parseEventText } from "../calendar/parse.js";
import {
  createEvent,
  listEvents,
  searchEvents,
  deleteEvent,
  deleteRecurringEvent,
  NoCalendarLinkedError,
  PastDateError,
  type CalendarEvent,
} from "../calendar/client.js";
import { saveCalendarEvent, markEventDeleted } from "../calendar/repository.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { TIMEZONE_MSK } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type { CalendarEventDto, CalendarEventInputMethod } from "../shared/types.js";

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
 * Get today's events.
 */
export async function getEventsToday(userId: string): Promise<CalendarEventDto[]> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const events = await listEvents(start, end, userId);
  return events.map(toDto);
}

/**
 * Get this week's events (next 7 days).
 */
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
 * Cancel a single event by ID.
 */
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

/**
 * Cancel all recurring instances.
 */
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

  // Multiple found
  return {
    cancelled: false,
    multipleFound: events.slice(0, 10).map(toDto),
  };
}

// Re-export errors for convenience
export { NoCalendarLinkedError, PastDateError };
