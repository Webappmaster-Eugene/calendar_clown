import { TAVILY_API_URL } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type { TavilyResult, TavilyImage, TavilySearchResponse, TavilyExtractResult, TavilyExtractResponse } from "./types.js";

const log = createLogger("osint-tavily");

export interface TavilySearchResult {
  results: TavilyResult[];
  images: TavilyImage[];
}

/** Search via Tavily API. Returns results and images, or empty on failure. */
export async function tavilySearch(
  searchQuery: string,
  maxResults: number = 5,
  includeRawContent: boolean = false
): Promise<TavilySearchResult> {
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
      include_raw_content: includeRawContent,
      include_images: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    log.error(`Tavily search failed: ${res.status} ${errText}`);
    return { results: [], images: [] };
  }

  const data = (await res.json()) as TavilySearchResponse;
  return {
    results: data.results ?? [],
    images: data.images ?? [],
  };
}

/** Extract full content from URLs via Tavily Extract API. */
export async function tavilyExtract(urls: string[]): Promise<TavilyExtractResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not set");
  }

  if (urls.length === 0) return [];

  try {
    const res = await fetch(`${TAVILY_API_URL}/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        urls: urls.slice(0, 20),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      log.error(`Tavily extract failed: ${res.status} ${errText}`);
      return [];
    }

    const data = (await res.json()) as TavilyExtractResponse;

    if (data.failed_results && data.failed_results.length > 0) {
      log.warn(`Tavily extract: ${data.failed_results.length} URLs failed:`,
        data.failed_results.map((f) => `${f.url}: ${f.error}`).join(", ")
      );
    }

    return data.results ?? [];
  } catch (err) {
    log.error("Tavily extract error:", err);
    return [];
  }
}

/** Run multiple searches in parallel. Returns all results and images flattened. */
export async function tavilySearchMulti(
  queries: string[],
  maxResultsPerQuery: number = 5,
  includeRawContent: boolean = false
): Promise<TavilySearchResult> {
  const settled = await Promise.allSettled(
    queries.map((q) => tavilySearch(q, maxResultsPerQuery, includeRawContent))
  );

  const allResults: TavilyResult[] = [];
  const allImages: TavilyImage[] = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      allResults.push(...result.value.results);
      allImages.push(...result.value.images);
    } else {
      log.warn("Tavily search query failed:", result.reason);
    }
  }

  return {
    results: deduplicateResults(allResults),
    images: deduplicateImages(allImages),
  };
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

/** Remove duplicate images by URL. */
function deduplicateImages(images: TavilyImage[]): TavilyImage[] {
  const seen = new Set<string>();
  const unique: TavilyImage[] = [];
  for (const img of images) {
    if (!seen.has(img.url)) {
      seen.add(img.url);
      unique.push(img);
    }
  }
  return unique;
}
