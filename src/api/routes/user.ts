import { Hono } from "hono";
import { getUserProfile, switchMode, getAvailableModes } from "../../services/userService.js";
import { getAuthUrl, hasToken } from "../../calendar/auth.js";
import type { ApiEnv } from "../authMiddleware.js";
import type { UserMode } from "../../shared/types.js";

const app = new Hono<ApiEnv>();

/** GET /api/user/me — current user profile + available modes */
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

/** PUT /api/user/mode — switch current mode */
app.put("/mode", async (c) => {
  const initData = c.get("initData");
  const body = await c.req.json<{ mode: string }>();

  if (!body.mode) {
    return c.json({ ok: false, error: "mode is required" }, 400);
  }

  try {
    await switchMode(initData.user.id, body.mode as UserMode);
    return c.json({ ok: true, data: { mode: body.mode } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to switch mode";
    return c.json({ ok: false, error: msg }, 400);
  }
});

/** GET /api/auth/google/url — get Google OAuth URL */
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

/** GET /api/auth/google/status — check if calendar is linked */
app.get("/auth/google/status", async (c) => {
  const initData = c.get("initData");
  const linked = await hasToken(String(initData.user.id));
  return c.json({ ok: true, data: { linked } });
});

export default app;
