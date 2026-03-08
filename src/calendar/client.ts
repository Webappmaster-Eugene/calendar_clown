import { google } from "googleapis";
import { getAuthClient } from "./auth.js";

const CALENDAR_ID = "primary";

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink?: string;
}

export async function createEvent(
  summary: string,
  start: Date,
  end: Date,
  description?: string
): Promise<CalendarEvent> {
  const auth = await getAuthClient();
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary,
      description: description ?? undefined,
      start: { dateTime: start.toISOString(), timeZone: "Europe/Moscow" },
      end: { dateTime: end.toISOString(), timeZone: "Europe/Moscow" },
    },
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

export async function listEvents(
  timeMin: Date,
  timeMax: Date
): Promise<CalendarEvent[]> {
  const auth = await getAuthClient();
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
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
