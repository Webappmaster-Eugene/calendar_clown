import {
  getUserMode as getDbUserMode,
  setUserMode as setDbUserMode,
} from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";

export type UserMode = "calendar" | "expenses" | "transcribe" | "simplifier" | "digest" | "broadcast" | "notable_dates" | "gandalf" | "neuro" | "wishlist" | "goals" | "reminders" | "osint" | "summarizer" | "blogger" | "nutritionist" | "admin" | "tasks";

// A single incoming message triggers a chain of up to ~18 sequential isXMode()
// checks; without caching each is its own SELECT round-trip (~100 ms RTT ⇒ ~2 s
// of latency per message). TTL is a safety net for write paths that bypass both
// setUserMode (write-through) and invalidateUserModeCache (Mini App switchMode).
const CACHE_TTL_MS = 60_000;
const modeCache = new Map<number, { mode: UserMode; expiresAt: number }>();

export function invalidateUserModeCache(telegramId: number): void {
  modeCache.delete(telegramId);
}

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

export async function setUserMode(telegramId: number, mode: UserMode): Promise<void> {
  if (!isDatabaseAvailable()) return;
  await setDbUserMode(telegramId, mode);
  modeCache.set(telegramId, { mode, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function isCalendarMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "calendar";
}

export async function isExpenseMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "expenses";
}

export async function isTranscribeMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "transcribe";
}

export async function isBroadcastMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "broadcast";
}

export async function isNotableDatesMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "notable_dates";
}

export async function isDigestMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "digest";
}

export async function isGandalfMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "gandalf";
}

export async function isNeuroMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "neuro";
}

export async function isWishlistMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "wishlist";
}

export async function isGoalsMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "goals";
}

export async function isRemindersMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "reminders";
}

export async function isOsintMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "osint";
}

export async function isSummarizerMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "summarizer";
}

export async function isBloggerMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "blogger";
}

export async function isTasksMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "tasks";
}

export async function isSimplifierMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "simplifier";
}

export async function isNutritionistMode(telegramId: number): Promise<boolean> {
  const mode = await getUserMode(telegramId);
  return mode === "nutritionist";
}
