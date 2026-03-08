import type { Context } from "telegraf";

let adminIds: Set<number> | null = null;

function parseAdminIds(): Set<number> {
  if (adminIds) return adminIds;
  const raw = process.env.ADMIN_USER_IDS?.trim() ?? "";
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
  adminIds = new Set(ids);
  return adminIds;
}

/**
 * Check if the user who sent the update is a trusted admin (user ID in ADMIN_USER_IDS).
 */
export function isAdmin(ctx: Context): boolean {
  const fromId = ctx.from?.id;
  if (fromId == null) return false;
  return parseAdminIds().has(fromId);
}
