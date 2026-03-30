import { google } from "googleapis";
import { getAuthClient } from "./auth.js";

export { NoCalendarLinkedError } from "./auth.js";

const CALENDAR_ID = "primary";

/**
 * Format Date as Moscow-local ISO 8601 string with explicit +03:00 offset.
 * Example: "2026-03-31T15:00:00+03:00"
 *
 * This avoids ambiguity when Google Calendar API receives both a UTC "Z" dateTime
 * and a timeZone field — with explicit offset the time is always unambiguous.
 */
function formatDateTimeMsk(date: Date): string {
  return date.toLocaleString("sv-SE", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).replace(" ", "T") + "+03:00";
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink?: string;
  recurringEventId?: string;
}

/** Thrown when event start is in the past. */
export class PastDateError extends Error {
  constructor() {
    super("Нельзя создать встречу в прошлом. Укажите дату и время в будущем.");
    this.name = "PastDateError";
  }
}

export async function createEvent(
  summary: string,
  start: Date,
  end: Date,
  userId: string,
  description?: string,
  recurrence?: string[]
): Promise<CalendarEvent> {
  const now = new Date();
  const bufferMs = 60 * 1000; // 1 minute
  if (start.getTime() < now.getTime() - bufferMs) {
    throw new PastDateError();
  }
  const auth = await getAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  const requestBody: {
    summary: string;
    description?: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    recurrence?: string[];
  } = {
    summary,
    description: description ?? undefined,
    start: { dateTime: formatDateTimeMsk(start), timeZone: "Europe/Moscow" },
    end: { dateTime: formatDateTimeMsk(end), timeZone: "Europe/Moscow" },
  };
  if (recurrence?.length) {
    requestBody.recurrence = recurrence;
  }
  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody,
  });
  const e = res.data;
  if (!e.id || !e.summary || !e.start?.dateTime || !e.end?.dateTime) {
    throw new Error("Invalid event response");
  }
  return {
    id: e.id,
    summary: e.summary,
    start: e.start.dateTime,
    end: e.end.dateTime,
    htmlLink: e.htmlLink ?? undefined,
  };
}

export async function deleteEvent(
  eventId: string,
  userId: string
): Promise<void> {
  const auth = await getAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({
    calendarId: CALENDAR_ID,
    eventId,
  });
}

export async function searchEvents(
  query: string,
  timeMin: Date,
  timeMax: Date,
  userId: string
): Promise<CalendarEvent[]> {
  const auth = await getAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: formatDateTimeMsk(timeMin),
    timeMax: formatDateTimeMsk(timeMax),
    singleEvents: true,
    orderBy: "startTime",
    q: query || undefined,
  });
  const items = res.data.items ?? [];
  return items
    .filter(
      (e): e is typeof e & { id: string; summary: string; start: { dateTime: string }; end: { dateTime: string } } =>
        !!e.id && !!e.summary && !!e.start?.dateTime && !!e.end?.dateTime
    )
    .map((e) => ({
      id: e.id,
      summary: e.summary,
      start: e.start.dateTime,
      end: e.end.dateTime,
      htmlLink: e.htmlLink ?? undefined,
      recurringEventId: e.recurringEventId ?? undefined,
    }));
}

/** Delete all instances of a recurring event (by its series ID). */
export async function deleteRecurringEvent(
  recurringEventId: string,
  userId: string
): Promise<void> {
  const auth = await getAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({
    calendarId: CALENDAR_ID,
    eventId: recurringEventId,
  });
}

export async function listEvents(
  timeMin: Date,
  timeMax: Date,
  userId: string
): Promise<CalendarEvent[]> {
  const auth = await getAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: formatDateTimeMsk(timeMin),
    timeMax: formatDateTimeMsk(timeMax),
    singleEvents: true,
    orderBy: "startTime",
  });
  const items = res.data.items ?? [];
  return items
    .filter(
      (e): e is typeof e & { id: string; summary: string; start: { dateTime: string }; end: { dateTime: string } } =>
        !!e.id && !!e.summary && !!e.start?.dateTime && !!e.end?.dateTime
    )
    .map((e) => ({
      id: e.id,
      summary: e.summary,
      start: e.start.dateTime,
      end: e.end.dateTime,
      htmlLink: e.htmlLink ?? undefined,
    }));
}
