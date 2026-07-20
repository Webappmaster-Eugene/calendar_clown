import { broadcastToTribe } from "../broadcast/service.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import type { BroadcastResultDto } from "../shared/types.js";

// ─── Service Functions ────────────────────────────────────────

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
