import { Hono } from "hono";
import {
  getUserRubrics,
  createNewRubric,
  removeRubric,
  toggleRubricActive,
  getRubricChannels,
  addChannelToRubric,
  removeChannelFromRubric,
} from "../../services/digestService.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

/** GET /api/digest/rubrics — list rubrics */
app.get("/rubrics", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const rubrics = await getUserRubrics(telegramId);
    return c.json({ ok: true, data: rubrics });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get rubrics";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/digest/rubrics — create rubric */
app.post("/rubrics", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{
    name: string;
    description?: string;
    emoji?: string;
    keywords?: string[];
  }>();

  if (!body.name?.trim()) {
    return c.json({ ok: false, error: "name is required" }, 400);
  }

  try {
    const rubric = await createNewRubric(telegramId, {
      name: body.name.trim(),
      description: body.description,
      emoji: body.emoji,
      keywords: body.keywords,
    });
    return c.json({ ok: true, data: rubric });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create rubric";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/digest/rubrics/:id/channels — list channels */
app.get("/rubrics/:id/channels", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const rubricId = parseInt(c.req.param("id"), 10);

  if (isNaN(rubricId)) {
    return c.json({ ok: false, error: "Invalid rubric ID" }, 400);
  }

  try {
    const channels = await getRubricChannels(telegramId, rubricId);
    return c.json({ ok: true, data: channels });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get channels";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/digest/rubrics/:id/channels — add channel */
app.post("/rubrics/:id/channels", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const rubricId = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{ channelUsername: string }>();

  if (isNaN(rubricId)) {
    return c.json({ ok: false, error: "Invalid rubric ID" }, 400);
  }
  if (!body.channelUsername?.trim()) {
    return c.json({ ok: false, error: "channelUsername is required" }, 400);
  }

  try {
    const channel = await addChannelToRubric(telegramId, rubricId, body.channelUsername.trim());
    return c.json({ ok: true, data: channel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add channel";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/digest/channels/:channelId — remove channel */
app.delete("/channels/:channelId", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const channelId = parseInt(c.req.param("channelId"), 10);

  if (isNaN(channelId)) {
    return c.json({ ok: false, error: "Invalid channel ID" }, 400);
  }

  // removeChannelFromRubric requires rubricId for ownership verification.
  // The channelId alone is not enough; we need rubricId from query or body.
  const rubricId = parseInt(c.req.query("rubricId") ?? "0", 10);
  if (!rubricId) {
    return c.json({ ok: false, error: "rubricId query parameter is required" }, 400);
  }

  try {
    const deleted = await removeChannelFromRubric(telegramId, rubricId, channelId);
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to remove channel";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/digest/rubrics/:id — delete rubric */
app.delete("/rubrics/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const rubricId = parseInt(c.req.param("id"), 10);

  if (isNaN(rubricId)) {
    return c.json({ ok: false, error: "Invalid rubric ID" }, 400);
  }

  try {
    const deleted = await removeRubric(telegramId, rubricId);
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete rubric";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/digest/rubrics/:id/toggle — toggle rubric active/inactive */
app.put("/rubrics/:id/toggle", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const rubricId = parseInt(c.req.param("id"), 10);

  if (isNaN(rubricId)) {
    return c.json({ ok: false, error: "Invalid rubric ID" }, 400);
  }

  try {
    const rubric = await toggleRubricActive(telegramId, rubricId);
    return c.json({ ok: true, data: rubric });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to toggle rubric";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
