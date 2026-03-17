import { query } from "../db/connection.js";

export interface NotableDate {
  id: number;
  tribeId: number;
  addedByUserId: number | null;
  name: string;
  dateMonth: number;
  dateDay: number;
  eventType: string;
  description: string | null;
  greetingTemplate: string | null;
  emoji: string;
  isPriority: boolean;
  isActive: boolean;
  createdAt: Date;
}

interface AddNotableDateParams {
  tribeId: number;
  addedByUserId: number | null;
  name: string;
  dateMonth: number;
  dateDay: number;
  eventType?: string;
  description?: string | null;
  greetingTemplate?: string | null;
  emoji?: string;
  isPriority?: boolean;
}

/** Get notable dates for a specific day. */
export async function getDatesByMonthDay(
  tribeId: number,
  month: number,
  day: number
): Promise<NotableDate[]> {
  const { rows } = await query<{
    id: number;
    tribe_id: number;
    added_by_user_id: number | null;
    name: string;
    date_month: number;
    date_day: number;
    event_type: string;
    description: string | null;
    greeting_template: string | null;
    emoji: string;
    is_priority: boolean;
    is_active: boolean;
    created_at: Date;
  }>(
    `SELECT id, tribe_id, added_by_user_id, name, date_month, date_day,
            event_type, description, greeting_template, emoji, is_priority, is_active, created_at
     FROM notable_dates
     WHERE tribe_id = $1 AND date_month = $2 AND date_day = $3 AND is_active = true
     ORDER BY event_type, name`,
    [tribeId, month, day]
  );
  return rows.map(mapRow);
}

/** Add a notable date. */
export async function addNotableDate(params: AddNotableDateParams): Promise<NotableDate> {
  const { rows } = await query<{
    id: number;
    tribe_id: number;
    added_by_user_id: number | null;
    name: string;
    date_month: number;
    date_day: number;
    event_type: string;
    description: string | null;
    greeting_template: string | null;
    emoji: string;
    is_priority: boolean;
    is_active: boolean;
    created_at: Date;
  }>(
    `INSERT INTO notable_dates (tribe_id, added_by_user_id, name, date_month, date_day, event_type, description, greeting_template, emoji, is_priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, tribe_id, added_by_user_id, name, date_month, date_day,
               event_type, description, greeting_template, emoji, is_priority, is_active, created_at`,
    [
      params.tribeId,
      params.addedByUserId,
      params.name,
      params.dateMonth,
      params.dateDay,
      params.eventType ?? "birthday",
      params.description ?? null,
      params.greetingTemplate ?? null,
      params.emoji ?? "🎂",
      params.isPriority ?? false,
    ]
  );
  return mapRow(rows[0]);
}

/** Toggle is_priority flag on a notable date. */
export async function toggleNotableDatePriority(id: number, tribeId: number): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE notable_dates SET is_priority = NOT is_priority, updated_at = NOW() WHERE id = $1 AND tribe_id = $2",
    [id, tribeId]
  );
  return (rowCount ?? 0) > 0;
}

/** Get a notable date by id. */
export async function getNotableDateById(id: number, tribeId: number): Promise<NotableDate | null> {
  const { rows } = await query<{
    id: number;
    tribe_id: number;
    added_by_user_id: number | null;
    name: string;
    date_month: number;
    date_day: number;
    event_type: string;
    description: string | null;
    greeting_template: string | null;
    emoji: string;
    is_priority: boolean;
    is_active: boolean;
    created_at: Date;
  }>(
    `SELECT id, tribe_id, added_by_user_id, name, date_month, date_day,
            event_type, description, greeting_template, emoji, is_priority, is_active, created_at
     FROM notable_dates
     WHERE id = $1 AND tribe_id = $2`,
    [id, tribeId]
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

/** Update specific fields of a notable date. */
export async function updateNotableDate(
  id: number,
  tribeId: number,
  fields: Partial<{ name: string; dateMonth: number; dateDay: number; description: string | null }>
): Promise<NotableDate | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (fields.name !== undefined) {
    setClauses.push(`name = $${paramIdx++}`);
    params.push(fields.name);
  }
  if (fields.dateMonth !== undefined) {
    setClauses.push(`date_month = $${paramIdx++}`);
    params.push(fields.dateMonth);
  }
  if (fields.dateDay !== undefined) {
    setClauses.push(`date_day = $${paramIdx++}`);
    params.push(fields.dateDay);
  }
  if (fields.description !== undefined) {
    setClauses.push(`description = $${paramIdx++}`);
    params.push(fields.description);
  }

  if (setClauses.length === 0) return null;

  setClauses.push(`updated_at = NOW()`);
  params.push(id, tribeId);

  const sql = `UPDATE notable_dates SET ${setClauses.join(", ")}
     WHERE id = $${paramIdx++} AND tribe_id = $${paramIdx}
     RETURNING id, tribe_id, added_by_user_id, name, date_month, date_day,
               event_type, description, greeting_template, emoji, is_priority, is_active, created_at`;

  const { rows } = await query<{
    id: number;
    tribe_id: number;
    added_by_user_id: number | null;
    name: string;
    date_month: number;
    date_day: number;
    event_type: string;
    description: string | null;
    greeting_template: string | null;
    emoji: string;
    is_priority: boolean;
    is_active: boolean;
    created_at: Date;
  }>(sql, params);

  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

/** Remove a notable date. */
export async function removeNotableDate(id: number, tribeId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM notable_dates WHERE id = $1 AND tribe_id = $2",
    [id, tribeId]
  );
  return (rowCount ?? 0) > 0;
}

/** List notable dates for a tribe (optionally filtered by month). */
export async function listNotableDates(
  tribeId: number,
  month?: number
): Promise<NotableDate[]> {
  let sql = `SELECT id, tribe_id, added_by_user_id, name, date_month, date_day,
                    event_type, description, greeting_template, emoji, is_priority, is_active, created_at
             FROM notable_dates
             WHERE tribe_id = $1 AND is_active = true`;
  const params: unknown[] = [tribeId];

  if (month != null) {
    sql += " AND date_month = $2";
    params.push(month);
  }

  sql += " ORDER BY date_month, date_day, event_type, name";

  const { rows } = await query<{
    id: number;
    tribe_id: number;
    added_by_user_id: number | null;
    name: string;
    date_month: number;
    date_day: number;
    event_type: string;
    description: string | null;
    greeting_template: string | null;
    emoji: string;
    is_priority: boolean;
    is_active: boolean;
    created_at: Date;
  }>(sql, params);
  return rows.map(mapRow);
}

/** Count notable dates for a tribe (optionally filtered by month, excluding holidays). */
export async function countNotableDates(
  tribeId: number,
  excludeHolidays: boolean = false
): Promise<number> {
  let sql = `SELECT COUNT(*)::int AS cnt FROM notable_dates WHERE tribe_id = $1 AND is_active = true`;
  const params: unknown[] = [tribeId];

  if (excludeHolidays) {
    sql += ` AND event_type != 'holiday'`;
  }

  const { rows } = await query<{ cnt: number }>(sql, params);
  return rows[0]?.cnt ?? 0;
}

/** List notable dates with pagination (flat list, ordered by date). */
export async function listNotableDatesPaginated(
  tribeId: number,
  limit: number,
  offset: number,
  excludeHolidays: boolean = false
): Promise<NotableDate[]> {
  let sql = `SELECT id, tribe_id, added_by_user_id, name, date_month, date_day,
                    event_type, description, greeting_template, emoji, is_priority, is_active, created_at
             FROM notable_dates
             WHERE tribe_id = $1 AND is_active = true`;
  const params: unknown[] = [tribeId];
  let paramIdx = 2;

  if (excludeHolidays) {
    sql += ` AND event_type != 'holiday'`;
  }

  sql += ` ORDER BY date_month, date_day, event_type, name LIMIT $${paramIdx++} OFFSET $${paramIdx}`;
  params.push(limit, offset);

  const { rows } = await query<{
    id: number;
    tribe_id: number;
    added_by_user_id: number | null;
    name: string;
    date_month: number;
    date_day: number;
    event_type: string;
    description: string | null;
    greeting_template: string | null;
    emoji: string;
    is_priority: boolean;
    is_active: boolean;
    created_at: Date;
  }>(sql, params);
  return rows.map(mapRow);
}

/** Get upcoming notable dates (next N days from today). */
export async function getUpcomingDates(
  tribeId: number,
  days: number = 14
): Promise<NotableDate[]> {
  // Build list of (month, day) pairs for the next N days
  const pairs: Array<{ month: number; day: number }> = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    pairs.push({ month: d.getMonth() + 1, day: d.getDate() });
  }

  if (pairs.length === 0) return [];

  const conditions = pairs.map((_, i) => `(date_month = $${i * 2 + 2} AND date_day = $${i * 2 + 3})`).join(" OR ");
  const params: unknown[] = [tribeId];
  for (const p of pairs) {
    params.push(p.month, p.day);
  }

  const { rows } = await query<{
    id: number;
    tribe_id: number;
    added_by_user_id: number | null;
    name: string;
    date_month: number;
    date_day: number;
    event_type: string;
    description: string | null;
    greeting_template: string | null;
    emoji: string;
    is_priority: boolean;
    is_active: boolean;
    created_at: Date;
  }>(
    `SELECT id, tribe_id, added_by_user_id, name, date_month, date_day,
            event_type, description, greeting_template, emoji, is_priority, is_active, created_at
     FROM notable_dates
     WHERE tribe_id = $1 AND is_active = true AND (${conditions})
     ORDER BY date_month, date_day, event_type, name`,
    params
  );
  return rows.map(mapRow);
}

// ─── Admin functions ────────────────────────────────────────────────────

/** Admin: bulk delete notable dates by ID array. */
export async function bulkDeleteDates(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await query(
    "DELETE FROM notable_dates WHERE id = ANY($1)",
    [ids]
  );
  return rowCount ?? 0;
}

/** Admin: delete all notable dates for a tribe. */
export async function deleteAllDates(tribeId: number): Promise<number> {
  const { rowCount } = await query(
    "DELETE FROM notable_dates WHERE tribe_id = $1",
    [tribeId]
  );
  return rowCount ?? 0;
}

/** Admin: get all notable dates paginated (all tribes). */
export async function getAllDatesPaginated(
  limit: number,
  offset: number
): Promise<NotableDate[]> {
  const { rows } = await query<{
    id: number; tribe_id: number; added_by_user_id: number | null;
    name: string; date_month: number; date_day: number;
    event_type: string; description: string | null;
    greeting_template: string | null; emoji: string;
    is_priority: boolean; is_active: boolean; created_at: Date;
  }>(
    `SELECT id, tribe_id, added_by_user_id, name, date_month, date_day,
            event_type, description, greeting_template, emoji, is_priority, is_active, created_at
     FROM notable_dates
     ORDER BY date_month, date_day, name
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map(mapRow);
}

/** Admin: count all notable dates for a tribe. */
export async function countAllDates(tribeId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM notable_dates WHERE tribe_id = $1",
    [tribeId]
  );
  return parseInt(rows[0].count, 10);
}

function mapRow(r: {
  id: number;
  tribe_id: number;
  added_by_user_id: number | null;
  name: string;
  date_month: number;
  date_day: number;
  event_type: string;
  description: string | null;
  greeting_template: string | null;
  emoji: string;
  is_priority: boolean;
  is_active: boolean;
  created_at: Date;
}): NotableDate {
  return {
    id: r.id,
    tribeId: r.tribe_id,
    addedByUserId: r.added_by_user_id,
    name: r.name,
    dateMonth: r.date_month,
    dateDay: r.date_day,
    eventType: r.event_type,
    description: r.description,
    greetingTemplate: r.greeting_template,
    emoji: r.emoji,
    isPriority: r.is_priority,
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}
