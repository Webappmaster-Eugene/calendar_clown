import {
  getUserMode as getDbUserMode,
  setUserMode as setDbUserMode,
} from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";

export type UserMode = "calendar" | "expenses" | "transcribe" | "digest";

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
