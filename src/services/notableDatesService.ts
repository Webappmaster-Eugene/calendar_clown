/**
 * Notable Dates business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  addNotableDate,
  removeNotableDate,
  updateNotableDate,
  listNotableDates,
  getUpcomingDates,
  toggleNotableDatePriority,
  getNotableDateById,
  countNotableDates,
  listNotableDatesPaginated,
} from "../notable-dates/repository.js";
import type { NotableDate } from "../notable-dates/repository.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import type { NotableDateDto } from "../shared/types.js";

const log = createLogger("notable-dates-service");

// ─── Helpers ──────────────────────────────────────────────────

function requireDb(): void {
  if (!isDatabaseAvailable()) {
    throw new Error("База данных недоступна.");
  }
}

async function requireDbUser(telegramId: number) {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) throw new Error("Пользователь не найден.");
  if (!dbUser.tribeId) throw new Error("Знаменательные даты доступны только для участников трайба.");
  return dbUser;
}

function dateToDto(d: NotableDate): NotableDateDto {
  return {
    id: d.id,
    name: d.name,
    dateMonth: d.dateMonth,
    dateDay: d.dateDay,
    eventType: d.eventType,
    description: d.description,
    emoji: d.emoji,
    isPriority: d.isPriority,
    isActive: d.isActive,
  };
}

// ─── Service Functions ────────────────────────────────────────

/**
 * Get all notable dates for the user's tribe.
 */
export async function getAllDates(
  telegramId: number,
  month?: number
): Promise<NotableDateDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const dates = await listNotableDates(dbUser.tribeId!, month);
  return dates.map(dateToDto);
}

/**
 * Get notable dates with pagination.
 */
export async function getDatesPaginated(
  telegramId: number,
  limit: number = 10,
  offset: number = 0,
  excludeHolidays: boolean = false
): Promise<{ dates: NotableDateDto[]; total: number }> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const [dates, total] = await Promise.all([
    listNotableDatesPaginated(dbUser.tribeId!, limit, offset, excludeHolidays),
    countNotableDates(dbUser.tribeId!, excludeHolidays),
  ]);

  return { dates: dates.map(dateToDto), total };
}

/**
 * Get upcoming notable dates (next N days).
 */
export async function getUpcoming(
  telegramId: number,
  days: number = 14
): Promise<NotableDateDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const dates = await getUpcomingDates(dbUser.tribeId!, days);
  return dates.map(dateToDto);
}

/**
 * Get a single notable date by ID.
 */
export async function getDate(telegramId: number, dateId: number): Promise<NotableDateDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const date = await getNotableDateById(dateId, dbUser.tribeId!);
  if (!date) return null;
  return dateToDto(date);
}

/**
 * Add a new notable date.
 */
export async function createDate(
  telegramId: number,
  params: {
    name: string;
    dateMonth: number;
    dateDay: number;
    eventType?: string;
    description?: string;
    emoji?: string;
    isPriority?: boolean;
  }
): Promise<NotableDateDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const date = await addNotableDate({
    tribeId: dbUser.tribeId!,
    addedByUserId: dbUser.id,
    name: params.name,
    dateMonth: params.dateMonth,
    dateDay: params.dateDay,
    eventType: params.eventType,
    description: params.description ?? null,
    emoji: params.emoji,
    isPriority: params.isPriority,
  });

  return dateToDto(date);
}

/**
 * Update a notable date.
 */
export async function editDate(
  telegramId: number,
  dateId: number,
  fields: Partial<{ name: string; dateMonth: number; dateDay: number; description: string | null; eventType: string; emoji: string; isPriority: boolean }>
): Promise<NotableDateDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const updated = await updateNotableDate(dateId, dbUser.tribeId!, fields);
  if (!updated) return null;
  return dateToDto(updated);
}

/**
 * Remove a notable date.
 */
export async function removeDate(telegramId: number, dateId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return removeNotableDate(dateId, dbUser.tribeId!);
}

/**
 * Toggle priority flag on a notable date.
 */
export async function togglePriority(telegramId: number, dateId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return toggleNotableDatePriority(dateId, dbUser.tribeId!);
}
