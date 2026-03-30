/**
 * Fire-and-forget action logging for audit trail.
 * Logs user actions to action_logs table.
 */

import { query } from "../db/connection.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("action-log");

/** Max details string length to prevent oversized payloads. */
const MAX_DETAILS_LENGTH = 10_000;

// ─── Types ───────────────────────────────────────────────────

export interface ActionLogFilter {
  userId?: number;
  telegramId?: number;
  action?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface ActionLogEntry {
  id: number;
  userId: number | null;
  telegramId: string | null;
  action: string;
  details: string | null;
  createdAt: string;
  firstName: string | null;
  username: string | null;
}

export interface ActionLogsResult {
  items: ActionLogEntry[];
  total: number;
}

// ─── Write ───────────────────────────────────────────────────

/** Log a user action (fire-and-forget, never throws). */
export function logAction(
  userId: number | null,
  telegramId: number | null,
  action: string,
  details?: string | Record<string, unknown>
): void {
  if (!isDatabaseAvailable()) return;

  let detailsStr = typeof details === "object" ? JSON.stringify(details) : (details ?? null);
  if (detailsStr && detailsStr.length > MAX_DETAILS_LENGTH) {
    detailsStr = detailsStr.slice(0, MAX_DETAILS_LENGTH);
  }

  query(
    `INSERT INTO action_logs (user_id, telegram_id, action, details) VALUES ($1, $2, $3, $4)`,
    [userId, telegramId, action, detailsStr]
  ).catch((err) => {
    log.error(`Failed to log action "${action}":`, err);
  });
}

/** Convenience: log action from API context where only telegramId is known. */
export function logApiAction(
  telegramId: number,
  action: string,
  details?: string | Record<string, unknown>
): void {
  logAction(null, telegramId, action, details);
}

// ─── Read ────────────────────────────────────────────────────

/** Get action statistics for a date range. */
export async function getActionStats(
  dateFrom: Date,
  dateTo: Date
): Promise<Array<{ action: string; count: number }>> {
  const { rows } = await query<{ action: string; count: string }>(
    `SELECT action, COUNT(*) AS count
     FROM action_logs
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY action
     ORDER BY count DESC`,
    [dateFrom.toISOString(), dateTo.toISOString()]
  );
  return rows.map((r) => ({ action: r.action, count: parseInt(r.count, 10) }));
}

/** Get paginated action logs with user info, supporting filters. */
export async function getActionLogs(filters: ActionLogFilter): Promise<ActionLogsResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters.userId != null) {
    conditions.push(`al.user_id = $${paramIdx++}`);
    params.push(filters.userId);
  }
  if (filters.telegramId != null) {
    conditions.push(`al.telegram_id = $${paramIdx++}`);
    params.push(filters.telegramId);
  }
  if (filters.action) {
    conditions.push(`al.action = $${paramIdx++}`);
    params.push(filters.action);
  }
  if (filters.search) {
    conditions.push(`al.details ILIKE $${paramIdx++}`);
    params.push(`%${filters.search}%`);
  }
  if (filters.dateFrom) {
    conditions.push(`al.created_at >= $${paramIdx++}`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push(`al.created_at < $${paramIdx++}`);
    params.push(filters.dateTo);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 50, 100);
  const offset = filters.offset ?? 0;

  const countQuery = `SELECT COUNT(*) AS total FROM action_logs al ${where}`;
  const dataQuery = `
    SELECT
      al.id,
      al.user_id AS "userId",
      al.telegram_id::text AS "telegramId",
      al.action,
      al.details,
      al.created_at::text AS "createdAt",
      u.first_name AS "firstName",
      u.username
    FROM action_logs al
    LEFT JOIN users u ON u.id = al.user_id
    ${where}
    ORDER BY al.created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;

  const [countResult, dataResult] = await Promise.all([
    query<{ total: string }>(countQuery, params),
    query<ActionLogEntry>(dataQuery, [...params, limit, offset]),
  ]);

  return {
    items: dataResult.rows,
    total: parseInt(countResult.rows[0]?.total ?? "0", 10),
  };
}

/** Get all distinct action names (for filter dropdown). */
export async function getDistinctActions(): Promise<string[]> {
  const { rows } = await query<{ action: string }>(
    `SELECT DISTINCT action FROM action_logs ORDER BY action`
  );
  return rows.map((r) => r.action);
}
