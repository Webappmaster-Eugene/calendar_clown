/**
 * Render an ActionResult for a surface: machine JSON (fenced) or human Markdown.
 * The human path always surfaces entity ids so the user/agent can address
 * follow-up edits/deletes.
 */
import type { Action, ActionResult } from "./types.js";

const MAX_ITEMS = 30;

/** Pick a human-facing label field from a DTO. */
function label(item: Record<string, unknown>): string {
  for (const key of ["text", "name", "title", "summary", "humanTitle"]) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function renderItem(item: unknown): string {
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    const id = o.id ?? o.itemId;
    const lbl = label(o);
    const idPart = id != null ? `#${id}` : "";
    return `• ${[idPart, lbl].filter(Boolean).join(" ")}`.trimEnd() || `• ${JSON.stringify(o)}`;
  }
  return `• ${String(item)}`;
}

function genericMarkdown(action: Action, data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return `${action.humanTitle}: пусто.`;
    const lines = data.slice(0, MAX_ITEMS).map(renderItem);
    const more = data.length > MAX_ITEMS ? `\n…и ещё ${data.length - MAX_ITEMS}` : "";
    return `*${action.humanTitle}* (${data.length}):\n${lines.join("\n")}${more}`;
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const id = o.id ?? o.itemId;
    const lbl = label(o);
    const head = `✅ ${action.humanTitle}`;
    const idLine = id != null ? ` #${id}` : "";
    return `${head}${idLine}${lbl ? `: ${lbl}` : ""}`;
  }
  return `✅ ${action.humanTitle}`;
}

/** Render for the chosen surface. `json` → fenced machine payload with ids. */
export function renderResult(action: Action, result: ActionResult, opts: { json?: boolean }): string {
  if (opts.json) {
    return "```json\n" + JSON.stringify(result.data, null, 2) + "\n```";
  }
  if (result.markdown) return result.markdown;
  if (action.renderMarkdown) return action.renderMarkdown(result);
  return genericMarkdown(action, result.data);
}
