import { and, count, desc, eq, gte, ilike, lt, sql } from "drizzle-orm";
import { isDatabaseAvailable } from "../db/connection.js";
import { db } from "../db/drizzle.js";
import { actionLogs, users } from "../db/schema.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("action-log");

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

  db.insert(actionLogs)
    .values({
      userId,
      telegramId: telegramId == null ? null : BigInt(telegramId),
      action,
      details: detailsStr,
    })
    .catch((err) => {
      log.error(`Failed to log action "${action}":`, err);
    });
}

export function logApiAction(
  telegramId: number,
  action: string,
  details?: string | Record<string, unknown>
): void {
  logAction(null, telegramId, action, details);
}

// ─── Read ────────────────────────────────────────────────────

export async function getActionLogs(filters: ActionLogFilter): Promise<ActionLogsResult> {
  const conditions = [];
  if (filters.userId != null) conditions.push(eq(actionLogs.userId, filters.userId));
  if (filters.telegramId != null) conditions.push(eq(actionLogs.telegramId, BigInt(filters.telegramId)));
  if (filters.action) conditions.push(eq(actionLogs.action, filters.action));
  if (filters.search) conditions.push(ilike(actionLogs.details, `%${filters.search}%`));
  if (filters.dateFrom) conditions.push(gte(actionLogs.createdAt, new Date(filters.dateFrom)));
  if (filters.dateTo) conditions.push(lt(actionLogs.createdAt, new Date(filters.dateTo)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = Math.min(filters.limit ?? 50, 100);
  const offset = filters.offset ?? 0;

  const [countResult, items] = await Promise.all([
    db.select({ total: count() }).from(actionLogs).where(where),
    // ::text casts keep timestamp/bigint formatting byte-identical.
    db
      .select({
        id: actionLogs.id,
        userId: actionLogs.userId,
        telegramId: sql<string | null>`${actionLogs.telegramId}::text`,
        action: actionLogs.action,
        details: actionLogs.details,
        createdAt: sql<string>`${actionLogs.createdAt}::text`,
        firstName: users.firstName,
        username: users.username,
      })
      .from(actionLogs)
      .leftJoin(users, eq(users.id, actionLogs.userId))
      .where(where)
      .orderBy(desc(actionLogs.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  return { items, total: countResult[0].total };
}

export async function getDistinctActions(): Promise<string[]> {
  const rows = await db.selectDistinct({ action: actionLogs.action }).from(actionLogs).orderBy(actionLogs.action);
  return rows.map((r) => r.action);
}
