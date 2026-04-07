/**
 * Nutritionist API routes for Mini App.
 */
import { Hono } from "hono";
import {
  getHistory,
  getAnalysis,
  removeAnalysis,
  analyzePhoto,
  getDailySummary,
  saveManualCalculation,
} from "../../services/nutritionistService.js";
import type { ManualCalcRequest } from "../../shared/types.js";
import { TIMEZONE_MSK } from "../../constants.js";
import { logApiAction } from "../../logging/actionLogger.js";
import type { ApiEnv } from "../authMiddleware.js";
import { createLogger } from "../../utils/logger.js";
import productsRoutes from "./nutritionist-products.js";

const log = createLogger("nutritionist-route");

const app = new Hono<ApiEnv>();

// Mount the product catalog sub-router FIRST so its paths win over the
// generic /:id analysis routes below.
app.route("/products", productsRoutes);

/** GET /api/nutritionist — analysis history */
app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10) || 10, 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  try {
    const result = await getHistory(telegramId, limit, offset);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get nutritionist history";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/nutritionist/daily — daily summary */
app.get("/daily", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const date = c.req.query("date")
    ?? new Date().toLocaleDateString("sv-SE", { timeZone: TIMEZONE_MSK });

  try {
    const result = await getDailySummary(telegramId, date);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get daily summary";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/nutritionist/manual — save manual KBZHU calculation */
app.post("/manual", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const body = await c.req.json<ManualCalcRequest>();
    const result = await saveManualCalculation(telegramId, body);
    logApiAction(telegramId, "nutritionist_manual_calc", {
      itemsCount: body.items.length,
      servings: body.servings ?? 1,
    });
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка при сохранении расчёта";
    log.error("Manual calc error for user %d: %s", telegramId, msg);
    return c.json({ ok: false, error: msg }, 400);
  }
});

/** GET /api/nutritionist/:id — single analysis */
app.get("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const id = parseInt(c.req.param("id"), 10);

  if (isNaN(id)) {
    return c.json({ ok: false, error: "Invalid analysis ID" }, 400);
  }

  try {
    const item = await getAnalysis(telegramId, id);
    if (!item) {
      return c.json({ ok: false, error: "Analysis not found" }, 404);
    }
    return c.json({ ok: true, data: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get analysis";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/nutritionist/analyze — analyze food photo */
app.post("/analyze", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const formData = await c.req.formData();
    const imageFile = formData.get("image");
    const caption = (formData.get("caption") as string | null)?.trim() || null;

    if (!imageFile || !(imageFile instanceof File)) {
      return c.json({ ok: false, error: "image file is required (multipart field 'image')" }, 400);
    }

    if (imageFile.size > 15 * 1024 * 1024) {
      return c.json({ ok: false, error: "File too large (max 15 MB)" }, 400);
    }

    const mimeType = imageFile.type || "image/jpeg";
    if (!mimeType.startsWith("image/")) {
      return c.json({ ok: false, error: "Only image files are accepted" }, 400);
    }

    const arrayBuffer = await imageFile.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const result = await analyzePhoto(
      telegramId,
      base64,
      mimeType,
      null, // no Telegram file ID from webapp
      caption,
    );

    logApiAction(telegramId, "nutritionist_photo_analyze", { hasCaption: !!caption });
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to analyze photo";
    log.error("Nutritionist analyze error for user %d: %s", telegramId, msg);
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/nutritionist/:id — delete analysis */
app.delete("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const id = parseInt(c.req.param("id"), 10);

  if (isNaN(id)) {
    return c.json({ ok: false, error: "Invalid analysis ID" }, 400);
  }

  try {
    const deleted = await removeAnalysis(telegramId, id);
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete analysis";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
