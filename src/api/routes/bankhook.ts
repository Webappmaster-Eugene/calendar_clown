import { Hono } from "hono";
import {
  getOrCreateWebhookSecret,
  regenerateWebhookSecret,
} from "../../expenses/bankPush/repository.js";
import { buildWebhookUrl } from "../../commands/bankHook.js";
import { logApiAction } from "../../logging/actionLogger.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

/** GET /api/bankhook — return (creating on first use) the user's webhook URL. */
app.get("/", async (c) => {
  const initData = c.get("initData");
  if (!process.env.OAUTH_REDIRECT_URI?.trim()) {
    return c.json({ ok: false, error: "Webhook endpoint is not configured" }, 503);
  }
  const secret = await getOrCreateWebhookSecret(initData.user.id);
  if (!secret) {
    return c.json({ ok: false, error: "User not registered" }, 403);
  }
  return c.json({ ok: true, data: { url: buildWebhookUrl(secret) } });
});

/** POST /api/bankhook/regenerate — rotate the secret (revokes the previous URL). */
app.post("/regenerate", async (c) => {
  const initData = c.get("initData");
  if (!process.env.OAUTH_REDIRECT_URI?.trim()) {
    return c.json({ ok: false, error: "Webhook endpoint is not configured" }, 503);
  }
  const secret = await regenerateWebhookSecret(initData.user.id);
  if (!secret) {
    return c.json({ ok: false, error: "User not registered" }, 403);
  }
  logApiAction(initData.user.id, "bankhook_regenerate", {});
  return c.json({ ok: true, data: { url: buildWebhookUrl(secret) } });
});

export default app;
