import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
import {
  getSearchHistory,
  getSearch,
  initiateSearch,
} from "../../services/osintService.js";
import type { ApiEnv } from "../authMiddleware.js";
import { logApiAction } from "../../logging/actionLogger.js";

const app = new Hono<ApiEnv>();

// ── Input schemas (json body + :id param). Query params keep the handler's
//    own defensive parsing. Schema mirrors what the handler accepts.
const idParam = z.object({ id: z.coerce.number().int().positive() });
const startSearchBody = z.object({
  query: z.string().min(1),
});

/** GET /api/osint — search history */
app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  try {
    const result = await getSearchHistory(telegramId, limit, offset);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get search history";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/osint/:id — search by ID */
app.get("/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const searchId = parseInt(c.req.param("id"), 10);

  if (isNaN(searchId)) {
    return c.json({ ok: false, error: "Invalid search ID" }, 400);
  }

  try {
    const search = await getSearch(telegramId, searchId);
    if (!search) {
      return c.json({ ok: false, error: "Search not found" }, 404);
    }
    return c.json({ ok: true, data: search });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get search";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/osint — start search */
app.post("/", zValidator("json", startSearchBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ query: string }>();

  if (!body.query?.trim()) {
    return c.json({ ok: false, error: "query is required" }, 400);
  }

  try {
    const search = await initiateSearch(telegramId, body.query.trim());
    logApiAction(telegramId, "osint_search_start", { query: body.query.trim() });
    return c.json({ ok: true, data: search });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start search";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
