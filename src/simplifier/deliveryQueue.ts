/**
 * Ordered delivery of simplification results.
 * Ensures results are sent to users in the order simplification requests were submitted,
 * even though processing may complete out of order (async fire-and-forget).
 *
 * Pattern is identical to transcribe/deliveryQueue.ts.
 */

import type { Telegraf } from "telegraf";
import {
  getUndeliveredSimplificationsForUser,
  markSimplificationDelivered,
} from "./repository.js";
import {
  editStatusSafe,
  deleteMessageSafe,
} from "../transcribe/telegramHelpers.js";
import { splitMessage, TELEGRAM_MAX_MESSAGE_LENGTH } from "../utils/telegram.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("simplifier-delivery");

/** Stored bot reference for use by external callers that don't have bot in scope. */
let botRef: Telegraf | null = null;

/** Set the bot reference for the delivery module. Call once at startup. */
export function setSimplifierDeliveryBotRef(bot: Telegraf): void {
  botRef = bot;
}

/** Get stored bot reference. Throws if not set. */
export function getSimplifierDeliveryBot(): Telegraf {
  if (!botRef) throw new Error("Simplifier delivery bot reference not set. Call setSimplifierDeliveryBotRef first.");
  return botRef;
}

/**
 * Per-user promise chain to prevent concurrent deliveries for the same user.
 * Each user gets a serialized chain of delivery attempts.
 */
const deliveryLocks = new Map<number, Promise<void>>();

/**
 * Deliver all consecutive completed/failed simplifications for a user,
 * starting from the first undelivered one.
 *
 * If a pending/processing job is encountered, delivery stops and waits
 * for that job to complete (it will call this function again when done).
 */
export function deliverSimplificationsInOrder(bot: Telegraf, userId: number): void {
  const prev = deliveryLocks.get(userId) ?? Promise.resolve();
  const next = prev
    .then(() => doDeliver(bot, userId))
    .catch((err) => {
      log.error(`Delivery error for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    })
    .finally(() => {
      // Clean up lock entry if this is still the latest promise in the chain
      if (deliveryLocks.get(userId) === next) {
        deliveryLocks.delete(userId);
      }
    });
  deliveryLocks.set(userId, next);
}

async function doDeliver(bot: Telegraf, userId: number): Promise<void> {
  const items = await getUndeliveredSimplificationsForUser(userId);

  for (const item of items) {
    // Stop at first pending/processing — wait for it to complete
    if (item.status === "pending" || item.status === "processing") {
      break;
    }

    const chatId = item.chatId;
    const statusMessageId = item.statusMessageId;

    if (chatId == null || statusMessageId == null) {
      // API-created records (no Telegram context) — just mark delivered
      await markSimplificationDelivered(item.id);
      continue;
    }

    if (item.status === "completed" && item.simplifiedText) {
      // Delete status message, send result
      await deleteMessageSafe(bot, chatId, statusMessageId);

      const header = "🧹 *Результат упрощения:*\n\n";
      const chunks = splitMessage(header + item.simplifiedText, TELEGRAM_MAX_MESSAGE_LENGTH);
      for (const chunk of chunks) {
        try {
          await bot.telegram.sendMessage(chatId, chunk, { parse_mode: "Markdown" });
        } catch (err) {
          log.error(`Failed to send simplification chunk to chat ${chatId}:`, err);
        }
      }

      await markSimplificationDelivered(item.id);
      log.info(`Delivered simplification ${item.id} (seq=${item.sequenceNumber}) to user ${userId}`);
    } else if (item.status === "completed" && !item.simplifiedText) {
      // Completed but empty result
      await editStatusSafe(
        bot,
        chatId,
        statusMessageId,
        "Не удалось упростить текст. Попробуйте ещё раз.",
      );
      await markSimplificationDelivered(item.id);
    } else if (item.status === "failed") {
      // Failed — send error message, don't block subsequent deliveries
      const errorText = `❌ Ошибка при упрощении: ${item.errorMessage ?? "Неизвестная ошибка"}`;
      await editStatusSafe(bot, chatId, statusMessageId, errorText);
      await markSimplificationDelivered(item.id);
      log.info(`Delivered failure for simplification ${item.id} (seq=${item.sequenceNumber}) to user ${userId}`);
    }
  }
}
