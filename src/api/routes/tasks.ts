/**
 * REST API routes for Task Tracker.
 * Mounted at /api/tasks in router.ts.
 */

import { Hono } from "hono";
import {
  getUserWorks,
  getWorkWithTasks,
  createNewWork,
  removeWork,
  archiveWork,
  addTask,
  toggleTask,
  updateDeadline,
  updateText,
  removeTask,
  getCompletedHistory,
} from "../../services/tasksService.js";
import { logApiAction } from "../../logging/actionLogger.js";
import type { ApiEnv } from "../authMiddleware.js";

/**
 * Parse a deadline string from the webapp.
 * If the string has no timezone info (naive datetime from datetime-local input),
 * interpret it as MSK (UTC+3, no DST since 2014).
 */
function parseMskDeadline(deadline: string): Date {
  if (/[Zz]$/.test(deadline) || /[+-]\d{2}(:\d{2})?$/.test(deadline)) {
    return new Date(deadline);
  }
  return new Date(deadline + "+03:00");
}

const app = new Hono<ApiEnv>();

/** GET /api/tasks — list user's works */
app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const works = await getUserWorks(telegramId);
    return c.json({ ok: true, data: works });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get works";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/tasks — create work */
app.post("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ name: string; emoji?: string }>();

  if (!body.name?.trim()) {
    return c.json({ ok: false, error: "name is required" }, 400);
  }

  try {
    const work = await createNewWork(telegramId, body.name.trim(), body.emoji);
    return c.json({ ok: true, data: work });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create work";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/tasks/:id — work with tasks */
app.get("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const workId = parseInt(c.req.param("id"), 10);

  if (isNaN(workId)) {
    return c.json({ ok: false, error: "Invalid work ID" }, 400);
  }

  try {
    const result = await getWorkWithTasks(telegramId, workId);
    if (!result) {
      return c.json({ ok: false, error: "Work not found" }, 404);
    }
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get work";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/tasks/:id — delete work */
app.delete("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const workId = parseInt(c.req.param("id"), 10);

  if (isNaN(workId)) {
    return c.json({ ok: false, error: "Invalid work ID" }, 400);
  }

  try {
    const deleted = await removeWork(telegramId, workId);
    if (!deleted) {
      return c.json({ ok: false, error: "Work not found" }, 404);
    }
    return c.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete work";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/tasks/:id/archive — archive work */
app.put("/:id/archive", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const workId = parseInt(c.req.param("id"), 10);

  if (isNaN(workId)) {
    return c.json({ ok: false, error: "Invalid work ID" }, 400);
  }

  try {
    const archived = await archiveWork(telegramId, workId);
    if (!archived) {
      return c.json({ ok: false, error: "Work not found" }, 404);
    }
    return c.json({ ok: true, data: archived });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to archive work";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/tasks/:id/items — add task to work */
app.post("/:id/items", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const workId = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{ text: string; deadline: string }>();

  if (isNaN(workId)) {
    return c.json({ ok: false, error: "Invalid work ID" }, 400);
  }
  if (!body.text?.trim()) {
    return c.json({ ok: false, error: "text is required" }, 400);
  }
  if (!body.deadline) {
    return c.json({ ok: false, error: "deadline is required" }, 400);
  }

  const deadlineDate = parseMskDeadline(body.deadline);
  if (isNaN(deadlineDate.getTime())) {
    return c.json({ ok: false, error: "Invalid deadline format" }, 400);
  }

  try {
    const item = await addTask(telegramId, workId, body.text.trim(), deadlineDate);
    logApiAction(telegramId, "task_add", { workId, text: body.text.trim() });
    return c.json({ ok: true, data: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add task";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/tasks/:id/history — completed tasks */
app.get("/:id/history", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const workId = parseInt(c.req.param("id"), 10);

  if (isNaN(workId)) {
    return c.json({ ok: false, error: "Invalid work ID" }, 400);
  }

  try {
    const history = await getCompletedHistory(telegramId, workId);
    return c.json({ ok: true, data: history });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get history";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/tasks/items/:itemId/toggle — toggle completion */
app.put("/items/:itemId/toggle", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const itemId = parseInt(c.req.param("itemId"), 10);

  if (isNaN(itemId)) {
    return c.json({ ok: false, error: "Invalid item ID" }, 400);
  }

  try {
    const toggled = await toggleTask(telegramId, itemId);
    if (!toggled) {
      return c.json({ ok: false, error: "Task not found" }, 404);
    }
    logApiAction(telegramId, "task_complete", { itemId, completed: toggled.completedAt !== null });
    return c.json({ ok: true, data: toggled });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to toggle task";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/tasks/items/:itemId/deadline — update deadline */
app.put("/items/:itemId/deadline", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const itemId = parseInt(c.req.param("itemId"), 10);
  const body = await c.req.json<{ deadline: string }>();

  if (isNaN(itemId)) {
    return c.json({ ok: false, error: "Invalid item ID" }, 400);
  }
  if (!body.deadline) {
    return c.json({ ok: false, error: "deadline is required" }, 400);
  }

  const deadlineDate = parseMskDeadline(body.deadline);
  if (isNaN(deadlineDate.getTime())) {
    return c.json({ ok: false, error: "Invalid deadline format" }, 400);
  }

  try {
    const updated = await updateDeadline(telegramId, itemId, deadlineDate);
    if (!updated) {
      return c.json({ ok: false, error: "Task not found" }, 404);
    }
    return c.json({ ok: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update deadline";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/tasks/items/:itemId/text — update text */
app.put("/items/:itemId/text", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const itemId = parseInt(c.req.param("itemId"), 10);
  const body = await c.req.json<{ text: string }>();

  if (isNaN(itemId)) {
    return c.json({ ok: false, error: "Invalid item ID" }, 400);
  }
  if (!body.text?.trim()) {
    return c.json({ ok: false, error: "text is required" }, 400);
  }

  try {
    const updated = await updateText(telegramId, itemId, body.text.trim());
    if (!updated) {
      return c.json({ ok: false, error: "Task not found" }, 404);
    }
    logApiAction(telegramId, "task_edit", { itemId });
    return c.json({ ok: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update text";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/tasks/items/:itemId — delete task */
app.delete("/items/:itemId", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const itemId = parseInt(c.req.param("itemId"), 10);

  if (isNaN(itemId)) {
    return c.json({ ok: false, error: "Invalid item ID" }, 400);
  }

  try {
    const deleted = await removeTask(telegramId, itemId);
    if (!deleted) {
      return c.json({ ok: false, error: "Task not found" }, 404);
    }
    logApiAction(telegramId, "task_delete", { itemId });
    return c.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete task";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
