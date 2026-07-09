/**
 * Admin business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  addUserByTelegramId,
  removeUserByTelegramId,
  approveUser,
  rejectUser,
  setUserTribe,
  removeUserFromTribe,
  updateTribe,
  deleteTribe,
} from "../expenses/repository.js";
import { count, eq, sql } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import {
  calendarEvents,
  expenses,
  tribes,
  users,
  voiceTranscriptions,
} from "../db/schema.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import type {
  AdminUserDto,
  TribeDto,
  AdminStatsDto,
} from "../shared/types.js";

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

export async function listUsers(telegramId: number): Promise<AdminUserDto[]> {
  requireDb();
  requireAdmin(telegramId);

  const rows = await db
    .select({
      id: users.id,
      telegramId: users.telegramId,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      status: sql<string>`coalesce(${users.status}, 'approved')`,
      mode: sql<string>`coalesce(${users.mode}, 'calendar')`,
      tribeId: users.tribeId,
      tribeName: tribes.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(tribes, eq(users.tribeId, tribes.id))
    .where(sql`coalesce(${users.status}, 'approved') != 'pending'`)
    .orderBy(users.id);

  return rows.map((r) => ({
    id: r.id,
    telegramId: Number(r.telegramId),
    username: r.username,
    firstName: r.firstName,
    lastName: r.lastName,
    role: r.role as "admin" | "user",
    status: r.status as "pending" | "approved",
    mode: r.mode as AdminUserDto["mode"],
    tribeId: r.tribeId,
    tribeName: r.tribeName,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
  }));
}

export async function getPendingUsers(telegramId: number): Promise<AdminUserDto[]> {
  requireDb();
  requireAdmin(telegramId);

  const rows = await db
    .select({
      id: users.id,
      telegramId: users.telegramId,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      tribeId: users.tribeId,
      tribeName: tribes.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(tribes, eq(users.tribeId, tribes.id))
    .where(eq(users.status, "pending"))
    .orderBy(users.id);

  return rows.map((r) => ({
    id: r.id,
    telegramId: Number(r.telegramId),
    username: r.username,
    firstName: r.firstName,
    lastName: r.lastName,
    role: r.role as "admin" | "user",
    status: "pending" as const,
    mode: "calendar" as const,
    tribeId: r.tribeId,
    tribeName: r.tribeName,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
  }));
}

export async function approveUserById(telegramId: number, targetTelegramId: number): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  return approveUser(targetTelegramId);
}

export async function rejectUserById(telegramId: number, targetTelegramId: number): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  return rejectUser(targetTelegramId);
}

export async function addUser(telegramId: number, targetTelegramId: number): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  const result = await addUserByTelegramId(targetTelegramId);
  return result !== null;
}

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

export async function assignUserToTribe(
  telegramId: number,
  targetTelegramId: number,
  tribeId: number
): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  return setUserTribe(targetTelegramId, tribeId);
}

export async function removeUserTribe(
  telegramId: number,
  targetTelegramId: number
): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  return removeUserFromTribe(targetTelegramId);
}

export async function getTribes(telegramId: number): Promise<TribeDto[]> {
  requireDb();
  requireAdmin(telegramId);

  const rows = await db
    .select({
      id: tribes.id,
      name: tribes.name,
      monthlyLimit: tribes.monthlyLimit,
      createdAt: tribes.createdAt,
      memberCount: sql<string>`(SELECT COUNT(*) FROM ${users} WHERE ${users.tribeId} = ${tribes.id})::text`,
    })
    .from(tribes)
    .orderBy(tribes.name);

  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    monthlyLimit: t.monthlyLimit != null ? parseFloat(t.monthlyLimit) : 0,
    memberCount: parseInt(t.memberCount, 10),
    createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
  }));
}

export async function createNewTribe(telegramId: number, name: string): Promise<TribeDto> {
  requireDb();
  requireAdmin(telegramId);

  const [t] = await db
    .insert(tribes)
    .values({ name })
    .returning({
      id: tribes.id,
      name: tribes.name,
      monthlyLimit: tribes.monthlyLimit,
      createdAt: tribes.createdAt,
    });

  return {
    id: t.id,
    name: t.name,
    monthlyLimit: t.monthlyLimit != null ? parseFloat(t.monthlyLimit) : 0,
    memberCount: 0,
    createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
  };
}

export async function editTribe(
  telegramId: number,
  tribeId: number,
  fields: { name?: string; monthlyLimit?: number | null }
): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  return updateTribe(tribeId, fields);
}

export async function removeTribe(telegramId: number, tribeId: number): Promise<boolean> {
  requireDb();
  requireAdmin(telegramId);
  return deleteTribe(tribeId);
}

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
    db.select({ count: count() }).from(users),
    db.select({ count: count() }).from(users).where(sql`coalesce(${users.status}, 'approved') = 'approved'`),
    db.select({ count: count() }).from(users).where(eq(users.status, "pending")),
    db.select({ count: count() }).from(tribes),
    db.select({ count: count() }).from(expenses),
    db.select({ count: count() }).from(calendarEvents),
    db.select({ count: count() }).from(voiceTranscriptions),
  ]);

  return {
    totalUsers: usersResult[0].count,
    approvedUsers: approvedResult[0].count,
    pendingUsers: pendingResult[0].count,
    totalTribes: tribesResult[0].count,
    totalExpenses: expensesResult[0].count,
    totalCalendarEvents: eventsResult[0].count,
    totalTranscriptions: transcriptionsResult[0].count,
  };
}
