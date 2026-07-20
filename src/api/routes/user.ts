import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
import { getUserProfile, switchMode, getAvailableModes } from "../../services/userService.js";
import { getAuthUrl, hasToken } from "../../calendar/auth.js";
import { logApiAction } from "../../logging/actionLogger.js";
import type { ApiEnv } from "../authMiddleware.js";
import type { UserMode } from "../../shared/types.js";

const app = new Hono<ApiEnv>();

// ── Input schema. `mode` stays lenient (z.string()); switchMode validates the
//    concrete value and the handler surfaces its error as 400.
const switchModeBody = z.object({ mode: z.string() });

app.get("/me", async (c) => {
  const initData = c.get("initData");
  const profile = await getUserProfile(
    initData.user.id,
    initData.user.first_name,
    initData.user.username
  );

  if (!profile) {
    return c.json({ ok: false, error: "User not registered. Use the bot /start first." }, 403);
  }

  const availableModes = getAvailableModes(profile);
  return c.json({ ok: true, data: { ...profile, availableModes } });
});

app.put("/mode", zValidator("json", switchModeBody), async (c) => {
  const initData = c.get("initData");
  const body = await c.req.json<{ mode: string }>();

  if (!body.mode) {
    return c.json({ ok: false, error: "mode is required" }, 400);
  }

  try {
    await switchMode(initData.user.id, body.mode as UserMode);
    logApiAction(initData.user.id, "user_mode_switch", { mode: body.mode });
    return c.json({ ok: true, data: { mode: body.mode } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to switch mode";
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.get("/auth/google/url", async (c) => {
  const initData = c.get("initData");
  try {
    const url = getAuthUrl(String(initData.user.id));
    return c.json({ ok: true, data: { url } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth not configured";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/auth/google/status", async (c) => {
  const initData = c.get("initData");
  const linked = await hasToken(String(initData.user.id));
  return c.json({ ok: true, data: { linked } });
});

export default app;
