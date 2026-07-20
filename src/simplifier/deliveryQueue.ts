/**
 * Delivers results in submission order even though processing may complete
 * out of order (async fire-and-forget).
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

let botRef: Telegraf | null = null;

export function setSimplifierDeliveryBotRef(bot: Telegraf): void {
  botRef = bot;
}

export function getSimplifierDeliveryBot(): Telegraf {
  if (!botRef) throw new Error("Simplifier delivery bot reference not set. Call setSimplifierDeliveryBotRef first.");
  return botRef;
}

// Per-user promise chain serializes deliveries to prevent concurrent sends for the same user.
const deliveryLocks = new Map<number, Promise<void>>();

export function deliverSimplificationsInOrder(bot: Telegraf, userId: number): void {
  const prev = deliveryLocks.get(userId) ?? Promise.resolve();
  const next = prev
    .then(() => doDeliver(bot, userId))
    .catch((err) => {
      log.error(`Delivery error for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    })
    .finally(() => {
      // Only clear if this is still the latest promise in the chain.
      if (deliveryLocks.get(userId) === next) {
        deliveryLocks.delete(userId);
      }
    });
  deliveryLocks.set(userId, next);
}

async function doDeliver(bot: Telegraf, userId: number): Promise<void> {
  const items = await getUndeliveredSimplificationsForUser(userId);

  for (const item of items) {
    // Preserve order: stop at first not-yet-finished job; it re-triggers delivery when done.
    if (item.status === "pending" || item.status === "processing") {
      break;
    }

    const chatId = item.chatId;
    const statusMessageId = item.statusMessageId;

    if (chatId == null || statusMessageId == null) {
      // API-created records have no Telegram context to send to.
      await markSimplificationDelivered(item.id);
      continue;
    }

    if (item.status === "completed" && item.simplifiedText) {
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
      await editStatusSafe(
        bot,
        chatId,
        statusMessageId,
        "Не удалось упростить текст. Попробуйте ещё раз.",
      );
      await markSimplificationDelivered(item.id);
    } else if (item.status === "failed") {
      const errorText = `❌ Ошибка при упрощении: ${item.errorMessage ?? "Неизвестная ошибка"}`;
      await editStatusSafe(bot, chatId, statusMessageId, errorText);
      await markSimplificationDelivered(item.id);
      log.info(`Delivered failure for simplification ${item.id} (seq=${item.sequenceNumber}) to user ${userId}`);
    }
  }
}
