/**
 * Admin business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  addUserByTelegramId,
  removeUserByTelegramId,
  listTribeUsers,
  listUsersWithoutTribe,
  listAllApprovedUsers,
  getUserByTelegramId,
  approveUser,
  rejectUser,
  listPendingUsers,
  setUserTribe,
  removeUserFromTribe,
  listTribes,
  createTribe,
  getTribeName,
  updateTribe,
  deleteTribe,
} from "../expenses/repository.js";
import { query } from "../db/connection.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { createLogger } from "../utils/logger.js";
import type {
  AdminUserDto,
  TribeDto,
  AdminStatsDto,
} from "../shared/types.js";

const log = createLogger("admin-service");

// ─── Helpers ──────────────────────────────────────────────────

function requireDb(): void {
  if (!isDatabaseAvailable()) {
    throw new Error("База данных недоступна.");
  }
}

function requireAdmin(telegramId: number): void {
  if (!isBootstrapAdmin(telegramId)) {
    throw new Error("Доступ запрещён: только для администратора.");
  }
}

// ─── Service Functions ────────────────────────────────────────

/**
 * List all approved users.
 */
export async function listUsers(telegramId: number): Promise<AdminUserDto[]> {
  requireDb();
  requireAdmin(telegramId);

  const { rows } = await query<{
    id: number; telegram_id: string; username: string | null;
    first_name: string; last_name: string | null; role: string;
    status: string; mode: string; tribe_id: number | null;
    tribe_name: string | null; created_at: Date;
  }>(`SELECT u.id, u.telegram_id, u.username, u.first_name, u.last_name,
      u.role, COALESCE(u.status, 'approved') AS status, COALESCE(u.mode, 'calendar') AS mode,
      u.tribe_id, t.name AS tribe_name, u.created_at
      FROM users u LEFT JOIN tribes t ON u.tribe_id = t.id
      WHERE COALESCE(u.status, 'approved') != 'pending'
      ORDER BY u.id`);

  return rows.map((r) => ({
    id: r.id,
    telegramId: Number(r.telegram_id),
    username: r.username,
    firstName: r.first_name,
    lastName: r.last_name,
    role: r.role as "admin" | "user",
    status: r.status as "pending" | "approved",
    mode: r.mode as AdminUserDto["mode"],
    tribeId: r.tribe_id,
    tribeName: r.tribe_name,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
  }));
}

/**
 * List pending users awaiting approval.
 */
export async function getPendingUsers(telegramId: number): Promise<AdminUserDto[]> {
  requireDb();
  requireAdmin(telegramId);

  const { rows } = await query<{
    id: number; telegram_id: string; username: string | null;
    first_name: string; last_name: string | null; role: string;
    tribe_id: number | null; tribe_name: string | null; created_at: Date;
  }>(`SELECT u.id, u.telegram_id, u.username, u.first_name, u.last_name,
      u.role, u.tribe_id, t.name AS tribe_name, u.created_at
      FROM users u LEFT JOIN tribes t ON u.tribe_id = t.id
      WHERE u.status = 'pending'
      ORDER BY u.id`);

  return rows.map((r) => ({
    id: r.id,
    telegramId: Number(r.telegram_id),
    username: r.username,
    firstName: r.first_name,
    lastName: r.last_name,
    role: r.role as "admin" | "user",
    status: "pending" as const,
    mode: "calendar" as const,
    tribeId: r.tribe_id,
    tribeName: r.tribe_name,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
  }));
}

/**
 * Approve a pending user.
 */
export async function approveUserById(telegramId: number, targetTelegramId: number): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  return approveUser(targetTelegramId);
}

/**
 * Reject a pending user.
 */
export async function rejectUserById(telegramId: number, targetTelegramId: number): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  return rejectUser(targetTelegramId);
}

/**
 * Add a new user by telegram ID.
 */
export async function addUser(telegramId: number, targetTelegramId: number): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  const result = await addUserByTelegramId(targetTelegramId);
  return result !== null;
}

/**
 * Remove a user by telegram ID.
 */
export async function removeUser(telegramId: number, targetTelegramId: number): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);

  if (telegramId === targetTelegramId) {
    throw new Error("Нельзя удалить самого себя");
  }
  if (targetTelegramId === 0) {
    throw new Error("Нельзя удалить системного пользователя");
  }

  return removeUserByTelegramId(targetTelegramId);
}

/**
 * Assign a user to a tribe.
 */
export async function assignUserToTribe(
  telegramId: number,
  targetTelegramId: number,
  tribeId: number
): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  return setUserTribe(targetTelegramId, tribeId);
}

/**
 * Remove a user from their tribe.
 */
export async function removeUserTribe(
  telegramId: number,
  targetTelegramId: number
): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  return removeUserFromTribe(targetTelegramId);
}

/**
 * List all tribes.
 */
export async function getTribes(telegramId: number): Promise<TribeDto[]> {
  requireDb();
  requireAdmin(telegramId);

  const { rows } = await query<{
    id: number; name: string; monthly_limit: number | null;
    created_at: Date; member_count: string;
  }>(`SELECT t.id, t.name, t.monthly_limit, t.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.tribe_id = t.id)::text AS member_count
      FROM tribes t ORDER BY t.name`);

  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    monthlyLimit: t.monthly_limit ?? 0,
    memberCount: parseInt(t.member_count, 10),
    createdAt: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
  }));
}

/**
 * Create a new tribe.
 */
export async function createNewTribe(telegramId: number, name: string): Promise<TribeDto> {
  requireDb();
  requireAdmin(telegramId);

  const { rows } = await query<{
    id: number; name: string; monthly_limit: number | null; created_at: Date;
  }>("INSERT INTO tribes (name) VALUES ($1) RETURNING id, name, monthly_limit, created_at", [name]);

  const t = rows[0];
  return {
    id: t.id,
    name: t.name,
    monthlyLimit: t.monthly_limit ?? 0,
    memberCount: 0,
    createdAt: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
  };
}

/**
 * Update tribe settings.
 */
export async function editTribe(
  telegramId: number,
  tribeId: number,
  fields: { name?: string; monthlyLimit?: number | null }
): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  return updateTribe(tribeId, fields);
}

/**
 * Delete a tribe (only if no users assigned).
 */
export async function removeTribe(telegramId: number, tribeId: number): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  return deleteTribe(tribeId);
}

/**
 * Get global statistics.
 */
export async function getGlobalStats(telegramId: number): Promise<AdminStatsDto> {
  requireDb();
  requireAdmin(telegramId);

  const [
    usersResult,
    approvedResult,
    pendingResult,
    tribesResult,
    expensesResult,
    eventsResult,
    transcriptionsResult,
  ] = await Promise.all([
    query<{ count: string }>("SELECT COUNT(*) AS count FROM users"),
    query<{ count: string }>("SELECT COUNT(*) AS count FROM users WHERE COALESCE(status, 'approved') = 'approved'"),
    query<{ count: string }>("SELECT COUNT(*) AS count FROM users WHERE status = 'pending'"),
    query<{ count: string }>("SELECT COUNT(*) AS count FROM tribes"),
    query<{ count: string }>("SELECT COUNT(*) AS count FROM expenses"),
    query<{ count: string }>("SELECT COUNT(*) AS count FROM calendar_events"),
    query<{ count: string }>("SELECT COUNT(*) AS count FROM voice_transcriptions"),
  ]);

  return {
    totalUsers: parseInt(usersResult.rows[0].count, 10),
    approvedUsers: parseInt(approvedResult.rows[0].count, 10),
    pendingUsers: parseInt(pendingResult.rows[0].count, 10),
    totalTribes: parseInt(tribesResult.rows[0].count, 10),
    totalExpenses: parseInt(expensesResult.rows[0].count, 10),
    totalCalendarEvents: parseInt(eventsResult.rows[0].count, 10),
    totalTranscriptions: parseInt(transcriptionsResult.rows[0].count, 10),
  };
}
