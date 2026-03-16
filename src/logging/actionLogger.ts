/**
 * Fire-and-forget action logging for audit trail.
 * Logs user actions to action_logs table.
 */

import { query } from "../db/connection.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("action-log");

/** Log a user action (fire-and-forget, never throws). */
export function logAction(
  userId: number | null,
  telegramId: number | null,
  action: string,
  details?: string | Record<string, unknown>
): void {
  if (!isDatabaseAvailable()) return;

  const detailsStr = typeof details === "object" ? JSON.stringify(details) : (details ?? null);

  query(
    `INSERT INTO action_logs (user_id, telegram_id, action, details) VALUES ($1, $2, $3, $4)`,
    [userId, telegramId, action, detailsStr]
  ).catch((err) => {
    log.error(`Failed to log action "${action}":`, err);
  });
}

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
