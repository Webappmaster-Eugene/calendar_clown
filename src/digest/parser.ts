import type { RawChannelPost } from "./types.js";

const WEIGHT_VIEWS = 0.3;
const WEIGHT_FORWARDS = 2.0;
const WEIGHT_REACTIONS = 1.5;
const WEIGHT_COMMENTS = 1.0;

export const DEFAULT_DIGEST_SIZE = 20;

export const MAX_DIGEST_SIZE = 50;

export const MIN_DIGEST_SIZE = 1;

export function calculateEngagement(post: RawChannelPost): number {
  return (
    post.views * WEIGHT_VIEWS +
    post.forwards * WEIGHT_FORWARDS +
    post.reactionsCount * WEIGHT_REACTIONS +
    post.commentsCount * WEIGHT_COMMENTS
  );
}

function deduplicatePosts(posts: RawChannelPost[]): RawChannelPost[] {
  const seen = new Set<string>();
  const result: RawChannelPost[] = [];

  for (const post of posts) {
    const key = post.text.slice(0, 200).toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(post);
  }

  return result;
}

export function selectTopPosts(
  posts: RawChannelPost[],
  size: number = DEFAULT_DIGEST_SIZE
): Array<RawChannelPost & { engagementScore: number }> {
  const clampedSize = Math.max(MIN_DIGEST_SIZE, Math.min(MAX_DIGEST_SIZE, size));

  const unique = deduplicatePosts(posts);

  const scored = unique.map((post) => ({
    ...post,
    engagementScore: calculateEngagement(post),
  }));

  scored.sort((a, b) => b.engagementScore - a.engagementScore);

  // Cap at 3 posts per channel so one channel can't dominate the digest.
  const selected: typeof scored = [];
  const channelCounts = new Map<string, number>();

  for (const post of scored) {
    const count = channelCounts.get(post.channelUsername) ?? 0;
    if (count >= 3) continue;
    channelCounts.set(post.channelUsername, count + 1);
    selected.push(post);
    if (selected.length >= clampedSize) break;
  }

  return selected;
}
