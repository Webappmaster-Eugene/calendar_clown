import { RATE_LIMIT_PER_MINUTE } from "../constants.js";

/** In-memory rate limiter per user. Tracks timestamps of recent actions. */
const userActions = new Map<number, number[]>();

/** Check if user is within rate limit. Returns true if allowed. */
export function checkRateLimit(telegramId: number): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const timestamps = userActions.get(telegramId) ?? [];

  // Remove expired entries
  const recent = timestamps.filter((t) => now - t < windowMs);

  if (recent.length >= RATE_LIMIT_PER_MINUTE) {
    userActions.set(telegramId, recent);
    return false;
  }

  recent.push(now);
  userActions.set(telegramId, recent);
  return true;
}
