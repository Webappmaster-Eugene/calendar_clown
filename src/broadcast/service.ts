import { getUserByTelegramId, listTribeUsers, listApprovedUsers } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import type { BroadcastScope } from "../shared/types.js";

const log = createLogger("broadcast");

/** The sender may not use this scope (or has no audience for it) — a 403, not a 500. */
export class BroadcastNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BroadcastNotAllowedError";
  }
}

export interface BroadcastResult {
  sent: number;
  failed: number;
  total: number;
  scope: BroadcastScope;
}

/**
 * Resolves recipients for `scope` and delivers to each. Authorisation ("may this
 * sender use this scope?") belongs to the caller — see services/broadcastService.
 */
export async function broadcast(
  sendMessage: (recipientId: string, text: string) => Promise<void>,
  senderTelegramId: number,
  message: string,
  scope: BroadcastScope,
): Promise<BroadcastResult> {
  if (!isDatabaseAvailable()) {
    throw new Error("Рассылка недоступна (нет подключения к БД).");
  }

  let audience;
  if (scope === "all") {
    audience = await listApprovedUsers();
  } else {
    const sender = await getUserByTelegramId(senderTelegramId);
    if (!sender?.tribeId) {
      throw new BroadcastNotAllowedError("Вы не состоите в трайбе — рассылать некому.");
    }
    audience = await listTribeUsers(sender.tribeId);
  }

  const senderIdStr = String(senderTelegramId);
  const recipients = audience
    .map((u) => String(u.telegramId))
    // telegramId 0 is the seed row, not a real chat.
    .filter((id) => id !== senderIdStr && Number(id) > 0);

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

  return { sent, failed, total: recipients.length, scope };
}

export function formatBroadcastResult(result: BroadcastResult): string {
  const where = result.scope === "all" ? "всем пользователям бота" : "трайбу";

  if (result.total === 0) {
    return `Нет получателей для рассылки (${where}).`;
  }

  return (
    `Рассылка ${where} завершена: отправлено ${result.sent}` +
    (result.failed > 0 ? `, не удалось ${result.failed}` : "") +
    ` из ${result.total}.`
  );
}
