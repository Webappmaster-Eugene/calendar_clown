/**
 * Nutritionist product catalog API routes (Mini App).
 *
 * Mounted as a sub-app under /api/nutritionist/products by the parent
 * nutritionist router. All routes are guarded by the outer authMiddleware
 * (Telegram InitData).
 */
import { Hono } from "hono";
import {
  addProduct,
  editProduct,
  removeProduct,
  listUserProducts,
  getUserProduct,
  getProductPhoto,
} from "../../services/nutritionistService.js";
import type { UpdateProductRequest } from "../../services/nutritionistService.js";
import {
  NUTRITION_PRODUCT_PHOTO_MAX_BYTES,
} from "../../constants.js";
import { logApiAction } from "../../logging/actionLogger.js";
import type { ApiEnv } from "../authMiddleware.js";
import { createLogger } from "../../utils/logger.js";
import type { NutritionProductUnit } from "../../shared/types.js";

const log = createLogger("nutritionist-products-route");

const app = new Hono<ApiEnv>();

// ─── Helpers ────────────────────────────────────────────────────

function parseNumberField(form: FormData, key: string): number | undefined {
  const raw = form.get(key);
  if (raw === null) return undefined;
  const str = typeof raw === "string" ? raw.trim() : "";
  if (!str) return undefined;
  const num = Number(str.replace(",", "."));
  return Number.isFinite(num) ? num : NaN;
}

function parseStringField(form: FormData, key: string): string | undefined {
  const raw = form.get(key);
  if (raw === null) return undefined;
  return typeof raw === "string" ? raw : undefined;
}

function parseUnitField(form: FormData): NutritionProductUnit | undefined {
  const raw = parseStringField(form, "unit");
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  return normalized === "g" || normalized === "ml" ? normalized : undefined;
}

async function parseImageField(
  form: FormData,
  key: string,
): Promise<{ buffer: Buffer; mime: string } | null | "invalid-type" | "too-large"> {
  const raw = form.get(key);
  if (raw === null) return null;
  if (!(raw instanceof File)) return "invalid-type";
  if (raw.size === 0) return null;
  if (raw.size > NUTRITION_PRODUCT_PHOTO_MAX_BYTES) return "too-large";
  const mime = raw.type || "image/jpeg";
  if (!mime.startsWith("image/")) return "invalid-type";
  const arrayBuffer = await raw.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mime };
}

// ─── Routes ─────────────────────────────────────────────────────

/** GET /api/nutritionist/products — paginated list with optional search. */
app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const search = c.req.query("search") ?? undefined;

  try {
    const result = await listUserProducts(telegramId, limit, offset, search);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list products";
    log.error("Products list error for user %d: %s", telegramId, msg);
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/nutritionist/products — create a product (multipart). */
app.post("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const form = await c.req.formData();
    const name = parseStringField(form, "name")?.trim() ?? "";
    const description = parseStringField(form, "description")?.trim() || null;
    const unit = parseUnitField(form);
    const caloriesPer100 = parseNumberField(form, "caloriesPer100");
    const proteinsPer100G = parseNumberField(form, "proteinsPer100G");
    const fatsPer100G = parseNumberField(form, "fatsPer100G");
    const carbsPer100G = parseNumberField(form, "carbsPer100G");

    if (!name) {
      return c.json({ ok: false, error: "Название продукта обязательно" }, 400);
    }
    if (!unit) {
      return c.json({ ok: false, error: 'Единица измерения должна быть "g" или "ml"' }, 400);
    }
    if (
      caloriesPer100 === undefined || Number.isNaN(caloriesPer100) ||
      proteinsPer100G === undefined || Number.isNaN(proteinsPer100G) ||
      fatsPer100G === undefined || Number.isNaN(fatsPer100G) ||
      carbsPer100G === undefined || Number.isNaN(carbsPer100G)
    ) {
      return c.json({ ok: false, error: "Калории и БЖУ обязательны и должны быть числами" }, 400);
    }

    const image = await parseImageField(form, "image");
    if (image === "invalid-type") {
      return c.json({ ok: false, error: "Файл должен быть изображением" }, 400);
    }
    if (image === "too-large") {
      return c.json(
        { ok: false, error: `Файл превышает лимит ${Math.round(NUTRITION_PRODUCT_PHOTO_MAX_BYTES / 1024 / 1024)} МБ` },
        413,
      );
    }

    const product = await addProduct(
      telegramId,
      {
        name,
        description,
        unit,
        caloriesPer100,
        proteinsPer100G,
        fatsPer100G,
        carbsPer100G,
      },
      image?.buffer,
      image?.mime,
      null,
    );

    logApiAction(telegramId, "nutritionist_product_create", { productId: product.id });
    return c.json({ ok: true, data: product });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create product";
    log.error("Product create error for user %d: %s", telegramId, msg);
    return c.json({ ok: false, error: msg }, 400);
  }
});

/** GET /api/nutritionist/products/:id — single product. */
app.get("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const id = parseInt(c.req.param("id"), 10);

  if (Number.isNaN(id)) {
    return c.json({ ok: false, error: "Invalid product ID" }, 400);
  }

  try {
    const product = await getUserProduct(telegramId, id);
    if (!product) {
      return c.json({ ok: false, error: "Product not found" }, 404);
    }
    return c.json({ ok: true, data: product });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get product";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PATCH /api/nutritionist/products/:id — update product (multipart). */
app.patch("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const id = parseInt(c.req.param("id"), 10);

  if (Number.isNaN(id)) {
    return c.json({ ok: false, error: "Invalid product ID" }, 400);
  }

  try {
    const form = await c.req.formData();

    const patch: UpdateProductRequest = {};
    const name = parseStringField(form, "name");
    if (name !== undefined) patch.name = name.trim();
    const description = parseStringField(form, "description");
    if (description !== undefined) patch.description = description.trim() || null;
    const unit = parseUnitField(form);
    if (unit !== undefined) patch.unit = unit;

    const cals = parseNumberField(form, "caloriesPer100");
    if (cals !== undefined) {
      if (Number.isNaN(cals)) return c.json({ ok: false, error: "caloriesPer100 must be a number" }, 400);
      patch.caloriesPer100 = cals;
    }
    const prot = parseNumberField(form, "proteinsPer100G");
    if (prot !== undefined) {
      if (Number.isNaN(prot)) return c.json({ ok: false, error: "proteinsPer100G must be a number" }, 400);
      patch.proteinsPer100G = prot;
    }
    const fats = parseNumberField(form, "fatsPer100G");
    if (fats !== undefined) {
      if (Number.isNaN(fats)) return c.json({ ok: false, error: "fatsPer100G must be a number" }, 400);
      patch.fatsPer100G = fats;
    }
    const carbs = parseNumberField(form, "carbsPer100G");
    if (carbs !== undefined) {
      if (Number.isNaN(carbs)) return c.json({ ok: false, error: "carbsPer100G must be a number" }, 400);
      patch.carbsPer100G = carbs;
    }

    const removePhoto = parseStringField(form, "removePhoto");
    const image = await parseImageField(form, "image");
    if (image === "invalid-type") {
      return c.json({ ok: false, error: "Файл должен быть изображением" }, 400);
    }
    if (image === "too-large") {
      return c.json(
        { ok: false, error: `Файл превышает лимит ${Math.round(NUTRITION_PRODUCT_PHOTO_MAX_BYTES / 1024 / 1024)} МБ` },
        413,
      );
    }
    if (image && typeof image === "object") {
      patch.photoAction = "replace";
      patch.newPhotoBuffer = image.buffer;
      patch.newPhotoMime = image.mime;
    } else if (removePhoto === "1" || removePhoto === "true") {
      patch.photoAction = "remove";
    }

    const updated = await editProduct(telegramId, id, patch);
    if (!updated) {
      return c.json({ ok: false, error: "Product not found" }, 404);
    }
    logApiAction(telegramId, "nutritionist_product_update", { productId: id });
    return c.json({ ok: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update product";
    log.error("Product update error for user %d: %s", telegramId, msg);
    return c.json({ ok: false, error: msg }, 400);
  }
});

/** DELETE /api/nutritionist/products/:id */
app.delete("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const id = parseInt(c.req.param("id"), 10);

  if (Number.isNaN(id)) {
    return c.json({ ok: false, error: "Invalid product ID" }, 400);
  }

  try {
    const deleted = await removeProduct(telegramId, id);
    if (deleted) {
      logApiAction(telegramId, "nutritionist_product_delete", { productId: id });
    }
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete product";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/nutritionist/products/:id/photo — stream package photo. */
app.get("/:id/photo", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const id = parseInt(c.req.param("id"), 10);

  if (Number.isNaN(id)) {
    return c.json({ ok: false, error: "Invalid product ID" }, 400);
  }

  try {
    const photo = await getProductPhoto(telegramId, id);
    if (!photo) {
      return c.json({ ok: false, error: "Photo not found" }, 404);
    }
    c.header("Content-Type", photo.mime);
    c.header("Cache-Control", "private, max-age=600");
    return c.body(photo.buffer as unknown as ArrayBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read photo";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
