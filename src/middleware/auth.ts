import type { Context, MiddlewareFn } from "telegraf";

function getAllowedUserIds(): Set<number> {
  const ids = new Set<number>();

  const adminId = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (adminId) {
    const parsed = parseInt(adminId, 10);
    if (!isNaN(parsed)) ids.add(parsed);
  }

  const allowedStr = process.env.ALLOWED_USER_IDS?.trim();
  if (allowedStr) {
    for (const raw of allowedStr.split(",")) {
      const parsed = parseInt(raw.trim(), 10);
      if (!isNaN(parsed)) ids.add(parsed);
    }
  }

  return ids;
}

export function isAdminUser(telegramId: number): boolean {
  const adminId = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (!adminId) return false;
  return parseInt(adminId, 10) === telegramId;
}

export function isAllowedUser(telegramId: number): boolean {
  const allowed = getAllowedUserIds();
  return allowed.has(telegramId);
}

/**
 * Middleware that restricts bot access to allowed users only.
 * If ALLOWED_USER_IDS and ADMIN_TELEGRAM_ID are not set, access is unrestricted.
 */
export function accessControlMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (telegramId == null) return next();

    const adminId = process.env.ADMIN_TELEGRAM_ID?.trim();
    const allowedStr = process.env.ALLOWED_USER_IDS?.trim();

    // If neither is set, allow everyone (backward compatibility)
    if (!adminId && !allowedStr) return next();

    if (isAllowedUser(telegramId)) return next();

    await ctx.reply("🚫 Доступ запрещён. Обратитесь к администратору.");
  };
}
