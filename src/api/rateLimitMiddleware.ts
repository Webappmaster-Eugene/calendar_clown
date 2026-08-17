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

/** Client IP as seen behind Traefik. Only used for rate-limit keying — a spoofed
 *  header can shift an attacker between buckets but never grants extra quota to a
 *  real user, and the socket address is the fallback. */
function clientIp(c: Context<ApiEnv>): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip")?.trim() || "unknown";
}

const AUTH_FAILURE_WINDOW_MS = 60_000;
const AUTH_FAILURE_MAX = 30;

/** Bounds 401 floods, which the per-user limiters cannot see (they can only key on
 *  an already-validated initData).
 *
 *  Deliberately called only AFTER a signature check has failed, and never consulted
 *  for a request that validates: mobile carriers put thousands of users behind one
 *  CGNAT address, so blocking an address outright would let one abuser lock out
 *  every real user sharing it. Verifying a signature is a single HMAC, so letting
 *  valid traffic through unthrottled costs nothing.
 *
 *  Returns true when this address is over the limit. */
export function recordAuthFailure(c: Context<ApiEnv>): { limited: boolean; retryAfterSec: number } {
  ensureGc();
  const key = `authfail:${clientIp(c)}`;
  const now = Date.now();
  const cutoff = now - AUTH_FAILURE_WINDOW_MS;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  while (bucket.hits.length > 0 && bucket.hits[0] < cutoff) bucket.hits.shift();
  bucket.hits.push(now);

  if (bucket.hits.length <= AUTH_FAILURE_MAX) return { limited: false, retryAfterSec: 0 };
  return {
    limited: true,
    retryAfterSec: Math.max(1, Math.ceil((bucket.hits[0] + AUTH_FAILURE_WINDOW_MS - now) / 1000)),
  };
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
