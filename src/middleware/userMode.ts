import {
  getUserMode as getDbUserMode,
  setUserMode as setDbUserMode,
} from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";

export type UserMode = "calendar" | "expenses" | "transcribe" | "simplifier" | "digest" | "broadcast" | "notable_dates" | "gandalf" | "neuro" | "wishlist" | "goals" | "reminders" | "osint" | "summarizer" | "blogger" | "nutritionist" | "admin" | "tasks";

/**
 * In-memory cache of user modes.
 *
 * A single incoming message triggers a chain of up to ~18 sequential
 * `isXMode()` checks (see the text/voice routers in bot.ts). Without caching,
 * each check is its own `SELECT mode FROM users` round-trip — brutal against a
 * remote database (~100 ms RTT ⇒ ~2 s of pure latency per message).
 *
 * All bot-side writes go through `setUserMode` (write-through below). The Mini
 * App changes the mode via `userService.switchMode`, which calls
 * `invalidateUserModeCache`. The TTL is a safety net for any write path that
 * bypasses both (e.g. manual DB edits): stale entries self-heal within it.
 */
const CACHE_TTL_MS = 60_000;
const modeCache = new Map<number, { mode: UserMode; expiresAt: number }>();

/** Drop the cached mode for a user (call after an out-of-band mode write). */
export function invalidateUserModeCache(telegramId: number): void {
  modeCache.delete(telegramId);
}

/** Get user's current mode from DB (cached). Falls back to 'calendar'. */
export async function getUserMode(telegramId: number): Promise<UserMode> {
  if (!isDatabaseAvailable()) return "calendar";

  const cached = modeCache.get(telegramId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.mode;
  }

  try {
    const mode = await getDbUserMode(telegramId);
    modeCache.set(telegramId, { mode, expiresAt: Date.now() + CACHE_TTL_MS });
    return mode;
  } catch {
    return "calendar";
  }
}

/** Set user's mode in DB and refresh the cache (write-through). */
export async function setUserMode(telegramId: number, mode: UserMode): Promise<void> {
  if (!isDatabaseAvailable()) return;
  await setDbUserMode(telegramId, mode);
  modeCache.set(telegramId, { mode, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Check if user is in calendar mode. */
export async function isCalendarMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "calendar";
}

/** Check if user is in expense mode. */
export async function isExpenseMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "expenses";
}

/** Check if user is in transcribe mode. */
export async function isTranscribeMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "transcribe";
}

/** Check if user is in broadcast mode. */
export async function isBroadcastMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "broadcast";
}

/** Check if user is in notable dates mode. */
export async function isNotableDatesMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "notable_dates";
}

/** Check if user is in digest mode. */
export async function isDigestMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "digest";
}

/** Check if user is in gandalf mode. */
export async function isGandalfMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "gandalf";
}

/** Check if user is in neuro mode. */
export async function isNeuroMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "neuro";
}

/** Check if user is in wishlist mode. */
export async function isWishlistMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "wishlist";
}

/** Check if user is in goals mode. */
export async function isGoalsMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "goals";
}

/** Check if user is in reminders mode. */
export async function isRemindersMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "reminders";
}

/** Check if user is in OSINT mode. */
export async function isOsintMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "osint";
}

/** Check if user is in summarizer mode. */
export async function isSummarizerMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "summarizer";
}

/** Check if user is in blogger mode. */
export async function isBloggerMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "blogger";
}

/** Check if user is in tasks mode. */
export async function isTasksMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "tasks";
}

/** Check if user is in simplifier mode. */
export async function isSimplifierMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "simplifier";
}

/** Check if user is in nutritionist mode. */
export async function isNutritionistMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "nutritionist";
}
