import { Hono } from "hono";
import {
  getSearchHistory,
  getSearch,
  initiateSearch,
} from "../../services/osintService.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

/** GET /api/osint — search history */
app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const result = await getSearchHistory(telegramId);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get search history";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/osint/:id — search by ID */
app.get("/:id", async (c) => {
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
app.post("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ query: string }>();

  if (!body.query?.trim()) {
    return c.json({ ok: false, error: "query is required" }, 400);
  }

  try {
    const search = await initiateSearch(telegramId, body.query.trim());
    return c.json({ ok: true, data: search });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start search";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
