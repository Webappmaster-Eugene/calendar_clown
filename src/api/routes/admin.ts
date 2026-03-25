import { Hono } from "hono";
import {
  listUsers,
  getPendingUsers,
  approveUserById,
  rejectUserById,
  addUser,
  removeUser,
  assignUserToTribe,
  removeUserTribe,
  getTribes,
  createNewTribe,
  editTribe,
  removeTribe,
  getGlobalStats,
} from "../../services/adminService.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

/** GET /api/admin/users — list users */
app.get("/users", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const users = await listUsers(telegramId);
    return c.json({ ok: true, data: users });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get users";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/admin/users/pending — pending users */
app.get("/users/pending", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const users = await getPendingUsers(telegramId);
    return c.json({ ok: true, data: users });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get pending users";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/admin/users — add user by Telegram ID */
app.post("/users", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ telegramId: number }>();

  if (!body.telegramId || isNaN(body.telegramId)) {
    return c.json({ ok: false, error: "Valid telegramId is required" }, 400);
  }

  try {
    const added = await addUser(telegramId, body.telegramId);
    return c.json({ ok: true, data: { added } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add user";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/admin/users/:id/approve — approve user */
app.put("/users/:id/approve", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const targetTelegramId = parseInt(c.req.param("id"), 10);

  if (isNaN(targetTelegramId)) {
    return c.json({ ok: false, error: "Invalid user ID" }, 400);
  }

  try {
    const approved = await approveUserById(telegramId, targetTelegramId);
    return c.json({ ok: true, data: { approved } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to approve user";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/admin/users/:id/reject — reject user */
app.put("/users/:id/reject", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const targetTelegramId = parseInt(c.req.param("id"), 10);

  if (isNaN(targetTelegramId)) {
    return c.json({ ok: false, error: "Invalid user ID" }, 400);
  }

  try {
    const rejected = await rejectUserById(telegramId, targetTelegramId);
    return c.json({ ok: true, data: { rejected } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to reject user";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/admin/users/:id — remove user */
app.delete("/users/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const targetTelegramId = parseInt(c.req.param("id"), 10);

  if (isNaN(targetTelegramId)) {
    return c.json({ ok: false, error: "Invalid user ID" }, 400);
  }

  try {
    const removed = await removeUser(telegramId, targetTelegramId);
    return c.json({ ok: true, data: { removed } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to remove user";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/admin/users/:id/tribe — set tribe */
app.put("/users/:id/tribe", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const targetTelegramId = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{ tribeId: number }>();

  if (isNaN(targetTelegramId)) {
    return c.json({ ok: false, error: "Invalid user ID" }, 400);
  }
  if (!body.tribeId) {
    return c.json({ ok: false, error: "tribeId is required" }, 400);
  }

  try {
    const assigned = await assignUserToTribe(telegramId, targetTelegramId, body.tribeId);
    return c.json({ ok: true, data: { assigned } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to set tribe";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/admin/users/:id/tribe — remove from tribe */
app.delete("/users/:id/tribe", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const targetTelegramId = parseInt(c.req.param("id"), 10);

  if (isNaN(targetTelegramId)) {
    return c.json({ ok: false, error: "Invalid user ID" }, 400);
  }

  try {
    const removed = await removeUserTribe(telegramId, targetTelegramId);
    return c.json({ ok: true, data: { removed } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to remove from tribe";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/admin/tribes — list tribes */
app.get("/tribes", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const tribes = await getTribes(telegramId);
    return c.json({ ok: true, data: tribes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get tribes";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/admin/tribes — create tribe */
app.post("/tribes", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ name: string; monthlyLimit?: number }>();

  if (!body.name?.trim()) {
    return c.json({ ok: false, error: "name is required" }, 400);
  }

  try {
    const tribe = await createNewTribe(telegramId, body.name.trim());
    return c.json({ ok: true, data: tribe });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create tribe";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/admin/tribes/:id — edit tribe */
app.put("/tribes/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const tribeId = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{ name?: string; monthlyLimit?: number }>();

  if (isNaN(tribeId)) {
    return c.json({ ok: false, error: "Invalid tribe ID" }, 400);
  }

  try {
    const updated = await editTribe(telegramId, tribeId, { name: body.name, monthlyLimit: body.monthlyLimit });
    return c.json({ ok: true, data: { updated } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to edit tribe";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/admin/tribes/:id — delete tribe */
app.delete("/tribes/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const tribeId = parseInt(c.req.param("id"), 10);

  if (isNaN(tribeId)) {
    return c.json({ ok: false, error: "Invalid tribe ID" }, 400);
  }

  try {
    const removed = await removeTribe(telegramId, tribeId);
    return c.json({ ok: true, data: { removed } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete tribe";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/admin/stats — global stats */
app.get("/stats", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const stats = await getGlobalStats(telegramId);
    return c.json({ ok: true, data: stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get stats";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/admin/data/entities — list available entity types */
app.get("/data/entities", async (c) => {
  const { ENTITY_LABELS } = await import("../../services/adminDataService.js");
  const entities = Object.entries(ENTITY_LABELS).map(([key, val]) => ({
    key,
    ...val,
  }));
  return c.json({ ok: true, data: entities });
});

/** GET /api/admin/data/:entity — paginated entity list */
app.get("/data/:entity", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const entity = c.req.param("entity");
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 50);
  const offset = (page - 1) * limit;

  try {
    const { getEntityList } = await import("../../services/adminDataService.js");
    const result = await getEntityList(telegramId, entity as never, limit, offset);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get data";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/admin/data/:entity/:id — delete single entity */
app.delete("/data/:entity/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const entity = c.req.param("entity");
  const entityId = parseInt(c.req.param("id"), 10);

  if (isNaN(entityId)) {
    return c.json({ ok: false, error: "Invalid entity ID" }, 400);
  }

  try {
    const { deleteEntity } = await import("../../services/adminDataService.js");
    const deleted = await deleteEntity(telegramId, entity as never, entityId);
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/admin/data/:entity — delete all entities of type */
app.delete("/data/:entity", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const entity = c.req.param("entity");
  const confirm = c.req.query("confirm");

  if (confirm !== "yes") {
    return c.json({ ok: false, error: "Add ?confirm=yes to confirm deletion of all items" }, 400);
  }

  try {
    const { deleteAllEntitiesOfType } = await import("../../services/adminDataService.js");
    const count = await deleteAllEntitiesOfType(telegramId, entity as never);
    return c.json({ ok: true, data: { deletedCount: count } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete all";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/admin/build-info — build version */
app.get("/build-info", async (c) => {
  const commitHash = process.env.COMMIT_HASH ?? process.env.SOURCE_COMMIT ?? "unknown";
  const buildDate = process.env.BUILD_DATE ?? new Date().toISOString();
  return c.json({
    ok: true,
    data: { commitHash, buildDate },
  });
});

export default app;
