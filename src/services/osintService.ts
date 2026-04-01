/**
 * OSINT business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  getSearchById,
  getFilteredSearchHistory,
  countTodaySearches,
  createSearch,
} from "../osint/repository.js";
import { runOsintSearch } from "../osint/searchOrchestrator.js";
import { parseSearchSubject } from "../osint/queryParser.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { OSINT_DAILY_LIMIT } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type { OsintSearchDto, OsintSearchHistoryResponse, OsintStatus } from "../shared/types.js";

const log = createLogger("osint-service");

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

// ─── Service Functions ────────────────────────────────────────

/**
 * Get search history for a user with pagination and optional filters.
 */
export async function getSearchHistory(
  telegramId: number,
  limit: number = 10,
  offset: number = 0,
  filter?: { status?: OsintStatus; searchText?: string }
): Promise<OsintSearchHistoryResponse> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const result = await getFilteredSearchHistory(dbUser.id, limit, offset, filter);

  return {
    searches: result.searches.map((s) => ({
      id: s.id,
      query: s.query,
      status: s.status as OsintSearchDto["status"],
      report: s.report,
      sourcesCount: s.sourcesCount,
      inputMethod: s.inputMethod,
      errorMessage: s.errorMessage,
      completedAt: s.completedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
    total: result.total,
  };
}

/**
 * Get a single search result by ID.
 */
export async function getSearch(
  telegramId: number,
  searchId: number
): Promise<OsintSearchDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const s = await getSearchById(searchId, dbUser.id);
  if (!s) return null;

  return {
    id: s.id,
    query: s.query,
    status: s.status as OsintSearchDto["status"],
    report: s.report,
    sourcesCount: s.sourcesCount,
    inputMethod: s.inputMethod,
    errorMessage: s.errorMessage,
    completedAt: s.completedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

/**
 * Get today's search count and remaining quota.
 */
export async function getSearchQuota(telegramId: number): Promise<{ used: number; limit: number; remaining: number }> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const used = await countTodaySearches(dbUser.id);
  return {
    used,
    limit: OSINT_DAILY_LIMIT,
    remaining: Math.max(0, OSINT_DAILY_LIMIT - used),
  };
}

/**
 * Initiate an OSINT search (creates the DB record).
 * The actual search pipeline is orchestrated separately (requires Telegraf context for progress updates).
 * For API use, returns the search ID for polling.
 */
export async function initiateSearch(
  telegramId: number,
  queryText: string,
  inputMethod: "text" | "voice" = "text"
): Promise<OsintSearchDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const used = await countTodaySearches(dbUser.id);
  if (used >= OSINT_DAILY_LIMIT) {
    throw new Error(`Достигнут дневной лимит поисков (${OSINT_DAILY_LIMIT}/${OSINT_DAILY_LIMIT}). Попробуйте завтра.`);
  }

  const search = await createSearch(dbUser.id, queryText, inputMethod);

  // Fire-and-forget: run the search pipeline in the background.
  // The Mini App polls GET /api/osint/:id to track progress.
  runOsintSearch(dbUser.id, queryText, inputMethod, {
    existingSearchId: search.id,
  }).catch((err) => log.error("Background OSINT search failed:", err));

  return {
    id: search.id,
    query: search.query,
    status: search.status as OsintSearchDto["status"],
    report: search.report,
    sourcesCount: search.sourcesCount,
    inputMethod: search.inputMethod,
    errorMessage: search.errorMessage,
    completedAt: search.completedAt?.toISOString() ?? null,
    createdAt: search.createdAt.toISOString(),
  };
}
