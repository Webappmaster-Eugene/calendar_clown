/**
 * Channel discovery: find new channels from forwarded messages
 * in already-tracked channels.
 */

import type { RawChannelPost } from "./types.js";
import { createLogger } from "../utils/logger.js";
import { getChannelInfo } from "./telegramClient.js";

const log = createLogger("digest");

/** Extract @username mentions from post text. */
function extractMentions(text: string): string[] {
  const re = /@([a-zA-Z][a-zA-Z0-9_]{4,31})/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  return mentions;
}

/** Extract t.me/username links from post text. */
function extractTmeLinks(text: string): string[] {
  const re = /(?:https?:\/\/)?t\.me\/([a-zA-Z][a-zA-Z0-9_]{4,31})(?:\/\d+)?/gi;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const username = match[1].toLowerCase();
    // Skip common non-channel paths
    if (["joinchat", "addstickers", "addlist", "addtheme", "share", "proxy", "socks"].includes(username)) continue;
    links.push(username);
  }
  return links;
}

/**
 * Discover potential new channels from posts of tracked channels.
 * Extracts @mentions and t.me/ links, filters out already-tracked channels.
 * Returns a deduplicated list of new channel usernames with mention count.
 */
export function discoverChannels(
  posts: RawChannelPost[],
  trackedUsernames: Set<string>
): Array<{ username: string; mentionCount: number }> {
  const counts = new Map<string, number>();

  for (const post of posts) {
    const mentions = extractMentions(post.text);
    const links = extractTmeLinks(post.text);
    const all = [...new Set([...mentions, ...links])];

    for (const username of all) {
      if (trackedUsernames.has(username)) continue;
      if (username === post.channelUsername) continue;
      counts.set(username, (counts.get(username) ?? 0) + 1);
    }
  }

  const discovered = Array.from(counts.entries())
    .map(([username, mentionCount]) => ({ username, mentionCount }))
    .sort((a, b) => b.mentionCount - a.mentionCount);

  log.info(`Discovered ${discovered.length} potential new channels`);
  return discovered;
}

/** Delay helper for rate limiting. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Validate discovered channels via Telegram API.
 * Filters out bots, users, non-existent, private, and tiny channels.
 * Returns validated channels with title and subscriber count.
 */
export async function validateDiscoveredChannels(
  candidates: Array<{ username: string; mentionCount: number }>,
  maxResults: number = 5,
  minSubscribers: number = 100
): Promise<Array<{ username: string; mentionCount: number; title: string; subscriberCount: number }>> {
  const validated: Array<{ username: string; mentionCount: number; title: string; subscriberCount: number }> = [];

  // Check top-25 candidates at most
  const toCheck = candidates.slice(0, 25);

  for (let i = 0; i < toCheck.length; i++) {
    const candidate = toCheck[i];

    // Rate limiting: pause between API calls (skip before first)
    if (i > 0) {
      await delay(1500);
    }

    try {
      const info = await getChannelInfo(candidate.username);
      if (!info) {
        log.info(`Discovery: @${candidate.username} — not a channel (bot/user/private/404)`);
        continue;
      }

      if (info.subscriberCount < minSubscribers) {
        log.info(`Discovery: @${candidate.username} — too small (${info.subscriberCount} subscribers)`);
        continue;
      }

      validated.push({
        username: candidate.username,
        mentionCount: candidate.mentionCount,
        title: info.title,
        subscriberCount: info.subscriberCount,
      });

      log.info(`Discovery: @${candidate.username} ✓ (${info.title}, ${info.subscriberCount} subs)`);

      // Early exit once we have enough
      if (validated.length >= maxResults) break;
    } catch (err) {
      log.warn(`Discovery: failed to validate @${candidate.username}:`, err);
    }
  }

  log.info(`Discovery validation: ${validated.length}/${toCheck.length} candidates passed`);
  return validated;
}
