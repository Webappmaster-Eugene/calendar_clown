import { Hono } from "hono";
import {
  getUserGoalSets,
  createNewGoalSet,
  getGoalSetWithGoals,
  addGoal,
  toggleGoal,
  editGoalText,
  removeGoalSet,
  removeGoal,
  updateGoalSetProps,
  getFriendsGoalSets,
  getGoalSetViewers,
  addGoalSetViewer,
  removeGoalSetViewer,
} from "../../services/goalsService.js";
import type { ApiEnv } from "../authMiddleware.js";
import { logApiAction } from "../../logging/actionLogger.js";

const app = new Hono<ApiEnv>();

/** GET /api/goals — list goal sets */
app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const goalSets = await getUserGoalSets(telegramId);
    return c.json({ ok: true, data: goalSets });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get goal sets";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/goals/shared — friends' public goal sets */
app.get("/shared", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const sets = await getFriendsGoalSets(telegramId);
    return c.json({ ok: true, data: sets });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get shared goals";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/goals — create goal set */
app.post("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ name: string; period: string; emoji?: string }>();

  if (!body.name?.trim() || !body.period) {
    return c.json({ ok: false, error: "name and period are required" }, 400);
  }

  try {
    const goalSet = await createNewGoalSet(
      telegramId,
      body.name.trim(),
      body.period as Parameters<typeof createNewGoalSet>[2],
      body.emoji
    );
    logApiAction(telegramId, "goal_set_create", { name: body.name.trim(), period: body.period });
    return c.json({ ok: true, data: goalSet });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create goal set";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/goals/:id — get goal set with goals */
app.get("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const goalSetId = parseInt(c.req.param("id"), 10);

  if (isNaN(goalSetId)) {
    return c.json({ ok: false, error: "Invalid goal set ID" }, 400);
  }

  try {
    const result = await getGoalSetWithGoals(telegramId, goalSetId);
    if (!result) {
      return c.json({ ok: false, error: "Goal set not found" }, 404);
    }
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get goal set";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/goals/:id — update goal set (name, emoji, visibility) */
app.put("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const goalSetId = parseInt(c.req.param("id"), 10);

  if (isNaN(goalSetId)) {
    return c.json({ ok: false, error: "Invalid goal set ID" }, 400);
  }

  const body = await c.req.json<{ name?: string; emoji?: string; visibility?: "public" | "private" }>();

  try {
    const updated = await updateGoalSetProps(telegramId, goalSetId, body);
    if (!updated) {
      return c.json({ ok: false, error: "Goal set not found" }, 404);
    }
    logApiAction(telegramId, "goal_set_update", { goalSetId, ...body });
    return c.json({ ok: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update goal set";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/goals/:id/viewers — list viewers */
app.get("/:id/viewers", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const goalSetId = parseInt(c.req.param("id"), 10);

  if (isNaN(goalSetId)) {
    return c.json({ ok: false, error: "Invalid goal set ID" }, 400);
  }

  try {
    const viewers = await getGoalSetViewers(telegramId, goalSetId);
    return c.json({ ok: true, data: viewers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get viewers";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/goals/:id/viewers — add viewer */
app.post("/:id/viewers", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const goalSetId = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{ userId: number }>();

  if (isNaN(goalSetId) || !body.userId) {
    return c.json({ ok: false, error: "goalSetId and userId are required" }, 400);
  }

  try {
    await addGoalSetViewer(telegramId, goalSetId, body.userId);
    logApiAction(telegramId, "goal_viewer_add", { goalSetId, viewerUserId: body.userId });
    return c.json({ ok: true, data: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add viewer";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/goals/:id/viewers/:userId — remove viewer */
app.delete("/:id/viewers/:userId", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const goalSetId = parseInt(c.req.param("id"), 10);
  const viewerUserId = parseInt(c.req.param("userId"), 10);

  if (isNaN(goalSetId) || isNaN(viewerUserId)) {
    return c.json({ ok: false, error: "Invalid IDs" }, 400);
  }

  try {
    await removeGoalSetViewer(telegramId, goalSetId, viewerUserId);
    logApiAction(telegramId, "goal_viewer_remove", { goalSetId, viewerUserId });
    return c.json({ ok: true, data: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to remove viewer";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/goals/:id/goals — add goal to set */
app.post("/:id/goals", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const goalSetId = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{ text: string }>();

  if (isNaN(goalSetId)) {
    return c.json({ ok: false, error: "Invalid goal set ID" }, 400);
  }
  if (!body.text?.trim()) {
    return c.json({ ok: false, error: "text is required" }, 400);
  }

  try {
    const goal = await addGoal(telegramId, goalSetId, body.text.trim());
    logApiAction(telegramId, "goal_add", { goalSetId, text: body.text.trim() });
    return c.json({ ok: true, data: goal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add goal";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/goals/goals/:goalId — update goal text */
app.put("/goals/:goalId", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const goalId = parseInt(c.req.param("goalId"), 10);

  if (isNaN(goalId)) {
    return c.json({ ok: false, error: "Invalid goal ID" }, 400);
  }

  const body = await c.req.json<{ text: string }>();
  if (!body.text?.trim()) {
    return c.json({ ok: false, error: "text is required" }, 400);
  }

  try {
    const goal = await editGoalText(telegramId, goalId, body.text.trim());
    if (!goal) {
      return c.json({ ok: false, error: "Goal not found" }, 404);
    }
    return c.json({ ok: true, data: goal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update goal";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/goals/goals/:goalId/toggle — toggle goal completion */
app.put("/goals/:goalId/toggle", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const goalId = parseInt(c.req.param("goalId"), 10);

  if (isNaN(goalId)) {
    return c.json({ ok: false, error: "Invalid goal ID" }, 400);
  }

  try {
    const goal = await toggleGoal(telegramId, goalId);
    if (!goal) {
      return c.json({ ok: false, error: "Goal not found" }, 404);
    }
    logApiAction(telegramId, "goal_toggle", { goalId });
    return c.json({ ok: true, data: goal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to toggle goal";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/goals/goals/:goalId — delete individual goal */
app.delete("/goals/:goalId", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const goalId = parseInt(c.req.param("goalId"), 10);

  if (isNaN(goalId)) {
    return c.json({ ok: false, error: "Invalid goal ID" }, 400);
  }

  try {
    const deleted = await removeGoal(telegramId, goalId);
    logApiAction(telegramId, "goal_delete", { goalId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete goal";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/goals/:id — delete goal set */
app.delete("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const goalSetId = parseInt(c.req.param("id"), 10);

  if (isNaN(goalSetId)) {
    return c.json({ ok: false, error: "Invalid goal set ID" }, 400);
  }

  try {
    const deleted = await removeGoalSet(telegramId, goalSetId);
    logApiAction(telegramId, "goal_set_delete", { goalSetId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete goal set";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
