/**
 * Broadcast business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import { broadcastToTribe, formatBroadcastResult } from "../broadcast/service.js";
import type { BroadcastResult } from "../broadcast/service.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { createLogger } from "../utils/logger.js";
import type { BroadcastResultDto } from "../shared/types.js";

const log = createLogger("broadcast-service");

// ─── Service Functions ────────────────────────────────────────

/**
 * Send a broadcast message to all tribe members.
 * @param sendMessage - callback to send a message to a recipient (injected for testability)
 * @param adminTelegramId - the admin's telegram ID
 * @param message - the message text to broadcast
 */
export async function sendBroadcast(
  sendMessage: (recipientId: string, text: string) => Promise<void>,
  adminTelegramId: number,
  message: string
): Promise<BroadcastResultDto> {
  if (!isBootstrapAdmin(adminTelegramId)) {
    throw new Error("Рассылка доступна только администратору.");
  }

  const result = await broadcastToTribe(sendMessage, adminTelegramId, message);

  return {
    sent: result.sent,
    failed: result.failed,
  };
}

/**
 * Format broadcast result into a user-friendly string.
 */
export function formatResult(result: BroadcastResultDto & { total?: number }): string {
  return formatBroadcastResult({
    sent: result.sent,
    failed: result.failed,
    total: result.total ?? result.sent + result.failed,
  });
}
