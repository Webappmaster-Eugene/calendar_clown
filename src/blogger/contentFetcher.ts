import { createLogger } from "../utils/logger.js";

const log = createLogger("blogger-fetch");

interface FetchedContent {
  title: string;
  content: string;
}

/** Fetch readable content from a URL. Returns null on failure. */
export async function fetchUrlContent(url: string): Promise<FetchedContent | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BloggerBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.warn(`Failed to fetch ${url}: ${res.status}`);
      return null;
    }

    const html = await res.text();
    const title = extractTitle(html);
    const content = extractReadableContent(html);

    if (!content || content.length < 50) {
      log.warn(`No readable content from ${url}`);
      return null;
    }

    // Truncate very long content
    const maxLen = 10_000;
    return {
      title: title || url,
      content: content.length > maxLen ? content.slice(0, maxLen) + "..." : content,
    };
  } catch (err) {
    log.error(`Error fetching ${url}:`, err);
    return null;
  }
}

/** Extract <title> from HTML. */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : "";
}

/** Extract readable text from HTML, preferring <article>, then <main>, then <body>. */
function extractReadableContent(html: string): string {
  // Try <article> first
  let content = extractTag(html, "article");
  if (!content) content = extractTag(html, "main");
  if (!content) content = extractTag(html, "body");
  if (!content) return "";

  // Remove scripts, styles, nav, header, footer
  content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
  content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
  content = content.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  content = content.replace(/<header[\s\S]*?<\/header>/gi, "");
  content = content.replace(/<footer[\s\S]*?<\/footer>/gi, "");

  // Convert <p>, <br>, <li>, headings to newlines
  content = content.replace(/<br\s*\/?>/gi, "\n");
  content = content.replace(/<\/p>/gi, "\n\n");
  content = content.replace(/<\/li>/gi, "\n");
  content = content.replace(/<\/h[1-6]>/gi, "\n\n");

  // Strip remaining tags
  content = content.replace(/<[^>]+>/g, "");

  // Decode entities and clean up whitespace
  content = decodeHtmlEntities(content);
  content = content.replace(/[ \t]+/g, " ");
  content = content.replace(/\n{3,}/g, "\n\n");
  return content.trim();
}

function extractTag(html: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = html.match(regex);
  return match ? match[1] : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}
