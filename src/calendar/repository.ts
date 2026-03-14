import { query } from "../db/connection.js";
import type { CalendarEventRecord, CreateCalendarEventParams } from "./types.js";

/** Insert a calendar event record into the database. */
export async function saveCalendarEvent(params: CreateCalendarEventParams): Promise<CalendarEventRecord> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    tribe_id: number;
    google_event_id: string | null;
    summary: string;
    description: string | null;
    start_time: Date;
    end_time: Date;
    recurrence: string[] | null;
    input_method: string;
    status: string;
    error_message: string | null;
    html_link: string | null;
    created_at: Date;
    updated_at: Date | null;
    deleted_at: Date | null;
  }>(
    `INSERT INTO calendar_events
       (user_id, tribe_id, google_event_id, summary, description, start_time, end_time, recurrence, input_method, status, error_message, html_link)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      params.userId,
      params.tribeId,
      params.googleEventId,
      params.summary,
      params.description ?? null,
      params.startTime,
      params.endTime,
      params.recurrence ?? null,
      params.inputMethod,
      params.status,
      params.errorMessage ?? null,
      params.htmlLink ?? null,
    ]
  );

  const r = rows[0];
  return mapRow(r);
}

/** Mark a calendar event as deleted by its Google Event ID. Returns true if a row was updated. */
export async function markEventDeleted(googleEventId: string, userId: number): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE calendar_events
     SET status = 'deleted', deleted_at = now(), updated_at = now()
     WHERE google_event_id = $1 AND user_id = $2 AND status = 'created'`,
    [googleEventId, userId]
  );
  return (rowCount ?? 0) > 0;
}

/** Get calendar events for a user within a date range. */
export async function getEventsByUser(
  userId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<CalendarEventRecord[]> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    tribe_id: number;
    google_event_id: string | null;
    summary: string;
    description: string | null;
    start_time: Date;
    end_time: Date;
    recurrence: string[] | null;
    input_method: string;
    status: string;
    error_message: string | null;
    html_link: string | null;
    created_at: Date;
    updated_at: Date | null;
    deleted_at: Date | null;
  }>(
    `SELECT * FROM calendar_events
     WHERE user_id = $1 AND start_time >= $2 AND start_time < $3
     ORDER BY start_time`,
    [userId, dateFrom.toISOString(), dateTo.toISOString()]
  );

  return rows.map(mapRow);
}

function mapRow(r: {
  id: number;
  user_id: number;
  tribe_id: number;
  google_event_id: string | null;
  summary: string;
  description: string | null;
  start_time: Date;
  end_time: Date;
  recurrence: string[] | null;
  input_method: string;
  status: string;
  error_message: string | null;
  html_link: string | null;
  created_at: Date;
  updated_at: Date | null;
  deleted_at: Date | null;
}): CalendarEventRecord {
  return {
    id: r.id,
    userId: r.user_id,
    tribeId: r.tribe_id,
    googleEventId: r.google_event_id,
    summary: r.summary,
    description: r.description,
    startTime: r.start_time,
    endTime: r.end_time,
    recurrence: r.recurrence,
    inputMethod: r.input_method as CalendarEventRecord["inputMethod"],
    status: r.status as CalendarEventRecord["status"],
    errorMessage: r.error_message,
    htmlLink: r.html_link,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}
