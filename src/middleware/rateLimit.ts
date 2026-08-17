import { RATE_LIMIT_PER_MINUTE } from "../constants.js";

/** In-memory rate limiter per user. Tracks timestamps of recent actions. */
const userActions = new Map<number, number[]>();

/** Check if user is within rate limit. Returns true if allowed. */
export function checkRateLimit(telegramId: number): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const timestamps = userActions.get(telegramId) ?? [];

  const recent = timestamps.filter((t) => now - t < windowMs);

  if (recent.length >= RATE_LIMIT_PER_MINUTE) {
    userActions.set(telegramId, recent);
    return false;
  }

  recent.push(now);
  userActions.set(telegramId, recent);
  return true;
}

/** Separate, tighter bucket for actions that spend money upstream (STT, vision,
 *  web search, long LLM generations). The general limiter above guards message
 *  bursts; this one guards the bill, so an approved account — or a stranger during a
 *  DB outage, when access control fails open — cannot drain credits by spamming
 *  voice notes or documents. */
const costlyActions = new Map<number, number[]>();

export const COSTLY_ACTIONS_PER_MINUTE = 15;

export function checkCostlyRateLimit(telegramId: number): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const recent = (costlyActions.get(telegramId) ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= COSTLY_ACTIONS_PER_MINUTE) {
    costlyActions.set(telegramId, recent);
    return false;
  }

  recent.push(now);
  costlyActions.set(telegramId, recent);
  return true;
}

export const COSTLY_LIMIT_MESSAGE =
  "⏳ Слишком много запросов подряд. Подождите минуту — это ограничение защищает от перерасхода.";
