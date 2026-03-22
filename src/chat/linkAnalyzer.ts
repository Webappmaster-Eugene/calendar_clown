import { fetchUrlContent } from "../blogger/contentFetcher.js";
import { NEURO_MAX_URLS } from "../constants.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("neuro-links");

/** Max content length per fetched link. */
const MAX_CONTENT_PER_LINK = 5_000;

export interface FetchedLink {
  url: string;
  title: string;
  content: string;
}

/** Extract URLs from text. */
export function extractUrls(text: string): string[] {
  const regex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  const matches = text.match(regex);
  if (!matches) return [];

  // Deduplicate and limit
  const unique = [...new Set(matches)];
  return unique.slice(0, NEURO_MAX_URLS);
}

/** Fetch content from multiple URLs in parallel. */
export async function fetchLinksContent(urls: string[]): Promise<FetchedLink[]> {
  if (urls.length === 0) return [];

  const results = await Promise.allSettled(
    urls.map(async (url): Promise<FetchedLink | null> => {
      const fetched = await fetchUrlContent(url);
      if (!fetched) return null;

      return {
        url,
        title: fetched.title,
        content: fetched.content.length > MAX_CONTENT_PER_LINK
          ? fetched.content.slice(0, MAX_CONTENT_PER_LINK) + "..."
          : fetched.content,
      };
    })
  );

  const links: FetchedLink[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      links.push(result.value);
    } else if (result.status === "rejected") {
      log.warn("Failed to fetch link:", result.reason);
    }
  }

  return links;
}

/** Format fetched links as context string for AI prompt. */
export function formatLinksForContext(links: FetchedLink[]): string {
  if (links.length === 0) return "";

  const parts = links.map((link) =>
    `[URL: ${link.url}]\nTitle: ${link.title}\nContent: ${link.content}`
  );

  return `--- Содержимое ссылок ---\n${parts.join("\n\n")}\n--- Конец содержимого ссылок ---`;
}
