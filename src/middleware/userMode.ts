import {
  getUserMode as getDbUserMode,
  setUserMode as setDbUserMode,
} from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";

export type UserMode = "calendar" | "expenses" | "transcribe" | "digest" | "broadcast" | "notable_dates" | "gandalf" | "neuro" | "wishlist" | "goals" | "reminders" | "admin";

/** Get user's current mode from DB. Falls back to 'calendar'. */
export async function getUserMode(telegramId: number): Promise<UserMode> {
  if (!isDatabaseAvailable()) return "calendar";
  try {
    return await getDbUserMode(telegramId);
  } catch {
    return "calendar";
  }
}

/** Set user's mode in DB. */
export async function setUserMode(telegramId: number, mode: UserMode): Promise<void> {
  if (!isDatabaseAvailable()) return;
  await setDbUserMode(telegramId, mode);
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
