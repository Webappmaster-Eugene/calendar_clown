import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
import { sendBroadcast } from "../../services/broadcastService.js";
import { getBotSendMessage } from "../../botInstance.js";
import { logApiAction } from "../../logging/actionLogger.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

// ── Input schema. Emptiness/trim is enforced by the handler (400).
const broadcastBody = z.object({ text: z.string() });

/** POST /api/broadcast — send broadcast */
app.post("/", zValidator("json", broadcastBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ text: string }>();

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

    const result = await sendBroadcast(sendMessage, telegramId, body.text.trim());
    logApiAction(telegramId, "broadcast_send", { sent: result.sent, failed: result.failed });
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send broadcast";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
