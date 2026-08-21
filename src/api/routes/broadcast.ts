import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
import { sendBroadcast } from "../../services/broadcastService.js";
import { BroadcastNotAllowedError } from "../../broadcast/service.js";
import { getBotSendMessage } from "../../botInstance.js";
import { logApiAction } from "../../logging/actionLogger.js";
import type { ApiEnv } from "../authMiddleware.js";
import type { BroadcastScope, SendBroadcastRequest } from "../../shared/types.js";

const app = new Hono<ApiEnv>();

// ── Input schema. Emptiness/trim is enforced by the handler (400).
const broadcastBody = z.object({
  text: z.string(),
  scope: z.enum(["tribe", "all"]).optional(),
});

/** POST /api/broadcast — send broadcast */
app.post("/", zValidator("json", broadcastBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<SendBroadcastRequest>();
  const scope: BroadcastScope = body.scope ?? "tribe";

  if (!body.text?.trim()) {
    return c.json({ ok: false, error: "text is required" }, 400);
  }

  const botSend = getBotSendMessage();
  if (!botSend) {
    return c.json({ ok: false, error: "Bot not initialized. Try again later." }, 503);
  }

  try {
    const sendMessage = async (recipientId: string, text: string): Promise<void> => {
      await botSend(recipientId, text);
    };

    const result = await sendBroadcast(sendMessage, telegramId, body.text.trim(), scope);
    logApiAction(telegramId, "broadcast_send", { scope, sent: result.sent, failed: result.failed });
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send broadcast";
    // Wrong scope for this sender / no tribe — a client mistake, not a server fault.
    if (err instanceof BroadcastNotAllowedError) {
      return c.json({ ok: false, error: msg }, 403);
    }
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
