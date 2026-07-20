/**
 * Single guard + execution pipeline shared by every surface that runs actions
 * (`/do`, MCP, future retrofit into REST). Reuses the existing access, rate-limit
 * and audit primitives — no new access mechanisms.
 */
import { ZodError } from "zod";
import type { Action, ActionCtx, ActionResult } from "./types.js";
import { canAccessMode } from "../shared/auth.js";
import { getUserMenuContext } from "../middleware/auth.js";
import { checkRateLimit } from "../middleware/rateLimit.js";
import { logApiAction } from "../logging/actionLogger.js";

export type ActionErrorCode =
  | "NOT_APPROVED" | "ACCESS_DENIED" | "RATE_LIMITED" | "INVALID_ARGS" | "FAILED";

export class ActionError extends Error {
  constructor(public readonly code: ActionErrorCode, message: string) {
    super(message);
    this.name = "ActionError";
  }
}

/**
 * Resolve the acting user into an ActionCtx, enforcing approved access. Used by
 * surfaces that don't already have a middleware-verified principal (MCP).
 */
export async function resolveActor(telegramId: number): Promise<ActionCtx> {
  const menu = await getUserMenuContext(telegramId);
  if (!menu) {
    throw new ActionError("NOT_APPROVED", "Пользователь не найден или нет доступа.");
  }
  if (menu.role !== "admin" && menu.status !== "approved") {
    throw new ActionError("NOT_APPROVED", "Доступ не подтверждён.");
  }
  return { telegramId, menu };
}

/**
 * Validate args, enforce mode access + rate limit for writes, run the handler,
 * and audit. Throws ActionError on guard failure; handler errors (human-readable
 * Russian messages from services) propagate as-is for the surface to render.
 */
export async function executeAction(
  action: Action,
  ctx: ActionCtx,
  rawArgs: unknown,
): Promise<ActionResult> {
  if (!canAccessMode(action.mode, ctx.menu)) {
    throw new ActionError("ACCESS_DENIED", `Нет доступа к режиму «${action.mode}».`);
  }

  // Only heavy actions (LLM/STT/OSINT) use the strict expense-style bucket. Plain
  // CRUD is cheap and left unthrottled here so an agent isn't hobbled by the 10/min
  // limiter; a dedicated per-actor write-rate-limit can be added later if needed.
  if (action.heavy) {
    if (!checkRateLimit(ctx.telegramId)) {
      throw new ActionError("RATE_LIMITED", "Слишком много запросов. Подождите минуту.");
    }
  }

  let args: unknown;
  try {
    args = action.argsSchema.parse(rawArgs ?? {});
  } catch (err) {
    const msg = err instanceof ZodError
      ? err.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")
      : "Неверные аргументы.";
    throw new ActionError("INVALID_ARGS", msg);
  }

  const result = await action.handler(ctx, args);
  logApiAction(ctx.telegramId, `action:${action.name}`, { args });
  return result;
}
