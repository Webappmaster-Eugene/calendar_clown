import type { Context } from "telegraf";
import { isAdmin } from "../admin.js";
import { getChatIdByUsername } from "../userChats.js";

/**
 * Handle /send @username text — only for admins. Sends text to the user with that username.
 */
export async function handleSend(ctx: Context): Promise<void> {
  if (!isAdmin(ctx)) {
    await ctx.reply("Команда доступна только доверенным пользователям.");
    return;
  }

  const text = "text" in ctx.message && typeof ctx.message.text === "string"
    ? ctx.message.text.replace(/^\/send\s+/i, "").trim()
    : "";
  if (!text) {
    await ctx.reply(
      "Использование: /send @username Текст сообщения\nПример: /send @johndoe Привет!"
    );
    return;
  }

  const match = /^@?(\w+)\s+(.+)/s.exec(text);
  if (!match) {
    await ctx.reply(
      "Укажите username получателя (с @ или без) и текст. Пример: /send @johndoe Привет!"
    );
    return;
  }

  const [, username, message] = match;
  const chatId = await getChatIdByUsername(username);
  if (chatId == null) {
    await ctx.reply(
      `Пользователь @${username} не найден или ещё не писал боту. Отправка возможна только тем, кто уже начал диалог с ботом.`
    );
    return;
  }

  try {
    await ctx.telegram.sendMessage(chatId, message);
    await ctx.reply(`Сообщение отправлено пользователю @${username}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Ошибка отправки: ${msg}`);
  }
}
