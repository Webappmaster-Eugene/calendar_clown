import type { Context, MiddlewareFn } from "telegraf";
import { isUserInDb } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";

/**
 * Check if a telegram user is the bootstrap admin (from env).
 * This is the ONLY env-based check — used to seed the first admin.
 */
export function isBootstrapAdmin(telegramId: number): boolean {
  const adminId = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (!adminId) return false;
  return parseInt(adminId, 10) === telegramId;
}

/**
 * Middleware: restrict bot access to users registered in the DB.
 * The bootstrap admin (ADMIN_TELEGRAM_ID env) is always allowed and auto-registered.
 * All other users must be added by the admin via /admin command.
 */
export function accessControlMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (telegramId == null) return;

    // Bootstrap admin always passes
    if (isBootstrapAdmin(telegramId)) return next();

    // If DB is unavailable, allow all users (calendar is protected by OAuth tokens)
    if (!isDatabaseAvailable()) return next();

    // Check DB
    const exists = await isUserInDb(telegramId);
    if (exists) return next();

    // Denied — show ID so user can send it to admin
    await ctx.reply(
      `🚫 Доступ запрещён.\n\nВаш Telegram ID: \`${telegramId}\`\nОтправьте его администратору для получения доступа.`,
      { parse_mode: "Markdown" }
    );
  };
}
