import type { Context } from "telegraf";
import { insertMessage } from "./client.js";

export async function messageLogger(ctx: Context, next: () => Promise<void>): Promise<void> {
  const msg = ctx.message;
  const chat = ctx.chat;
  if (!msg || !chat || "message_id" in msg === false) {
    return next();
  }

  const telegramMessageId = (msg as { message_id: number }).message_id;
  const chatId = chat.id;
  const userId = ctx.from?.id ?? null;

  if ("text" in msg && typeof msg.text === "string") {
    void insertMessage({
      telegram_message_id: telegramMessageId,
      chat_id: chatId,
      user_id: userId,
      direction: "inbound",
      kind: "text",
      content_text: msg.text,
    }).catch((err) => console.error("messageLogger insert text:", err));
  } else if ("voice" in msg && msg.voice) {
    const v = msg.voice;
    void insertMessage({
      telegram_message_id: telegramMessageId,
      chat_id: chatId,
      user_id: userId,
      direction: "inbound",
      kind: "voice",
      content_voice_file_id: v.file_id,
      content_voice_duration_sec: v.duration ?? null,
    }).catch((err) => console.error("messageLogger insert voice:", err));
  }

  return next();
}
