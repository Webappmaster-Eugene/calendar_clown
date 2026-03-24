/**
 * Telegram Mini App initData validation middleware for Hono.
 *
 * Validates the HMAC signature per Telegram's spec:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
import { createHmac } from "crypto";
import type { Context, Next } from "hono";
import { createLogger } from "../utils/logger.js";
import { getUserMenuContext, isBootstrapAdmin, canAccessMode } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { hasToken } from "../calendar/auth.js";
import type { UserProfile, UserMode } from "../shared/types.js";

const log = createLogger("api-auth");

/** Max age for initData in seconds (24 hours). 0 = no expiry check. */
const INIT_DATA_MAX_AGE_SECONDS = 86400;

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface InitDataParsed {
  user: TelegramUser;
  authDate: number;
  hash: string;
  queryId?: string;
  raw: string;
}

/**
 * Validate Telegram Mini App initData HMAC signature.
 * Returns parsed data or null if invalid.
 */
export function validateInitData(initDataRaw: string, botToken: string): InitDataParsed | null {
  try {
    const params = new URLSearchParams(initDataRaw);
    const hash = params.get("hash");
    if (!hash) return null;

    // Build data-check-string: sort all params except hash, join with \n
    params.delete("hash");
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    // HMAC-SHA256(secret_key, data_check_string) where secret_key = HMAC-SHA256("WebAppData", bot_token)
    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (computedHash !== hash) {
      log.warn("initData HMAC mismatch");
      return null;
    }

    // Check expiry
    const authDateStr = params.get("auth_date");
    if (!authDateStr) return null;
    const authDate = parseInt(authDateStr, 10);

    if (INIT_DATA_MAX_AGE_SECONDS > 0) {
      const now = Math.floor(Date.now() / 1000);
      if (now - authDate > INIT_DATA_MAX_AGE_SECONDS) {
        log.warn("initData expired, auth_date=%d, age=%ds", authDate, now - authDate);
        return null;
      }
    }

    // Parse user
    const userStr = params.get("user");
    if (!userStr) return null;

    const user: TelegramUser = JSON.parse(userStr);
    if (!user.id || !user.first_name) return null;

    return {
      user,
      authDate,
      hash,
      queryId: params.get("query_id") ?? undefined,
      raw: initDataRaw,
    };
  } catch (err) {
    log.error("Failed to validate initData: %s", (err as Error).message);
    return null;
  }
}

/** Hono Environment type — use as generic parameter in Hono<ApiEnv> */
export interface ApiEnv {
  Variables: {
    initData: InitDataParsed;
    userProfile: UserProfile | null;
  };
}

/**
 * Hono middleware: validate Authorization header and attach user data.
 * Header format: "tma <initDataRaw>"
 */
export function apiAuthMiddleware() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required for API auth");
  }

  return async (c: Context<ApiEnv>, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ ok: false, error: "Missing Authorization header" }, 401);
    }

    const match = authHeader.match(/^tma\s+(.+)$/i);
    if (!match) {
      return c.json({ ok: false, error: "Invalid Authorization format. Expected: tma <initData>" }, 401);
    }

    const initData = validateInitData(match[1], botToken);
    if (!initData) {
      return c.json({ ok: false, error: "Invalid or expired initData" }, 401);
    }

    c.set("initData", initData);

    // Build user profile from DB
    let userProfile: UserProfile | null = null;
    const telegramId = initData.user.id;

    if (isDatabaseAvailable()) {
      const menuCtx = await getUserMenuContext(telegramId);
      if (menuCtx) {
        const calendarLinked = await hasToken(String(telegramId));
        // Get current mode from DB
        const { query: dbQuery } = await import("../db/connection.js");
        const { rows } = await dbQuery<{ mode: string }>(
          "SELECT COALESCE(mode, 'calendar') AS mode FROM users WHERE telegram_id = $1",
          [telegramId]
        );
        const mode = (rows[0]?.mode ?? "calendar") as UserMode;

        userProfile = {
          telegramId,
          username: initData.user.username ?? null,
          firstName: initData.user.first_name,
          role: menuCtx.role,
          status: menuCtx.status as "pending" | "approved",
          mode,
          hasTribe: menuCtx.hasTribe,
          tribeId: menuCtx.tribeId,
          tribeName: menuCtx.tribeName,
          hasCalendarLinked: calendarLinked,
        };
      }
    }

    // Bootstrap admin fallback when DB is unavailable
    if (!userProfile && isBootstrapAdmin(telegramId)) {
      const calendarLinked = await hasToken(String(telegramId));
      userProfile = {
        telegramId,
        username: initData.user.username ?? null,
        firstName: initData.user.first_name,
        role: "admin",
        status: "approved",
        mode: "calendar",
        hasTribe: false,
        tribeId: null,
        tribeName: null,
        hasCalendarLinked: calendarLinked,
      };
    }

    c.set("userProfile", userProfile);
    await next();
  };
}

/**
 * Hono middleware: require approved user status.
 * Must be used after apiAuthMiddleware.
 */
export function requireApproved() {
  return async (c: Context<ApiEnv>, next: Next) => {
    const profile = c.get("userProfile");
    if (!profile) {
      return c.json({ ok: false, error: "User not registered. Use the bot first." }, 403);
    }
    if (profile.status !== "approved") {
      return c.json({ ok: false, error: "Account pending approval" }, 403);
    }
    await next();
  };
}

/**
 * Hono middleware: require specific mode access.
 * Must be used after apiAuthMiddleware.
 */
export function requireModeAccess(mode: string) {
  return async (c: Context<ApiEnv>, next: Next) => {
    const profile = c.get("userProfile");
    if (!profile) {
      return c.json({ ok: false, error: "User not registered" }, 403);
    }

    const menuCtx = {
      role: profile.role,
      status: profile.status,
      hasTribe: profile.hasTribe,
      tribeId: profile.tribeId,
      tribeName: profile.tribeName,
    };

    if (!canAccessMode(mode, menuCtx)) {
      return c.json({ ok: false, error: `No access to mode: ${mode}` }, 403);
    }

    await next();
  };
}
