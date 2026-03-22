import { TAVILY_API_URL } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type { TavilyResult, TavilySearchResponse } from "./types.js";

const log = createLogger("osint-tavily");

/** Search via Tavily API. Returns results or empty array on failure. */
export async function tavilySearch(
  searchQuery: string,
  maxResults: number = 5
): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not set");
  }

  const res = await fetch(`${TAVILY_API_URL}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query: searchQuery,
      search_depth: "advanced",
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    log.error(`Tavily search failed: ${res.status} ${errText}`);
    return [];
  }

  const data = (await res.json()) as TavilySearchResponse;
  return data.results ?? [];
}

/** Run multiple searches in parallel. Returns all results flattened. */
export async function tavilySearchMulti(
  queries: string[],
  maxResultsPerQuery: number = 5
): Promise<TavilyResult[]> {
  const results = await Promise.allSettled(
    queries.map((q) => tavilySearch(q, maxResultsPerQuery))
  );

  const allResults: TavilyResult[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allResults.push(...result.value);
    } else {
      log.warn("Tavily search query failed:", result.reason);
    }
  }

  return deduplicateResults(allResults);
}

/** Remove duplicate URLs, keeping the highest-scoring version. */
function deduplicateResults(results: TavilyResult[]): TavilyResult[] {
  const seen = new Map<string, TavilyResult>();
  for (const r of results) {
    const existing = seen.get(r.url);
    if (!existing || r.score > existing.score) {
      seen.set(r.url, r);
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score);
}
