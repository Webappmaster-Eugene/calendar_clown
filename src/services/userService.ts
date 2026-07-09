/**
 * User service — profile, mode switching, access control.
 * Extracted from middleware/auth.ts and bot.ts.
 */
import { getUserMenuContext, canAccessMode, isBootstrapAdmin } from "../middleware/auth.js";
import { invalidateUserModeCache } from "../middleware/userMode.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { query } from "../db/connection.js";
import { hasToken } from "../calendar/auth.js";
import { createLogger } from "../utils/logger.js";
import type { UserProfile, UserMode } from "../shared/types.js";

const log = createLogger("user-service");

export async function getUserProfile(telegramId: number, firstName: string, username?: string): Promise<UserProfile | null> {
  if (!isDatabaseAvailable()) {
    // Fallback for bootstrap admin
    if (isBootstrapAdmin(telegramId)) {
      const calendarLinked = await hasToken(String(telegramId));
      return {
        telegramId,
        username: username ?? null,
        firstName,
        role: "admin",
        status: "approved",
        mode: "calendar",
        hasTribe: false,
        tribeId: null,
        tribeName: null,
        hasCalendarLinked: calendarLinked,
        isAdmin: true,
      };
    }
    return null;
  }

  const menuCtx = await getUserMenuContext(telegramId);
  if (!menuCtx) return null;

  const { rows } = await query<{ mode: string }>(
    "SELECT COALESCE(mode, 'calendar') AS mode FROM users WHERE telegram_id = $1",
    [telegramId]
  );
  const mode = (rows[0]?.mode ?? "calendar") as UserMode;
  const calendarLinked = await hasToken(String(telegramId));

  return {
    telegramId,
    username: username ?? null,
    firstName,
    role: menuCtx.role,
    status: menuCtx.status as "pending" | "approved",
    mode,
    hasTribe: menuCtx.hasTribe,
    tribeId: menuCtx.tribeId,
    tribeName: menuCtx.tribeName,
    hasCalendarLinked: calendarLinked,
    isAdmin: isBootstrapAdmin(telegramId),
  };
}

export async function switchMode(telegramId: number, newMode: UserMode): Promise<void> {
  if (!isDatabaseAvailable()) {
    throw new Error("Database unavailable");
  }

  const menuCtx = await getUserMenuContext(telegramId);
  if (!menuCtx) {
    throw new Error("User not found");
  }

  if (!canAccessMode(newMode, menuCtx)) {
    throw new Error(`No access to mode: ${newMode}`);
  }

  await query("UPDATE users SET mode = $1 WHERE telegram_id = $2", [newMode, telegramId]);
  invalidateUserModeCache(telegramId);
  log.info(`User ${telegramId} switched mode to ${newMode}`);
}

export function getAvailableModes(profile: UserProfile): UserMode[] {
  const allModes: UserMode[] = [
    "calendar", "expenses", "transcribe", "simplifier", "digest", "gandalf", "neuro",
    "goals", "reminders", "wishlist", "notable_dates", "osint", "tasks",
    "summarizer", "blogger", "nutritionist", "broadcast", "admin",
  ];

  return allModes.filter((mode) =>
    canAccessMode(mode, {
      role: profile.role,
      status: profile.status,
      hasTribe: profile.hasTribe,
      tribeId: profile.tribeId,
      tribeName: profile.tribeName,
    })
  );
}
