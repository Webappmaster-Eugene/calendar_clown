// In-memory only — fine for a single-process bot. If/when we shard horizontally,
// swap the Map for a Redis INCR + EXPIRE.

import type { Context, Next } from "hono";
import type { ApiEnv } from "./authMiddleware.js";

interface BucketState {
  hits: number[];
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  bucket: string;
}

const buckets = new Map<string, BucketState>();

// Periodic GC of empty buckets so memory doesn't grow unbounded.
let gcTimer: ReturnType<typeof setInterval> | null = null;
function ensureGc(): void {
  if (gcTimer) return;
  gcTimer = setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, b] of buckets) {
      if (b.hits.length === 0 || b.hits[b.hits.length - 1] < cutoff) {
        buckets.delete(key);
      }
    }
  }, 60_000);
  gcTimer.unref?.();
}

export function rateLimit(opts: RateLimitOptions) {
  ensureGc();
  return async (c: Context<ApiEnv>, next: Next) => {
    const initData = c.get("initData");
    const telegramId = initData?.user?.id;
    if (telegramId == null) {
      // apiAuthMiddleware runs first, so this should never happen.
      await next();
      return;
    }

    const key = `${opts.bucket}:${telegramId}`;
    const now = Date.now();
    const cutoff = now - opts.windowMs;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { hits: [] };
      buckets.set(key, bucket);
    }

    while (bucket.hits.length > 0 && bucket.hits[0] < cutoff) {
      bucket.hits.shift();
    }

    if (bucket.hits.length >= opts.max) {
      const retryAfterMs = bucket.hits[0] + opts.windowMs - now;
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
      c.header("Retry-After", String(retryAfterSec));
      return c.json(
        { ok: false, error: "Too many requests. Try again in a moment.", retryAfterSec },
        429,
      );
    }

    bucket.hits.push(now);
    await next();
  };
}
