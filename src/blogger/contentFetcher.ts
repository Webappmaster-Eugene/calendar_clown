import { createLogger } from "../utils/logger.js";
import { assertPublicUrl, UnsafeUrlError } from "../utils/safeFetch.js";

const log = createLogger("blogger-fetch");

interface FetchedContent {
  title: string;
  content: string;
}

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 5 * 1024 * 1024;

/** Follows redirects by hand so every hop passes the SSRF guard: with the default
 *  `redirect: "follow"` a public URL can bounce to loopback or a metadata address
 *  and only the first URL would ever have been checked. */
async function fetchFollowingSafeRedirects(url: string): Promise<Response | null> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safeUrl = await assertPublicUrl(current);
    const res = await fetch(safeUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BloggerBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location) return res;
    current = new URL(location, safeUrl).toString();
  }

  log.warn(`Too many redirects for ${url}`);
  return null;
}

export async function fetchUrlContent(url: string): Promise<FetchedContent | null> {
  try {
    const res = await fetchFollowingSafeRedirects(url);
    if (!res) return null;
    if (!res.ok) {
      log.warn(`Failed to fetch ${url}: ${res.status}`);
      return null;
    }

    // A user-supplied URL can serve an endless body; cap what we read into memory.
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_HTML_BYTES) {
      log.warn(`Refused oversized body from ${url}: ${declared} bytes`);
      return null;
    }
    const raw = await res.text();
    const html = raw.length > MAX_HTML_BYTES ? raw.slice(0, MAX_HTML_BYTES) : raw;
    const title = extractTitle(html);
    const content = extractReadableContent(html);

    if (!content || content.length < 50) {
      log.warn(`No readable content from ${url}`);
      return null;
    }

    const maxLen = 10_000;
    return {
      title: title || url,
      content: content.length > maxLen ? content.slice(0, maxLen) + "..." : content,
    };
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      log.warn(`Refused unsafe URL ${url}: ${err.message}`);
    } else {
      log.error(`Error fetching ${url}:`, err);
    }
    return null;
  }
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : "";
}

function extractReadableContent(html: string): string {
  let content = extractTag(html, "article");
  if (!content) content = extractTag(html, "main");
  if (!content) content = extractTag(html, "body");
  if (!content) return "";

  content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
  content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
  content = content.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  content = content.replace(/<header[\s\S]*?<\/header>/gi, "");
  content = content.replace(/<footer[\s\S]*?<\/footer>/gi, "");

  content = content.replace(/<br\s*\/?>/gi, "\n");
  content = content.replace(/<\/p>/gi, "\n\n");
  content = content.replace(/<\/li>/gi, "\n");
  content = content.replace(/<\/h[1-6]>/gi, "\n\n");

  content = content.replace(/<[^>]+>/g, "");

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
