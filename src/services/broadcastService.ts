import { broadcast, BroadcastNotAllowedError } from "../broadcast/service.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import type { BroadcastResultDto, BroadcastScope } from "../shared/types.js";

// ─── Service Functions ────────────────────────────────────────

/**
 * Единственная точка авторизации по scope: «свой трайб» — любому участнику трайба,
 * «всем пользователям бота» — только администратору.
 */
export function assertCanBroadcast(senderTelegramId: number, scope: BroadcastScope): void {
  if (scope === "all" && !isBootstrapAdmin(senderTelegramId)) {
    throw new BroadcastNotAllowedError("Рассылка всем пользователям доступна только администратору.");
  }
}

export async function sendBroadcast(
  sendMessage: (recipientId: string, text: string) => Promise<void>,
  senderTelegramId: number,
  message: string,
  scope: BroadcastScope = "tribe"
): Promise<BroadcastResultDto> {
  assertCanBroadcast(senderTelegramId, scope);

  const result = await broadcast(sendMessage, senderTelegramId, message, scope);

  return {
    sent: result.sent,
    failed: result.failed,
    total: result.total,
    scope: result.scope,
  };
}
