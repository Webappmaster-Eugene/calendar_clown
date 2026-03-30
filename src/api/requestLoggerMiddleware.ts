/**
 * Hono middleware: logs every API request to action_logs.
 * Must be registered AFTER apiAuthMiddleware so initData is available.
 */
import type { Context, Next } from "hono";
import type { ApiEnv } from "./authMiddleware.js";
import { logAction } from "../logging/actionLogger.js";

export function requestLoggerMiddleware() {
  return async (c: Context<ApiEnv>, next: Next) => {
    const start = Date.now();
    await next();
    const durationMs = Date.now() - start;

    try {
      const initData = c.get("initData");
      const telegramId = initData?.user?.id ?? null;

      logAction(null, telegramId, "api_request", {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs,
      });
    } catch {
      // Never throw from logging middleware
    }
  };
}
