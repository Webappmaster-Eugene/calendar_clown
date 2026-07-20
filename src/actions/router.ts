/**
 * NL router for `/do`. Two-stage, JSON-in-prompt (openRouterClient has no native
 * tool-calling), mirroring the existing extract*Intent pattern:
 *   A) pick an action from the accessible catalog;
 *   B) fill its arguments against the action's JSON Schema, validated by the
 *      same Zod schema (single source of truth) with one self-repair retry.
 * The LLM call is injectable so the routing logic is unit-testable without network.
 */
import type { Action } from "./types.js";
import type { UserMenuContext } from "../shared/auth.js";
import { getActions, getAction } from "./registry.js";
import { actionArgsJsonSchema, toCatalog } from "./schema.js";
import { tryParseJson } from "../utils/parseJson.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import { DEEPSEEK_MODEL } from "../constants.js";

/** Injectable LLM completion: (systemPrompt, userText) → raw model text. */
export type LlmComplete = (system: string, user: string) => Promise<string | null>;

const DO_ROUTER_MODEL = process.env.DO_ROUTER_MODEL || DEEPSEEK_MODEL;

const defaultLlm: LlmComplete = (system, user) =>
  callOpenRouter({
    model: DO_ROUTER_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

export type RouteOutcome =
  | { kind: "ok"; action: Action; args: unknown }
  | { kind: "no_action"; reason: string }
  | { kind: "invalid_args"; action: Action; reason: string };

/** Short MSK date context so the model can resolve relative deadlines/times. */
function dateContext(now: Date): string {
  const msk = new Date(now.getTime() + 3 * 3600_000);
  const today = msk.toISOString().slice(0, 10);
  const tomorrow = new Date(msk.getTime() + 24 * 3600_000).toISOString().slice(0, 10);
  return `Сегодня ${today}, таймзона Europe/Moscow (UTC+3). Завтра ${tomorrow}. Даты/времена — со смещением +03:00.`;
}

/** Stage A: choose an accessible action name for the user's text. */
export async function selectAction(
  text: string,
  menu: UserMenuContext,
  llm: LlmComplete,
): Promise<Action | null> {
  const accessible = getActions(menu);
  const catalog = toCatalog(accessible);
  const system =
    "Ты — маршрутизатор команд. По тексту пользователя выбери ОДНО действие из каталога, " +
    "которое он хочет выполнить. Отвечай ТОЛЬКО валидным JSON без пояснений: " +
    '{"action":"<точное имя из каталога>"} или {"action":null} если ничего не подходит.\n\n' +
    "Каталог действий (name — description):\n" +
    catalog.map((c) => `- ${c.name} — ${c.title}: ${c.description}`).join("\n");
  const raw = await llm(system, text);
  const parsed = tryParseJson(raw ?? "");
  const name = parsed?.action;
  if (typeof name !== "string") return null;
  const action = getAction(name);
  // Must be a real, accessible action.
  if (!action || !accessible.some((a) => a.name === action.name)) return null;
  return action;
}

/** Stage B: fill + validate arguments for the chosen action (one self-repair). */
export async function fillArgs(
  text: string,
  action: Action,
  llm: LlmComplete,
  now: Date = new Date(),
): Promise<{ ok: true; args: unknown } | { ok: false; error: string }> {
  const schema = actionArgsJsonSchema(action);
  const baseSystem =
    `Заполни аргументы для действия "${action.name}" (${action.humanTitle}: ${action.description}).\n` +
    `${dateContext(now)}\n` +
    `JSON Schema аргументов:\n${JSON.stringify(schema)}\n` +
    "Ответь ТОЛЬКО валидным JSON-объектом аргументов, без пояснений. " +
    "Не выдумывай id — если id/itemId не указан явно и его нет в тексте, не заполняй объект наугад.";

  const attempt = async (system: string): Promise<{ ok: boolean; args?: unknown; issues?: string }> => {
    const raw = await llm(system, text);
    const parsed = tryParseJson(raw ?? "") ?? {};
    const res = action.argsSchema.safeParse(parsed);
    if (res.success) return { ok: true, args: res.data };
    return { ok: false, issues: res.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ") };
  };

  const first = await attempt(baseSystem);
  if (first.ok) return { ok: true, args: first.args };

  const repairSystem = `${baseSystem}\nПредыдущий ответ не прошёл валидацию: ${first.issues}. Исправь и верни корректный JSON.`;
  const second = await attempt(repairSystem);
  if (second.ok) return { ok: true, args: second.args };

  return { ok: false, error: second.issues ?? "не удалось разобрать аргументы" };
}

/** Full NL route: text → chosen action + validated args (or a reason it failed). */
export async function routeDo(
  text: string,
  menu: UserMenuContext,
  llm: LlmComplete = defaultLlm,
  now: Date = new Date(),
): Promise<RouteOutcome> {
  const action = await selectAction(text, menu, llm);
  if (!action) return { kind: "no_action", reason: "Не понял, какое действие выполнить." };
  const filled = await fillArgs(text, action, llm, now);
  if (!filled.ok) return { kind: "invalid_args", action, reason: filled.error };
  return { kind: "ok", action, args: filled.args };
}
