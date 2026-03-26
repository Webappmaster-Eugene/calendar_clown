import type { Context, MiddlewareFn } from "telegraf";
import { Markup } from "telegraf";
import { isUserInDb, getUserByTelegramId, getUserStatus } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { query } from "../db/connection.js";

// Import from shared for internal use + re-export for backward compatibility.
import type { UserMenuContext } from "../shared/auth.js";
export { canAccessMode } from "../shared/auth.js";
export type { UserMenuContext } from "../shared/auth.js";

/**
 * Check if a telegram user is the bootstrap admin (from env).
 * This is the ONLY env-based check — used to seed the first admin.
 */
export function isBootstrapAdmin(telegramId: number): boolean {
  const adminId = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (!adminId) return false;
  return parseInt(adminId, 10) === telegramId;
}

/** Get bootstrap admin's Telegram ID. */
export function getAdminTelegramId(): number | null {
  const adminId = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (!adminId) return null;
  const parsed = parseInt(adminId, 10);
  return isNaN(parsed) ? null : parsed;
}

const ONBOARD_WELCOME = `👋 *Добро пожаловать!*

Это многофункциональный бот для управления:
📅 Календарь — создание и управление встречами
💰 Расходы — трекинг семейных трат
🎙️ Транскрибация — расшифровка голосовых сообщений
🧹 Упрощатель — очистка текста от мусора и повторений
📰 Дайджест — агрегация Telegram-каналов
🎂 Даты — напоминания о днях рождения
🧙 База знаний — структурированные записи
🎁 Вишлист — списки желаний для семьи
📋 Резюме — портфолио достижений с AI-саммари
✍️ Блогер — генерация постов для Telegram-каналов

Для получения доступа подайте заявку администратору.`;

/**
 * Middleware: restrict bot access to users registered in the DB.
 * The bootstrap admin (ADMIN_TELEGRAM_ID env) is always allowed and auto-registered.
 * New users see an onboarding flow with an application button.
 * Pending users can only use /start and /help.
 */
export function accessControlMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (telegramId == null) return;

    // Bootstrap admin always passes
    if (isBootstrapAdmin(telegramId)) return next();

    // If DB is unavailable, allow all users (calendar is protected by OAuth tokens)
    if (!isDatabaseAvailable()) return next();

    // Allow onboard_request callback through for users not yet in DB
    if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "onboard_request") {
      return next();
    }

    // Check DB
    const exists = await isUserInDb(telegramId);
    if (!exists) {
      // Show onboarding message with application button
      await ctx.reply(
        `${ONBOARD_WELCOME}\n\nВаш Telegram ID: \`${telegramId}\``,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("✅ Подать заявку на доступ", "onboard_request")],
          ]),
        }
      );
      return;
    }

    // User exists — check status
    const status = await getUserStatus(telegramId);
    if (status === "pending") {
      // Allow /start and /help for pending users
      const isCommand = ctx.message && "text" in ctx.message && typeof ctx.message.text === "string";
      if (isCommand) {
        const text = (ctx.message as { text: string }).text;
        if (text.startsWith("/start") || text.startsWith("/help")) {
          return next();
        }
      }
      await ctx.reply("⏳ Ваша заявка на рассмотрении. Ожидайте одобрения администратора.");
      return;
    }

    // status === 'approved' or legacy null
    return next();
  };
}

/** Get user menu context for role-based UI. Returns null if user not found. */
export async function getUserMenuContext(telegramId: number): Promise<UserMenuContext | null> {
  if (!isDatabaseAvailable()) return null;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return null;

  // Get user status
  const { rows: statusRows } = await query<{ status: string }>(
    "SELECT COALESCE(status, 'approved') AS status FROM users WHERE telegram_id = $1",
    [telegramId]
  );
  const status = statusRows[0]?.status ?? "approved";

  // Get tribe name
  let tribeName: string | null = null;
  if (dbUser.tribeId) {
    const { rows: tribeRows } = await query<{ name: string }>(
      "SELECT name FROM tribes WHERE id = $1",
      [dbUser.tribeId]
    );
    tribeName = tribeRows[0]?.name ?? null;
  }

  return {
    role: dbUser.role,
    status,
    hasTribe: dbUser.tribeId != null,
    tribeId: dbUser.tribeId,
    tribeName,
  };
}
