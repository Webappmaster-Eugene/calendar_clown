/**
 * Ordered delivery of transcription results: results are sent to users in the order
 * voice messages were received, even though processing may complete out of order (concurrency=2).
 */

import type { Telegraf } from "telegraf";
import { getUndeliveredForUser, markDelivered } from "./repository.js";
import { sendTranscriptSafe, editStatusSafe, deleteMessageSafe } from "./telegramHelpers.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("delivery");

let botRef: Telegraf | null = null;

export function setDeliveryBotRef(bot: Telegraf): void {
  botRef = bot;
}

export function getDeliveryBot(): Telegraf {
  if (!botRef) throw new Error("Delivery bot reference not set. Call setDeliveryBotRef first.");
  return botRef;
}

/** Per-user promise chain serializing delivery attempts to prevent concurrent deliveries for the same user. */
const deliveryLocks = new Map<number, Promise<void>>();

/**
 * Deliver all consecutive completed/failed transcriptions for a user, starting from the first
 * undelivered one. On a pending/processing job, delivery stops and waits for that job to complete
 * (it will call this function again when done).
 */
export function deliverCompletedInOrder(bot: Telegraf, userId: number): void {
  const prev = deliveryLocks.get(userId) ?? Promise.resolve();
  const next = prev
    .then(() => doDeliver(bot, userId))
    .catch((err) => {
      log.error(`Delivery error for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    })
    .finally(() => {
      if (deliveryLocks.get(userId) === next) {
        deliveryLocks.delete(userId);
      }
    });
  deliveryLocks.set(userId, next);
}

async function doDeliver(bot: Telegraf, userId: number): Promise<void> {
  const items = await getUndeliveredForUser(userId);

  for (const item of items) {
    // Stop at first pending/processing — wait for it to complete
    if (item.status === "pending" || item.status === "processing") {
      break;
    }

    const chatId = item.chatId;
    const statusMessageId = item.statusMessageId;

    if (chatId == null || statusMessageId == null) {
      // Old records without chat_id/status_message_id — just mark delivered
      await markDelivered(item.id);
      continue;
    }

    if (item.status === "completed" && item.transcript) {
      await sendTranscriptSafe(bot, chatId, item.transcript);
      await deleteMessageSafe(bot, chatId, statusMessageId);
      await markDelivered(item.id);
      log.info(`Delivered transcription ${item.id} (seq=${item.sequenceNumber}) to user ${userId}`);
    } else if (item.status === "completed" && !item.transcript) {
      await editStatusSafe(
        bot,
        chatId,
        statusMessageId,
        "Не удалось распознать речь. Аудио может быть слишком тихим или неразборчивым."
      );
      await markDelivered(item.id);
    } else if (item.status === "failed") {
      const errorText = item.errorMessage === "Очищено пользователем"
        ? "Транскрипция отменена."
        : "Не удалось расшифровать голосовое сообщение. Попробуйте ещё раз.";
      await editStatusSafe(bot, chatId, statusMessageId, errorText);
      await markDelivered(item.id);
      log.info(`Delivered failure for transcription ${item.id} (seq=${item.sequenceNumber}) to user ${userId}`);
    }
  }
}
