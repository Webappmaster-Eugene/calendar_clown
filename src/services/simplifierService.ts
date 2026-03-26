/**
 * Simplifier business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  createSimplification,
  markSimplificationCompleted,
  markSimplificationFailed,
  getSimplificationsPaginated,
  countSimplifications,
  getSimplificationById,
  deleteSimplification,
} from "../simplifier/repository.js";
import { simplifyText } from "../simplifier/simplify.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import type {
  SimplificationDto,
  SimplifierHistoryResponse,
  SimplificationInputType,
} from "../shared/types.js";

const log = createLogger("simplifier-service");

// ─── Helpers ──────────────────────────────────────────────────

function requireDb(): void {
  if (!isDatabaseAvailable()) {
    throw new Error("База данных недоступна.");
  }
}

async function requireDbUser(telegramId: number) {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) throw new Error("Пользователь не найден.");
  return dbUser;
}

function toDto(s: {
  id: number;
  inputType: string;
  originalText: string;
  simplifiedText: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  simplifiedAt: Date | null;
}): SimplificationDto {
  return {
    id: s.id,
    inputType: s.inputType as SimplificationInputType,
    originalText: s.originalText,
    simplifiedText: s.simplifiedText,
    status: s.status as SimplificationDto["status"],
    errorMessage: s.errorMessage,
    createdAt: s.createdAt.toISOString(),
    simplifiedAt: s.simplifiedAt?.toISOString() ?? null,
  };
}

// ─── Service Functions ────────────────────────────────────────

/** Get simplification history with pagination. */
export async function getHistory(
  telegramId: number,
  limit: number = 10,
  offset: number = 0,
): Promise<SimplifierHistoryResponse> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const [items, total] = await Promise.all([
    getSimplificationsPaginated(dbUser.id, limit, offset),
    countSimplifications(dbUser.id),
  ]);

  return {
    simplifications: items.map(toDto),
    total,
  };
}

/** Get a single simplification by ID. */
export async function getSimplification(
  telegramId: number,
  simplificationId: number,
): Promise<SimplificationDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const item = await getSimplificationById(simplificationId, dbUser.id);
  if (!item) return null;
  return toDto(item);
}

/** Delete a simplification. */
export async function removeSimplification(
  telegramId: number,
  simplificationId: number,
): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return deleteSimplification(simplificationId, dbUser.id);
}

/** Simplify text from API (create record, call AI, update record). */
export async function simplifyFromApi(
  telegramId: number,
  text: string,
  inputType: SimplificationInputType = "text",
): Promise<SimplificationDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const record = await createSimplification(dbUser.id, inputType, text);

  try {
    const { result, model } = await simplifyText(text);
    await markSimplificationCompleted(record.id, result, model);

    return toDto({
      ...record,
      simplifiedText: result,
      modelUsed: model,
      status: "completed",
      simplifiedAt: new Date(),
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Неизвестная ошибка";
    log.error("Error simplifying text from API:", err);
    await markSimplificationFailed(record.id, errorMsg);

    return toDto({
      ...record,
      status: "failed",
      errorMessage: errorMsg,
    });
  }
}
