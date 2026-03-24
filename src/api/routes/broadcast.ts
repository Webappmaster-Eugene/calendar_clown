import { Hono } from "hono";
import { sendBroadcast } from "../../services/broadcastService.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

/** POST /api/broadcast — send broadcast */
app.post("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ text: string }>();

  if (!body.text?.trim()) {
    return c.json({ ok: false, error: "text is required" }, 400);
  }

  try {
    // Note: sendBroadcast requires a sendMessage callback for delivering messages.
    // In API context (Mini App), we cannot send Telegram messages directly.
    // This route provides a stub that returns an error — broadcast should be triggered
    // via the bot command or a server-side mechanism that has Telegraf context.
    // If a bot instance is available globally, inject it here.
    const sendMessage = async (_recipientId: string, _text: string): Promise<void> => {
      throw new Error("Broadcast via API is not supported. Use the bot command.");
    };

    const result = await sendBroadcast(sendMessage, telegramId, body.text.trim());
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send broadcast";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
