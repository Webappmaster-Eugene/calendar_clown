/**
 * Action Registry — single declarative description of an operation that powers
 * every control surface (bot `/do`, MCP tools, JSON/Markdown render, text
 * parity). Handlers are thin wrappers over the existing service layer.
 */
import type { z } from "zod";
import type { UserMenuContext } from "../shared/auth.js";

export type ModeName =
  | "calendar" | "expenses" | "transcribe" | "simplifier" | "digest"
  | "broadcast" | "notable_dates" | "gandalf" | "neuro" | "wishlist"
  | "goals" | "reminders" | "osint" | "summarizer" | "blogger"
  | "nutritionist" | "admin" | "tasks";

/** Operations that cannot be fully driven by plain text (need a UI/binary channel). */
export type RequiresUI = "photo" | "file" | "auth" | "stream";

export interface ActionCtx {
  telegramId: number;
  menu: UserMenuContext;
}

/** `data` is the raw DTO (with ids) for machine/JSON output. */
export interface ActionResult {
  data: unknown;
  /** Optional human rendering; surfaces fall back to a generic renderer. */
  markdown?: string;
}

export interface Action<A = unknown> {
  /** Stable id, `<mode>.<verb>` (e.g. "reminders.create"). */
  name: string;
  mode: ModeName;
  humanTitle: string;
  /** For LLM routing and MCP tool descriptions. */
  description: string;
  argsSchema: z.ZodType<A>;
  /** Write action → requires confirmation in `/do`. */
  mutates: boolean;
  /** LLM/STT/OSINT — subject to a stricter rate bucket. */
  heavy?: boolean;
  requiresUI?: RequiresUI;
  handler: (ctx: ActionCtx, args: A) => Promise<ActionResult>;
  renderMarkdown?: (result: ActionResult) => string;
}

/**
 * Author an action with argument types inferred from its Zod schema. The
 * concrete arg type is erased to `unknown` for uniform storage in the registry;
 * `dispatch` re-parses raw args through `argsSchema` before calling the handler.
 */
export function defineAction<S extends z.ZodType>(spec: {
  name: string;
  mode: ModeName;
  humanTitle: string;
  description: string;
  argsSchema: S;
  mutates: boolean;
  heavy?: boolean;
  requiresUI?: RequiresUI;
  handler: (ctx: ActionCtx, args: z.infer<S>) => Promise<ActionResult>;
  renderMarkdown?: (result: ActionResult) => string;
}): Action {
  return spec as unknown as Action;
}
