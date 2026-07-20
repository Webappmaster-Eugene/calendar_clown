import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
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
import {
  getPeriodRange,
  collectSummaryData,
  isEmptyData,
  generateAiSummary,
} from "../../services/adminSummaryService.js";
import { isBootstrapAdmin } from "../../middleware/auth.js";
import { getActionLogs, getDistinctActions, logApiAction } from "../../logging/actionLogger.js";
import type { SummaryPeriod } from "../../shared/types.js";
import type { ApiEnv } from "../authMiddleware.js";
import { BUILD_COMMIT, BUILD_DATE, COMMIT_DATE } from "../../buildInfo.js";

const VALID_SUMMARY_PERIODS = new Set<string>(["today", "yesterday", "week", "month", "year"]);

const app = new Hono<ApiEnv>();

const idParam = z.object({ id: z.coerce.number().int().positive() });
const wishlistIdParam = z.object({ wishlistId: z.coerce.number().int().positive() });
// :entity is a free-form string key; only :id is numeric here.
const entityIdParam = z.object({ id: z.coerce.number().int().positive() });

const AddUserSchema = z.object({ telegramId: z.number() });
const SetTribeSchema = z.object({ tribeId: z.number() });
const CreateTribeSchema = z.object({ name: z.string(), monthlyLimit: z.number().optional() });
const EditTribeSchema = z.object({ name: z.string().optional(), monthlyLimit: z.number().optional() });
const SummaryAiSchema = z.object({ period: z.string() });
const EditEntitySchema = z.record(z.string(), z.unknown());

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

app.post("/users", zValidator("json", AddUserSchema), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ telegramId: number }>();

  if (!body.telegramId || isNaN(body.telegramId)) {
    return c.json({ ok: false, error: "Valid telegramId is required" }, 400);
  }

  try {
    const added = await addUser(telegramId, body.telegramId);
    logApiAction(telegramId, "admin_user_add", { targetTelegramId: body.telegramId });
    return c.json({ ok: true, data: { added } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add user";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/users/:id/approve", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const targetTelegramId = parseInt(c.req.param("id"), 10);

  if (isNaN(targetTelegramId)) {
    return c.json({ ok: false, error: "Invalid user ID" }, 400);
  }

  try {
    const approved = await approveUserById(telegramId, targetTelegramId);
    logApiAction(telegramId, "admin_user_approve", { targetTelegramId });
    return c.json({ ok: true, data: { approved } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to approve user";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/users/:id/reject", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const targetTelegramId = parseInt(c.req.param("id"), 10);

  if (isNaN(targetTelegramId)) {
    return c.json({ ok: false, error: "Invalid user ID" }, 400);
  }

  try {
    const rejected = await rejectUserById(telegramId, targetTelegramId);
    logApiAction(telegramId, "admin_user_reject", { targetTelegramId });
    return c.json({ ok: true, data: { rejected } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to reject user";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/users/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const targetTelegramId = parseInt(c.req.param("id"), 10);

  if (isNaN(targetTelegramId)) {
    return c.json({ ok: false, error: "Invalid user ID" }, 400);
  }

  try {
    const removed = await removeUser(telegramId, targetTelegramId);
    logApiAction(telegramId, "admin_user_remove", { targetTelegramId });
    return c.json({ ok: true, data: { removed } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to remove user";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/users/:id/tribe", zValidator("param", idParam), zValidator("json", SetTribeSchema), async (c) => {
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
    logApiAction(telegramId, "admin_tribe_assign", { targetTelegramId, tribeId: body.tribeId });
    return c.json({ ok: true, data: { assigned } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to set tribe";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/users/:id/tribe", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const targetTelegramId = parseInt(c.req.param("id"), 10);

  if (isNaN(targetTelegramId)) {
    return c.json({ ok: false, error: "Invalid user ID" }, 400);
  }

  try {
    const removed = await removeUserTribe(telegramId, targetTelegramId);
    logApiAction(telegramId, "admin_tribe_remove", { targetTelegramId });
    return c.json({ ok: true, data: { removed } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to remove from tribe";
    return c.json({ ok: false, error: msg }, 500);
  }
});

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

app.post("/tribes", zValidator("json", CreateTribeSchema), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ name: string; monthlyLimit?: number }>();

  if (!body.name?.trim()) {
    return c.json({ ok: false, error: "name is required" }, 400);
  }

  try {
    const tribe = await createNewTribe(telegramId, body.name.trim());
    logApiAction(telegramId, "admin_tribe_create", { name: body.name.trim() });
    return c.json({ ok: true, data: tribe });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create tribe";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/tribes/:id", zValidator("param", idParam), zValidator("json", EditTribeSchema), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const tribeId = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{ name?: string; monthlyLimit?: number }>();

  if (isNaN(tribeId)) {
    return c.json({ ok: false, error: "Invalid tribe ID" }, 400);
  }

  try {
    const updated = await editTribe(telegramId, tribeId, { name: body.name, monthlyLimit: body.monthlyLimit });
    logApiAction(telegramId, "admin_tribe_edit", { tribeId });
    return c.json({ ok: true, data: { updated } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to edit tribe";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/tribes/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const tribeId = parseInt(c.req.param("id"), 10);

  if (isNaN(tribeId)) {
    return c.json({ ok: false, error: "Invalid tribe ID" }, 400);
  }

  try {
    const removed = await removeTribe(telegramId, tribeId);
    logApiAction(telegramId, "admin_tribe_delete", { tribeId });
    return c.json({ ok: true, data: { removed } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete tribe";
    return c.json({ ok: false, error: msg }, 500);
  }
});

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

app.get("/summary", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const period = (c.req.query("period") ?? "today") as SummaryPeriod;

  if (!VALID_SUMMARY_PERIODS.has(period)) {
    return c.json({ ok: false, error: "Invalid period. Use: today, yesterday, week, month, year" }, 400);
  }

  try {
    if (!isBootstrapAdmin(telegramId)) {
      return c.json({ ok: false, error: "Admin access required" }, 403);
    }

    const range = getPeriodRange(period);
    const data = await collectSummaryData(range);

    return c.json({
      ok: true,
      data: {
        ...data,
        period: {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          label: range.label,
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get summary";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/summary/ai", zValidator("json", SummaryAiSchema), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ period: SummaryPeriod }>();

  if (!body.period || !VALID_SUMMARY_PERIODS.has(body.period)) {
    return c.json({ ok: false, error: "Invalid period" }, 400);
  }

  try {
    if (!isBootstrapAdmin(telegramId)) {
      return c.json({ ok: false, error: "Admin access required" }, 403);
    }

    const range = getPeriodRange(body.period);
    const data = await collectSummaryData(range);

    if (isEmptyData(data)) {
      return c.json({ ok: true, data: { text: "За этот период активности не обнаружено." } });
    }

    const text = await generateAiSummary(data);
    return c.json({ ok: true, data: { text } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate AI summary";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/data/entities", async (c) => {
  const { ENTITY_LABELS, ENTITY_EDIT_FIELDS } = await import("../../services/adminDataService.js");
  const entities = Object.entries(ENTITY_LABELS).map(([key, val]) => ({
    key,
    ...val,
    editable: key in ENTITY_EDIT_FIELDS,
    editFields: ENTITY_EDIT_FIELDS[key as keyof typeof ENTITY_EDIT_FIELDS] ?? [],
  }));
  return c.json({ ok: true, data: entities });
});

app.get("/data/wishlists/:wishlistId/items", zValidator("param", wishlistIdParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const wishlistId = parseInt(c.req.param("wishlistId"), 10);
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 50);
  const offset = (page - 1) * limit;

  if (isNaN(wishlistId)) {
    return c.json({ ok: false, error: "Invalid wishlist ID" }, 400);
  }

  try {
    const { getWishlistItemsList } = await import("../../services/adminDataService.js");
    const result = await getWishlistItemsList(telegramId, wishlistId, limit, offset);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get wishlist items";
    return c.json({ ok: false, error: msg }, 500);
  }
});

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

app.put("/data/:entity/:id", zValidator("param", entityIdParam), zValidator("json", EditEntitySchema), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const entity = c.req.param("entity");
  const entityId = parseInt(c.req.param("id"), 10);

  if (isNaN(entityId)) {
    return c.json({ ok: false, error: "Invalid entity ID" }, 400);
  }

  try {
    const body = await c.req.json<Record<string, unknown>>();
    const { editEntity } = await import("../../services/adminDataService.js");
    const updated = await editEntity(telegramId, entity as never, entityId, body);
    logApiAction(telegramId, "admin_data_edit", { entity, entityId });
    return c.json({ ok: true, data: { updated } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to edit";
    const status = msg.includes("not supported") ? 400 : 500;
    return c.json({ ok: false, error: msg }, status);
  }
});

app.delete("/data/:entity/:id", zValidator("param", entityIdParam), async (c) => {
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
    logApiAction(telegramId, "admin_data_delete", { entity, entityId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete";
    return c.json({ ok: false, error: msg }, 500);
  }
});

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
    logApiAction(telegramId, "admin_data_delete_all", { entity, deletedCount: count });
    return c.json({ ok: true, data: { deletedCount: count } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete all";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/logs", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  if (!isBootstrapAdmin(telegramId)) {
    return c.json({ ok: false, error: "Admin access required" }, 403);
  }

  try {
    const filters = {
      userId: c.req.query("userId") ? parseInt(c.req.query("userId")!, 10) : undefined,
      telegramId: c.req.query("telegramId") ? parseInt(c.req.query("telegramId")!, 10) : undefined,
      action: c.req.query("action") || undefined,
      search: c.req.query("search") || undefined,
      dateFrom: c.req.query("dateFrom") || undefined,
      dateTo: c.req.query("dateTo") || undefined,
      limit: Math.min(parseInt(c.req.query("limit") ?? "50", 10), 100),
      offset: parseInt(c.req.query("offset") ?? "0", 10),
    };

    const result = await getActionLogs(filters);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get logs";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/logs/actions", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  if (!isBootstrapAdmin(telegramId)) {
    return c.json({ ok: false, error: "Admin access required" }, 403);
  }

  try {
    const actions = await getDistinctActions();
    return c.json({ ok: true, data: actions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get actions";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/build-info", async (c) => {
  const uptimeSeconds = Math.floor(process.uptime());
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);

  const memUsage = process.memoryUsage();

  return c.json({
    ok: true,
    data: {
      commitHash: BUILD_COMMIT,
      buildDate: BUILD_DATE,
      commitDate: COMMIT_DATE,
      nodeVersion: process.version,
      uptime: `${hours}ч ${minutes}м`,
      uptimeSeconds,
      memoryMb: {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      env: process.env.NODE_ENV ?? "production",
    },
  });
});

export default app;
