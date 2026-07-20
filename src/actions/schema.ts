import { zodToJsonSchema } from "zod-to-json-schema";
import type { Action } from "./types.js";

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

export function toCatalog(actions: Action[]): CatalogEntry[] {
  return actions.map((a) => ({
    name: a.name,
    mode: a.mode,
    title: a.humanTitle,
    description: a.description,
    mutates: a.mutates,
  }));
}
