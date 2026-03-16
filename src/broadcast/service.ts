import { getUserByTelegramId, listTribeUsers } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("broadcast");

export interface BroadcastResult {
  sent: number;
  failed: number;
  total: number;
}

/**
 * Send a message to all tribe members (excluding the admin).
 * `sendMessage` is injected as a callback for testability.
 */
export async function broadcastToTribe(
  sendMessage: (recipientId: string, text: string) => Promise<void>,
  adminTelegramId: number,
  message: string
): Promise<BroadcastResult> {
  if (!isDatabaseAvailable()) {
    throw new Error("Рассылка недоступна (нет подключения к БД).");
  }

  const adminUser = await getUserByTelegramId(adminTelegramId);
  const tribeId = adminUser?.tribeId ?? 1;
  const allUsers = await listTribeUsers(tribeId);

  const adminIdStr = String(adminTelegramId);
  const recipients = allUsers
    .map((u) => String(u.telegramId))
    .filter((id) => id !== adminIdStr && Number(id) > 0);

  let sent = 0;
  let failed = 0;

  for (const recipientId of recipients) {
    try {
      await sendMessage(recipientId, message);
      sent++;
    } catch (err) {
      log.error(`Failed to send broadcast to ${recipientId}:`, err);
      failed++;
    }
  }

  return { sent, failed, total: recipients.length };
}

/** Format broadcast result into a user-friendly string. */
export function formatBroadcastResult(result: BroadcastResult): string {
  if (result.total === 0) {
    return "Нет пользователей для рассылки.";
  }

  return (
    `Рассылка завершена: отправлено ${result.sent}` +
    (result.failed > 0 ? `, не удалось ${result.failed}` : "") +
    ` из ${result.total}.`
  );
}
