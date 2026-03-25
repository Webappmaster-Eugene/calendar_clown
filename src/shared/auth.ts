/**
 * Shared auth utilities used by both bot middleware and API middleware.
 * This is the single source of truth for mode access control.
 */
import {
  INDIVIDUAL_MODES as INDIVIDUAL_MODES_ARR,
  TRIBE_MODES as TRIBE_MODES_ARR,
  ADMIN_MODES as ADMIN_MODES_ARR,
} from "./constants.js";

export interface UserMenuContext {
  role: "admin" | "user";
  status: string;
  hasTribe: boolean;
  tribeId: number | null;
  tribeName: string | null;
}

/** Set-versions of mode arrays for O(1) lookups in canAccessMode. */
const INDIVIDUAL_MODES = new Set<string>(INDIVIDUAL_MODES_ARR);
const TRIBE_MODES = new Set<string>(TRIBE_MODES_ARR);
const ADMIN_MODES = new Set<string>(ADMIN_MODES_ARR);

/** Check if a user can access a given mode based on their context. */
export function canAccessMode(mode: string, context: UserMenuContext): boolean {
  if (ADMIN_MODES.has(mode)) return context.role === "admin";
  if (TRIBE_MODES.has(mode)) return context.hasTribe;
  return true; // INDIVIDUAL_MODES or unknown modes — allow
}
