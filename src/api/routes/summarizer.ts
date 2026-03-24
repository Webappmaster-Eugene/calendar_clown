import { Hono } from "hono";
import {
  getUserWorkplaces,
  createNewWorkplace,
  getWorkplaceAchievements,
  addAchievement,
  generateSummary,
} from "../../services/summarizerService.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

/** GET /api/summarizer/workplaces — list workplaces */
app.get("/workplaces", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const workplaces = await getUserWorkplaces(telegramId);
    return c.json({ ok: true, data: workplaces });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get workplaces";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/summarizer/workplaces — create workplace */
app.post("/workplaces", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ title: string; company?: string }>();

  if (!body.title?.trim()) {
    return c.json({ ok: false, error: "title is required" }, 400);
  }

  try {
    const workplace = await createNewWorkplace(telegramId, body.title.trim(), body.company);
    return c.json({ ok: true, data: workplace });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create workplace";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/summarizer/workplaces/:id/achievements — list achievements */
app.get("/workplaces/:id/achievements", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const workplaceId = parseInt(c.req.param("id"), 10);

  if (isNaN(workplaceId)) {
    return c.json({ ok: false, error: "Invalid workplace ID" }, 400);
  }

  try {
    const achievements = await getWorkplaceAchievements(telegramId, workplaceId);
    return c.json({ ok: true, data: achievements });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get achievements";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/summarizer/achievements — add achievement */
app.post("/achievements", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ workplaceId: number; text: string }>();

  if (!body.workplaceId || !body.text?.trim()) {
    return c.json({ ok: false, error: "workplaceId and text are required" }, 400);
  }

  try {
    const achievement = await addAchievement(telegramId, body.workplaceId, body.text.trim());
    return c.json({ ok: true, data: achievement });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add achievement";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/summarizer/workplaces/:id/summary — generate summary */
app.post("/workplaces/:id/summary", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const workplaceId = parseInt(c.req.param("id"), 10);

  if (isNaN(workplaceId)) {
    return c.json({ ok: false, error: "Invalid workplace ID" }, 400);
  }

  try {
    const summary = await generateSummary(telegramId, workplaceId);
    return c.json({ ok: true, data: summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate summary";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
