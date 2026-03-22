import { TAVILY_API_URL } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type { TavilyResult, TavilyImage, TavilySearchResponse } from "./types.js";

const log = createLogger("osint-tavily");

export interface TavilySearchResult {
  results: TavilyResult[];
  images: TavilyImage[];
}

/** Search via Tavily API. Returns results and images, or empty on failure. */
export async function tavilySearch(
  searchQuery: string,
  maxResults: number = 5
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
      include_raw_content: false,
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

/** Run multiple searches in parallel. Returns all results and images flattened. */
export async function tavilySearchMulti(
  queries: string[],
  maxResultsPerQuery: number = 5
): Promise<TavilySearchResult> {
  const settled = await Promise.allSettled(
    queries.map((q) => tavilySearch(q, maxResultsPerQuery))
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
