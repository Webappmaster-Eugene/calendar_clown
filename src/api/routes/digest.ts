import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
import {
  getUserRubrics,
  createNewRubric,
  editRubric,
  removeRubric,
  toggleRubricActive,
  getRubricChannels,
  addChannelToRubric,
  removeChannelFromRubric,
} from "../../services/digestService.js";
import type { ApiEnv } from "../authMiddleware.js";
import { logApiAction } from "../../logging/actionLogger.js";

const app = new Hono<ApiEnv>();

// ── Input schemas (json bodies + path id params). Query params keep the
//    handlers' own defensive parsing. Schemas mirror what handlers accept.
const idParam = z.object({ id: z.coerce.number().int().positive() });
const channelIdParam = z.object({ channelId: z.coerce.number().int().positive() });
const createRubricBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  emoji: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});
const editRubricBody = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  emoji: z.string().nullable().optional(),
  keywords: z.array(z.string()).optional(),
});
const addChannelBody = z.object({
  channelUsername: z.string().min(1),
});

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
app.post("/rubrics", zValidator("json", createRubricBody), async (c) => {
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
    logApiAction(telegramId, "digest_rubric_create", { name: body.name.trim() });
    return c.json({ ok: true, data: rubric });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create rubric";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/digest/rubrics/:id — edit rubric */
app.put("/rubrics/:id", zValidator("param", idParam), zValidator("json", editRubricBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const rubricId = parseInt(c.req.param("id"), 10);

  if (isNaN(rubricId)) {
    return c.json({ ok: false, error: "Invalid rubric ID" }, 400);
  }

  const body = await c.req.json<{
    name?: string;
    description?: string | null;
    emoji?: string | null;
    keywords?: string[];
  }>();

  const hasField =
    body.name !== undefined ||
    body.description !== undefined ||
    body.emoji !== undefined ||
    body.keywords !== undefined;

  if (!hasField) {
    return c.json({ ok: false, error: "At least one field is required" }, 400);
  }

  if (body.name !== undefined && !body.name.trim()) {
    return c.json({ ok: false, error: "name cannot be empty" }, 400);
  }

  try {
    const rubric = await editRubric(telegramId, rubricId, {
      name: body.name?.trim(),
      description: body.description,
      emoji: body.emoji,
      keywords: body.keywords,
    });
    if (!rubric) {
      return c.json({ ok: false, error: "Rubric not found" }, 404);
    }
    return c.json({ ok: true, data: rubric });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to edit rubric";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/digest/rubrics/:id/channels — list channels */
app.get("/rubrics/:id/channels", zValidator("param", idParam), async (c) => {
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
app.post("/rubrics/:id/channels", zValidator("param", idParam), zValidator("json", addChannelBody), async (c) => {
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
    logApiAction(telegramId, "digest_channel_add", { rubricId, channel: body.channelUsername.trim() });
    return c.json({ ok: true, data: channel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add channel";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/digest/channels/:channelId — remove channel */
app.delete("/channels/:channelId", zValidator("param", channelIdParam), async (c) => {
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
    logApiAction(telegramId, "digest_channel_remove", { rubricId, channelId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to remove channel";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/digest/rubrics/:id — delete rubric */
app.delete("/rubrics/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const rubricId = parseInt(c.req.param("id"), 10);

  if (isNaN(rubricId)) {
    return c.json({ ok: false, error: "Invalid rubric ID" }, 400);
  }

  try {
    const deleted = await removeRubric(telegramId, rubricId);
    logApiAction(telegramId, "digest_rubric_delete", { rubricId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete rubric";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/digest/rubrics/:id/toggle — toggle rubric active/inactive */
app.put("/rubrics/:id/toggle", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const rubricId = parseInt(c.req.param("id"), 10);

  if (isNaN(rubricId)) {
    return c.json({ ok: false, error: "Invalid rubric ID" }, 400);
  }

  try {
    const rubric = await toggleRubricActive(telegramId, rubricId);
    if (!rubric) {
      return c.json({ ok: false, error: "Rubric not found" }, 404);
    }
    logApiAction(telegramId, "digest_rubric_toggle", { rubricId });
    return c.json({ ok: true, data: rubric });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to toggle rubric";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
