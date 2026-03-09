import type { Context } from "telegraf";
import { isAdmin } from "../admin.js";
import { getChatIdByUsername } from "../userChats.js";

const RECIPIENT_AND_TEXT_RE = /^@?(\w+)\s+(.+)/s;

/**
 * Parse "@username Текст" or "username Текст" into { username, message }. Returns null if format invalid.
 */
export function parseRecipientAndText(text: string): { username: string; message: string } | null {
  const trimmed = text.trim();
  const match = RECIPIENT_AND_TEXT_RE.exec(trimmed);
  if (!match) return null;
  return { username: match[1], message: match[2].trim() };
}

/**
 * Send message to user by username; replies to ctx with success or a clear error.
 */
export async function doSendToUser(ctx: Context, username: string, message: string): Promise<void> {
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

  const parsed = parseRecipientAndText(text);
  if (!parsed) {
    await ctx.reply(
      "Укажите username получателя (с @ или без) и текст. Пример: /send @johndoe Привет!"
    );
    return;
  }

  await doSendToUser(ctx, parsed.username, parsed.message);
}

/**
 * Handle text in "send_message" mode (menu button). Only for admins; expects "@username Текст".
 */
export async function handleSendMessageMode(ctx: Context): Promise<void> {
  if (!isAdmin(ctx)) {
    await ctx.reply("Режим доступен только доверенным пользователям.");
    return;
  }
  const text = "text" in ctx.message && typeof ctx.message.text === "string" ? ctx.message.text : "";
  const parsed = parseRecipientAndText(text);
  if (!parsed) {
    await ctx.reply("Напишите в одну строку: @username Текст сообщения");
    return;
  }
  await doSendToUser(ctx, parsed.username, parsed.message);
}
