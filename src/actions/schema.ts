/**
 * Zod → JSON Schema for actions. Single serializer shared by the `/do` arg-fill
 * step and the MCP tool `inputSchema`.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Action } from "./types.js";

/** Draft-07 JSON Schema for an action's arguments (refs inlined for portability). */
export function actionArgsJsonSchema(action: Action): Record<string, unknown> {
  return zodToJsonSchema(action.argsSchema, { $refStrategy: "none", target: "jsonSchema7" }) as Record<string, unknown>;
}

export interface CatalogEntry {
  name: string;
  mode: string;
  title: string;
  description: string;
  mutates: boolean;
}

/** Compact catalog rows for LLM action selection (stage A). */
export function toCatalog(actions: Action[]): CatalogEntry[] {
  return actions.map((a) => ({
    name: a.name,
    mode: a.mode,
    title: a.humanTitle,
    description: a.description,
    mutates: a.mutates,
  }));
}
