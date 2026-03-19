/**
 * Shared Telegram helper functions for transcription delivery.
 * Extracted from worker.ts / queue.ts to avoid duplication.
 */

import type { Telegraf } from "telegraf";
import { splitMessage, TELEGRAM_MAX_MESSAGE_LENGTH } from "../utils/telegram.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("tg-helpers");

/** Send transcript text, splitting into chunks if it exceeds Telegram's limit. */
export async function sendTranscriptSafe(
  bot: Telegraf,
  chatId: number,
  transcript: string
): Promise<void> {
  const chunks = splitMessage(transcript, TELEGRAM_MAX_MESSAGE_LENGTH);
  for (const chunk of chunks) {
    try {
      await bot.telegram.sendMessage(chatId, chunk);
    } catch (err) {
      log.error("Failed to send transcript chunk:", err);
    }
  }
}

/** Edit the status message, swallowing errors if the message was already deleted. */
export async function editStatusSafe(
  bot: Telegraf,
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  try {
    await bot.telegram.editMessageText(chatId, messageId, undefined, text);
  } catch {
    // Message may have been deleted by the user — ignore
  }
}

/** Delete a message, swallowing errors. */
export async function deleteMessageSafe(
  bot: Telegraf,
  chatId: number,
  messageId: number
): Promise<void> {
  try {
    await bot.telegram.deleteMessage(chatId, messageId);
  } catch {
    // Message may have been deleted or is too old — ignore
  }
}
