import { query } from "../db/connection.js";
import { TIMEZONE_MSK } from "../constants.js";
import type { OsintSearch, OsintParsedSubject, OsintStatus, TavilyResult } from "./types.js";

/** Strip PostgreSQL-incompatible null characters from strings. */
function stripNullChars(value: string): string {
  return value.replace(/\u0000/g, "");
}

/** Create a new OSINT search record. */
export async function createSearch(
  userId: number,
  queryText: string,
  inputMethod: "text" | "voice"
): Promise<OsintSearch> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    query: string;
    parsed_subject: OsintParsedSubject | null;
    status: OsintStatus;
    search_queries: string[] | null;
    raw_results: TavilyResult[] | null;
    report: string | null;
    sources_count: number;
    input_method: "text" | "voice";
    error_message: string | null;
    started_at: Date | null;
    completed_at: Date | null;
    created_at: Date;
  }>(
    `INSERT INTO osint_searches (user_id, query, input_method, status, started_at)
     VALUES ($1, $2, $3, 'pending', NOW())
     RETURNING *`,
    [userId, queryText, inputMethod]
  );
  return mapRow(rows[0]);
}

/** Update search status. */
export async function updateSearchStatus(
  searchId: number,
  status: OsintStatus,
  extra?: {
    parsedSubject?: OsintParsedSubject;
    searchQueries?: string[];
    rawResults?: TavilyResult[];
    report?: string;
    sourcesCount?: number;
    errorMessage?: string;
  }
): Promise<void> {
  const sets: string[] = ["status = $2"];
  const params: unknown[] = [searchId, status];
  let idx = 3;

  if (extra?.parsedSubject !== undefined) {
    sets.push(`parsed_subject = $${idx}`);
    params.push(JSON.stringify(extra.parsedSubject));
    idx++;
  }
  if (extra?.searchQueries !== undefined) {
    sets.push(`search_queries = $${idx}`);
    params.push(JSON.stringify(extra.searchQueries));
    idx++;
  }
  if (extra?.rawResults !== undefined) {
    sets.push(`raw_results = $${idx}`);
    params.push(stripNullChars(JSON.stringify(extra.rawResults)));
    idx++;
  }
  if (extra?.report !== undefined) {
    sets.push(`report = $${idx}`);
    params.push(stripNullChars(extra.report));
    idx++;
  }
  if (extra?.sourcesCount !== undefined) {
    sets.push(`sources_count = $${idx}`);
    params.push(extra.sourcesCount);
    idx++;
  }
  if (extra?.errorMessage !== undefined) {
    sets.push(`error_message = $${idx}`);
    params.push(stripNullChars(extra.errorMessage));
    idx++;
  }
  if (status === "completed" || status === "failed") {
    sets.push("completed_at = NOW()");
  }

  await query(
    `UPDATE osint_searches SET ${sets.join(", ")} WHERE id = $1`,
    params
  );
}

/** Count today's non-failed searches for a user. */
export async function countTodaySearches(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM osint_searches
     WHERE user_id = $1
       AND created_at >= (CURRENT_DATE AT TIME ZONE $2)
       AND status != 'failed'`,
    [userId, TIMEZONE_MSK]
  );
  return parseInt(rows[0].count, 10);
}

/** Get search history for a user, paginated. */
export async function getSearchHistory(
  userId: number,
  limit: number,
  offset: number
): Promise<{ searches: OsintSearch[]; total: number }> {
  const [dataResult, countResult] = await Promise.all([
    query<{
      id: number;
      user_id: number;
      query: string;
      parsed_subject: OsintParsedSubject | null;
      status: OsintStatus;
      search_queries: string[] | null;
      raw_results: TavilyResult[] | null;
      report: string | null;
      sources_count: number;
      input_method: "text" | "voice";
      error_message: string | null;
      started_at: Date | null;
      completed_at: Date | null;
      created_at: Date;
    }>(
      `SELECT * FROM osint_searches
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM osint_searches WHERE user_id = $1`,
      [userId]
    ),
  ]);
  return {
    searches: dataResult.rows.map(mapRow),
    total: parseInt(countResult.rows[0].count, 10),
  };
}

/** Get filtered search history for a user, paginated. */
export async function getFilteredSearchHistory(
  userId: number,
  limit: number,
  offset: number,
  filter?: { status?: OsintStatus; searchText?: string }
): Promise<{ searches: OsintSearch[]; total: number }> {
  const conditions: string[] = ["user_id = $1"];
  const params: unknown[] = [userId];
  let idx = 2;

  if (filter?.status) {
    conditions.push(`status = $${idx}`);
    params.push(filter.status);
    idx++;
  }

  if (filter?.searchText) {
    conditions.push(`query ILIKE $${idx}`);
    params.push(`%${filter.searchText}%`);
    idx++;
  }

  const where = conditions.join(" AND ");

  const [dataResult, countResult] = await Promise.all([
    query<{
      id: number;
      user_id: number;
      query: string;
      parsed_subject: OsintParsedSubject | null;
      status: OsintStatus;
      search_queries: string[] | null;
      raw_results: TavilyResult[] | null;
      report: string | null;
      sources_count: number;
      input_method: "text" | "voice";
      error_message: string | null;
      started_at: Date | null;
      completed_at: Date | null;
      created_at: Date;
    }>(
      `SELECT * FROM osint_searches
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM osint_searches WHERE ${where}`,
      params
    ),
  ]);

  return {
    searches: dataResult.rows.map(mapRow),
    total: parseInt(countResult.rows[0].count, 10),
  };
}

/** Get a single search by ID (only if owned by the user). */
export async function getSearchById(
  searchId: number,
  userId: number
): Promise<OsintSearch | null> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    query: string;
    parsed_subject: OsintParsedSubject | null;
    status: OsintStatus;
    search_queries: string[] | null;
    raw_results: TavilyResult[] | null;
    report: string | null;
    sources_count: number;
    input_method: "text" | "voice";
    error_message: string | null;
    started_at: Date | null;
    completed_at: Date | null;
    created_at: Date;
  }>(
    `SELECT * FROM osint_searches WHERE id = $1 AND user_id = $2`,
    [searchId, userId]
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

// ─── Admin functions ────────────────────────────────────────────────────

/** Admin: get all OSINT searches paginated (all users, with user info). */
export async function getAllSearchesPaginated(
  limit: number,
  offset: number
): Promise<Array<OsintSearch & { firstName: string }>> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    query: string;
    parsed_subject: OsintParsedSubject | null;
    status: OsintStatus;
    search_queries: string[] | null;
    raw_results: TavilyResult[] | null;
    report: string | null;
    sources_count: number;
    input_method: "text" | "voice";
    error_message: string | null;
    started_at: Date | null;
    completed_at: Date | null;
    created_at: Date;
    first_name: string;
  }>(
    `SELECT s.*, u.first_name
     FROM osint_searches s
     JOIN users u ON u.id = s.user_id
     ORDER BY s.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map((r) => ({ ...mapRow(r), firstName: r.first_name }));
}

/** Admin: count all OSINT searches. */
export async function countAllSearches(): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM osint_searches"
  );
  return parseInt(rows[0].count, 10);
}

/** Admin: bulk delete searches by IDs. */
export async function bulkDeleteSearches(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await query(
    "DELETE FROM osint_searches WHERE id = ANY($1)",
    [ids]
  );
  return rowCount ?? 0;
}

/** Admin: delete ALL searches. */
export async function deleteAllSearches(): Promise<number> {
  const { rowCount } = await query("DELETE FROM osint_searches");
  return rowCount ?? 0;
}

// ─── Internal ───────────────────────────────────────────────────────────

function mapRow(r: {
  id: number;
  user_id: number;
  query: string;
  parsed_subject: OsintParsedSubject | null;
  status: OsintStatus;
  search_queries: string[] | null;
  raw_results: TavilyResult[] | null;
  report: string | null;
  sources_count: number;
  input_method: "text" | "voice";
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}): OsintSearch {
  return {
    id: r.id,
    userId: r.user_id,
    query: r.query,
    parsedSubject: r.parsed_subject,
    status: r.status,
    searchQueries: r.search_queries,
    rawResults: r.raw_results,
    report: r.report,
    sourcesCount: r.sources_count,
    inputMethod: r.input_method,
    errorMessage: r.error_message,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  };
}
