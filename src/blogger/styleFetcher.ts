/**
 * Fetches style samples from a Telegram channel.
 * Strategy A: GramJS MTProto (if configured) — loads top posts by engagement.
 * Strategy B: Fallback via t.me/s/ public web page.
 */

import { createLogger } from "../utils/logger.js";
import { isDigestConfigured } from "../digest/telegramClient.js";

const log = createLogger("style-fetcher");

/** Minimum post length to be considered a style sample. */
const MIN_POST_LENGTH = 300;
/** Maximum characters per sample. */
const MAX_SAMPLE_LENGTH = 2000;
/** Number of top samples to keep. */
const MAX_SAMPLES = 5;
/** Hours to look back for posts via MTProto. */
const HOURS_BACK = 30 * 24; // 30 days
/** Message limit for MTProto fetch. */
const MTPROTO_LIMIT = 50;

/**
 * Fetch style samples from a Telegram channel.
 * Returns up to 5 long posts sorted by engagement (MTProto) or recency (fallback).
 */
export async function fetchStyleSamples(channelUsername: string): Promise<string[]> {
  const username = channelUsername.replace("@", "");

  // Strategy A: MTProto via GramJS
  if (isDigestConfigured()) {
    try {
      const samples = await fetchViaMTProto(username);
      if (samples.length > 0) {
        log.info(`MTProto: fetched ${samples.length} style samples from @${username}`);
        return samples;
      }
    } catch (err) {
      log.error(`MTProto fetch failed for @${username}, falling back to web:`, err);
    }
  }

  // Strategy B: Fallback via t.me/s/ public page
  try {
    const samples = await fetchViaWeb(username);
    log.info(`Web fallback: fetched ${samples.length} style samples from @${username}`);
    return samples;
  } catch (err) {
    log.error(`Web fallback failed for @${username}:`, err);
    return [];
  }
}

/** Fetch posts via GramJS MTProto, sorted by engagement. */
async function fetchViaMTProto(username: string): Promise<string[]> {
  const { readChannelMessages } = await import("../digest/telegramClient.js");

  const posts = await readChannelMessages(username, HOURS_BACK, MTPROTO_LIMIT);

  const longPosts = posts.filter((p) => p.text.length >= MIN_POST_LENGTH);

  // Sort by engagement: views + reactions
  longPosts.sort((a, b) => {
    const engA = (a.views ?? 0) + (a.reactionsCount ?? 0);
    const engB = (b.views ?? 0) + (b.reactionsCount ?? 0);
    return engB - engA;
  });

  return longPosts
    .slice(0, MAX_SAMPLES)
    .map((p) => p.text.slice(0, MAX_SAMPLE_LENGTH));
}

/** Fetch posts via t.me/s/ public web page (no auth required). */
async function fetchViaWeb(username: string): Promise<string[]> {
  const url = `https://t.me/s/${username}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; StyleFetcher/1.0)",
    },
  });

  if (!res.ok) {
    throw new Error(`t.me/s/ returned ${res.status}`);
  }

  const html = await res.text();

  // Parse post texts from the HTML
  // t.me/s/ renders posts inside <div class="tgme_widget_message_text ...">
  const postRegex = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  const posts: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = postRegex.exec(html)) !== null) {
    // Strip HTML tags to get plain text
    const text = match[1]
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .trim();

    if (text.length >= MIN_POST_LENGTH) {
      posts.push(text.slice(0, MAX_SAMPLE_LENGTH));
    }
  }

  // Return last MAX_SAMPLES long posts (most recent are last in HTML)
  return posts.slice(-MAX_SAMPLES);
}
