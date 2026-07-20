import {
  getSearchById,
  getFilteredSearchHistory,
  countTodaySearches,
  createSearch,
} from "../osint/repository.js";
import { runOsintSearch } from "../osint/searchOrchestrator.js";
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

  // Fire-and-forget: pipeline runs in the background; the Mini App polls GET /api/osint/:id for progress.
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
