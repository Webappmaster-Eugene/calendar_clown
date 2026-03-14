/**
 * Channel discovery: find new channels from forwarded messages
 * in already-tracked channels.
 */

import type { RawChannelPost } from "./types.js";
import { createLogger } from "../utils/logger.js";

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
    if (["joinchat", "addstickers", "share", "proxy", "socks"].includes(username)) continue;
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
