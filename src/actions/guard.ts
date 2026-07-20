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

// For surfaces (MCP) that don't already have a middleware-verified principal.
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

// Handler errors (human-readable Russian messages from services) propagate as-is
// for the surface to render; only guard failures throw ActionError.
export async function executeAction(
  action: Action,
  ctx: ActionCtx,
  rawArgs: unknown,
): Promise<ActionResult> {
  if (!canAccessMode(action.mode, ctx.menu)) {
    throw new ActionError("ACCESS_DENIED", `Нет доступа к режиму «${action.mode}».`);
  }

  // Only heavy actions (LLM/STT/OSINT) use the strict expense-style bucket; plain
  // CRUD is left unthrottled so an agent isn't hobbled by the 10/min limiter.
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
