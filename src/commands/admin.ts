import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { isBootstrapAdmin } from "../middleware/auth.js";
import {
  addUserByTelegramId,
  removeUserByTelegramId,
  listTribeUsers,
  getUserByTelegramId,
} from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DB_UNAVAILABLE_MSG } from "./expenseMode.js";

/** State for admin waiting for user ID input. */
const adminWaitingForId = new Set<number>();

/** /admin — show admin panel (only for admin). */
export async function handleAdminCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null || !isBootstrapAdmin(telegramId)) {
    await ctx.reply("Эта команда доступна только администратору.");
    return;
  }

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  await ctx.reply("🔧 *Панель администратора*", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("👥 Список пользователей", "admin:list")],
      [Markup.button.callback("➕ Добавить пользователя", "admin:add")],
      [Markup.button.callback("➖ Удалить пользователя", "admin:remove")],
    ]),
  });
}

/** Handle admin inline button callbacks. */
export async function handleAdminCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null || !isBootstrapAdmin(telegramId)) {
    await ctx.answerCbQuery("Доступ запрещён.");
    return;
  }

  if (!isDatabaseAvailable()) {
    await ctx.answerCbQuery();
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  if (data === "admin:list") {
    const admin = await getUserByTelegramId(telegramId);
    const tribeId = admin?.tribeId ?? 1;
    const users = await listTribeUsers(tribeId);

    if (users.length === 0) {
      await ctx.editMessageText("Пользователей нет.");
      await ctx.answerCbQuery();
      return;
    }

    const lines = users.map((u) => {
      const name = u.firstName || u.username || "—";
      const roleIcon = u.role === "admin" ? "👑" : "👤";
      return `${roleIcon} ${name} — ID: \`${u.telegramId}\``;
    });

    await ctx.editMessageText(
      `👥 *Пользователи:*\n\n${lines.join("\n")}`,
      { parse_mode: "Markdown" }
    );
    await ctx.answerCbQuery();
    return;
  }

  if (data === "admin:add") {
    adminWaitingForId.add(telegramId);
    await ctx.editMessageText(
      "➕ Отправьте Telegram ID нового пользователя (число).\n\n" +
      "Пользователь может узнать свой ID у @userinfobot."
    );
    await ctx.answerCbQuery();
    return;
  }

  if (data === "admin:remove") {
    const admin = await getUserByTelegramId(telegramId);
    const tribeId = admin?.tribeId ?? 1;
    const users = await listTribeUsers(tribeId);
    const nonAdmins = users.filter((u) => u.role !== "admin");

    if (nonAdmins.length === 0) {
      await ctx.editMessageText("Нет пользователей для удаления.");
      await ctx.answerCbQuery();
      return;
    }

    const buttons = nonAdmins.map((u) => {
      const name = u.firstName || u.username || String(u.telegramId);
      return [Markup.button.callback(`❌ ${name} (${u.telegramId})`, `admin:del:${u.telegramId}`)];
    });

    await ctx.editMessageText("➖ Выберите пользователя для удаления:", {
      ...Markup.inlineKeyboard(buttons),
    });
    await ctx.answerCbQuery();
    return;
  }

  // admin:del:<telegramId>
  const delMatch = data.match(/^admin:del:(\d+)$/);
  if (delMatch) {
    const targetId = parseInt(delMatch[1], 10);
    const removed = await removeUserByTelegramId(targetId);
    if (removed) {
      await ctx.editMessageText(`✅ Пользователь ${targetId} удалён.`);
    } else {
      await ctx.editMessageText(`Пользователь ${targetId} не найден.`);
    }
    await ctx.answerCbQuery();
    return;
  }

  await ctx.answerCbQuery();
}

/**
 * Handle text input when admin is waiting for a user ID to add.
 * Returns true if the message was consumed (admin was adding a user).
 */
export async function handleAdminTextInput(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null || !adminWaitingForId.has(telegramId)) return false;

  if (!isDatabaseAvailable()) {
    adminWaitingForId.delete(telegramId);
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return true;
  }

  adminWaitingForId.delete(telegramId);

  if (!ctx.message || !("text" in ctx.message)) return false;
  const text = ctx.message.text.trim();
  const newId = parseInt(text, 10);

  if (isNaN(newId) || newId <= 0) {
    await ctx.reply("❌ Некорректный Telegram ID. Должно быть положительное число.");
    return true;
  }

  const user = await addUserByTelegramId(newId);
  if (user) {
    await ctx.reply(`✅ Пользователь ${newId} добавлен.`);
  } else {
    await ctx.reply(`Пользователь ${newId} уже существует.`);
  }
  return true;
}
