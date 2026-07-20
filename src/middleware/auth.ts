import type { Context, MiddlewareFn } from "telegraf";
import { Markup } from "telegraf";
import { isUserInDb, getUserByTelegramId, getUserStatus } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { eq } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { tribes } from "../db/schema.js";

import type { UserMenuContext } from "../shared/auth.js";
export { canAccessMode } from "../shared/auth.js";
export type { UserMenuContext } from "../shared/auth.js";

// The ONLY env-based admin check — used to seed the first admin.
export function isBootstrapAdmin(telegramId: number): boolean {
  const adminId = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (!adminId) return false;
  return parseInt(adminId, 10) === telegramId;
}

export function getAdminTelegramId(): number | null {
  const adminId = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (!adminId) return null;
  const parsed = parseInt(adminId, 10);
  return isNaN(parsed) ? null : parsed;
}

const ONBOARD_WELCOME = `👋 *Добро пожаловать в Sovetnik Bot!*

Персональный ассистент с 17 режимами работы.

🔹 *Доступны сразу:*
📅 Календарь — встречи в Google Calendar текстом и голосом
🎙️ Транскрибация — расшифровка голосовых в текст
🧹 Упрощатель — очистка текста от мусора и повторений
🧙 База знаний — каталог записей с категориями и файлами
🧠 Нейро — AI-чат: текст, голос, фото, документы
🎯 Цели — наборы целей с отслеживанием прогресса
⏰ Напоминания — гибкие напоминания по расписанию

🔹 *Доступны в трайбе (семье):*
💰 Расходы — учёт трат текстом и голосом, отчёты, Excel
📰 Дайджест — саммари Telegram-каналов по рубрикам
🎂 Даты — дни рождения, праздники, уведомления
🎁 Вишлист — списки желаний с бронированием подарков
🔍 OSINT — поиск информации о людях и компаниях
📋 Резюме — учёт рабочих достижений, AI-саммари
✍️ Блогер — генерация постов для каналов через AI
✅ Задачи — трекер задач с дедлайнами и напоминаниями

🎤 Большинство режимов поддерживают голосовой ввод.

Для получения доступа подайте заявку администратору.`;

export function accessControlMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (telegramId == null) return;

    if (isBootstrapAdmin(telegramId)) return next();

    // DB down: allow all — calendar is still protected by per-user OAuth tokens.
    if (!isDatabaseAvailable()) return next();

    // Let the onboard_request callback through for users not yet in DB.
    if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "onboard_request") {
      return next();
    }

    const exists = await isUserInDb(telegramId);
    if (!exists) {
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

    const status = await getUserStatus(telegramId);
    if (status === "pending") {
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

    return next();
  };
}

export async function getUserMenuContext(telegramId: number): Promise<UserMenuContext | null> {
  if (!isDatabaseAvailable()) return null;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return null;

  const status = (await getUserStatus(telegramId)) ?? "approved";

  let tribeName: string | null = null;
  if (dbUser.tribeId) {
    const [tribeRow] = await db
      .select({ name: tribes.name })
      .from(tribes)
      .where(eq(tribes.id, dbUser.tribeId));
    tribeName = tribeRow?.name ?? null;
  }

  return {
    role: dbUser.role,
    status,
    hasTribe: dbUser.tribeId != null,
    tribeId: dbUser.tribeId,
    tribeName,
  };
}
