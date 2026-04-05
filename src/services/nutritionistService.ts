/**
 * Nutritionist business logic.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  createAnalysis,
  markAnalysisProcessing,
  markAnalysisCompleted,
  markAnalysisFailed,
  getAnalysesPaginated,
  countAnalyses,
  countAnalysesToday,
  getAnalysisById,
  deleteAnalysis,
  getDailySummaryAggregation,
  getAnalysesByDate,
} from "../nutritionist/repository.js";
import { analyzeFood } from "../nutritionist/analyze.js";
import type {
  NutritionResult,
  CatalogProductForPrompt,
  FoodItem,
} from "../nutritionist/analyze.js";
import {
  createProduct as createProductRow,
  updateProduct as updateProductRow,
  deleteProduct as deleteProductRow,
  getProductById as getProductByIdRow,
  listProducts as listProductsRows,
  countProducts as countProductsRows,
  listAllProductsForUser,
  findProductsByNormalizedName,
} from "../nutritionist/productsRepository.js";
import type {
  NutritionProduct,
  NutritionProductUnit,
} from "../nutritionist/productsRepository.js";
import {
  savePackagePhoto,
  removePackagePhoto,
  readPackagePhoto,
} from "../nutritionist/productPhotoStorage.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import {
  NUTRITIONIST_DAILY_LIMIT,
  NUTRITION_MAX_PRODUCTS_PER_USER,
  NUTRITION_PRODUCT_CATALOG_PROMPT_LIMIT,
  NUTRITION_PRODUCT_NAME_MAX_LENGTH,
  NUTRITION_PRODUCT_DESCRIPTION_MAX_LENGTH,
} from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type {
  NutritionAnalysisDto,
  NutritionistHistoryResponse,
  NutritionDailySummaryDto,
  NutritionFoodItemDto,
  NutritionTotalDto,
  NutritionProductDto,
  NutritionProductsListResponse,
} from "../shared/types.js";

const log = createLogger("nutritionist-service");

// ─── Helpers ──────────────────────────────────────────────────

function requireDb(): void {
  if (!isDatabaseAvailable()) {
    throw new Error("База данных недоступна.");
  }
}

async function requireDbUser(telegramId: number) {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) throw new Error("Пользователь не найден.");
  return dbUser;
}

function nutritionResultToDto(data: NutritionResult): {
  items: NutritionFoodItemDto[];
  total: NutritionTotalDto;
  dishType: string;
  mealAssessment: string;
  confidence: "high" | "medium" | "low";
} {
  return {
    items: data.items.map((item) => ({
      name: item.name,
      weightG: item.weight_g,
      calories: item.calories,
      proteinsG: item.proteins_g,
      fatsG: item.fats_g,
      carbsG: item.carbs_g,
      cookingMethod: item.cooking_method,
      ...(item.matched_product_id !== undefined
        ? { matchedProductId: item.matched_product_id }
        : {}),
    })),
    total: {
      weightG: data.total.weight_g,
      calories: data.total.calories,
      proteinsG: data.total.proteins_g,
      fatsG: data.total.fats_g,
      carbsG: data.total.carbs_g,
    },
    dishType: data.dish_type,
    mealAssessment: data.meal_assessment,
    confidence: data.confidence,
  };
}

function productRowToDto(row: NutritionProduct): NutritionProductDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    unit: row.unit,
    caloriesPer100: row.caloriesPer100,
    proteinsPer100G: row.proteinsPer100G,
    fatsPer100G: row.fatsPer100G,
    carbsPer100G: row.carbsPer100G,
    hasPackagePhoto: Boolean(row.packagePhotoPath),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function productRowToPromptShape(row: NutritionProduct): CatalogProductForPrompt {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    unit: row.unit,
    caloriesPer100: row.caloriesPer100,
    proteinsPer100G: row.proteinsPer100G,
    fatsPer100G: row.fatsPer100G,
    carbsPer100G: row.carbsPer100G,
  };
}

/**
 * Normalize a product name for fuzzy matching: lowercase, trimmed, with
 * common quote characters removed so the AI-returned name and the stored
 * name collapse to the same key.
 */
function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/[«»"'`]/g, "").replace(/\s+/g, " ");
}

function toDto(row: {
  id: number;
  nutritionData: Record<string, unknown> | null;
  summaryText: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  analyzedAt: Date | null;
}): NutritionAnalysisDto {
  const data = (row.nutritionData ?? {}) as unknown as NutritionResult;
  const parsed = nutritionResultToDto({
    items: Array.isArray(data.items) ? data.items : [],
    total: data.total ?? { weight_g: 0, calories: 0, proteins_g: 0, fats_g: 0, carbs_g: 0 },
    dish_type: data.dish_type ?? "Не определено",
    meal_assessment: data.meal_assessment ?? "",
    confidence: data.confidence ?? "medium",
  });

  return {
    id: row.id,
    ...parsed,
    summaryText: row.summaryText,
    status: row.status as NutritionAnalysisDto["status"],
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    analyzedAt: row.analyzedAt?.toISOString() ?? null,
  };
}

// ─── Service Functions ────────────────────────────────────────

/** Get analysis history with pagination. */
export async function getHistory(
  telegramId: number,
  limit: number = 10,
  offset: number = 0,
): Promise<NutritionistHistoryResponse> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const [items, total] = await Promise.all([
    getAnalysesPaginated(dbUser.id, limit, offset),
    countAnalyses(dbUser.id),
  ]);

  return {
    analyses: items.map(toDto),
    total,
  };
}

/** Get a single analysis by ID. */
export async function getAnalysis(
  telegramId: number,
  analysisId: number,
): Promise<NutritionAnalysisDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const item = await getAnalysisById(analysisId, dbUser.id);
  if (!item) return null;
  return toDto(item);
}

/** Delete an analysis. */
export async function removeAnalysis(
  telegramId: number,
  analysisId: number,
): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return deleteAnalysis(analysisId, dbUser.id);
}

/** Analyze a food photo (create record, call AI, update record). */
export async function analyzePhoto(
  telegramId: number,
  imageBase64: string,
  mimeType: string,
  telegramFileId: string | null,
  caption: string | null,
): Promise<NutritionAnalysisDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Check daily limit
  const todayCount = await countAnalysesToday(dbUser.id);
  if (todayCount >= NUTRITIONIST_DAILY_LIMIT) {
    throw new Error(`Достигнут лимит анализов на сегодня (${NUTRITIONIST_DAILY_LIMIT}). Попробуйте завтра.`);
  }

  // Load the user's product catalog (capped) so the AI can match plate
  // items to user-defined products and use their precise macros.
  const catalogRows = await listAllProductsForUser(
    dbUser.id,
    NUTRITION_PRODUCT_CATALOG_PROMPT_LIMIT,
  );
  const totalCatalogProducts = catalogRows.length > 0 ? await countProductsRows(dbUser.id) : 0;

  const record = await createAnalysis(dbUser.id, telegramFileId, caption);
  await markAnalysisProcessing(record.id);

  try {
    const catalogOption = catalogRows.length > 0
      ? {
          products: catalogRows.map(productRowToPromptShape),
          total: totalCatalogProducts,
        }
      : undefined;

    const { result, model } = await analyzeFood(
      imageBase64,
      mimeType,
      caption ?? undefined,
      catalogOption,
    );

    // Post-process items: verify AI-returned matched_product_id belongs to
    // the user (defense against hallucinations), and run a server-side
    // fuzzy fallback for items the AI did not tag.
    await enrichItemsWithCatalogMatches(result.items, dbUser.id, catalogRows);

    const summaryText = formatSummaryText(result);

    await markAnalysisCompleted(
      record.id,
      result as unknown as Record<string, unknown>,
      summaryText,
      model,
    );

    return toDto({
      ...record,
      nutritionData: result as unknown as Record<string, unknown>,
      summaryText,
      status: "completed",
      analyzedAt: new Date(),
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Неизвестная ошибка";
    log.error("Error analyzing food photo:", err);
    await markAnalysisFailed(record.id, errorMsg);

    return toDto({
      ...record,
      nutritionData: null,
      summaryText: null,
      status: "failed",
      errorMessage: errorMsg,
      analyzedAt: new Date(),
    });
  }
}

/**
 * Defense-in-depth for AI-returned matched_product_id and fuzzy fallback
 * for items the AI did not match. Mutates items in place.
 */
async function enrichItemsWithCatalogMatches(
  items: FoodItem[],
  userDbId: number,
  catalogRows: NutritionProduct[],
): Promise<void> {
  if (catalogRows.length === 0) return;
  const catalogById = new Map(catalogRows.map((p) => [p.id, p]));

  for (const item of items) {
    // 1. Verify AI-provided matched_product_id actually belongs to this user.
    if (item.matched_product_id !== undefined) {
      if (!catalogById.has(item.matched_product_id)) {
        item.matched_product_id = undefined;
      } else {
        continue;
      }
    }

    // 2. Fuzzy fallback: lowercase/trimmed exact match, only when there is
    //    exactly one candidate (avoid false positives on common words).
    const normalized = normalizeForMatch(item.name);
    if (!normalized) continue;
    const candidates = await findProductsByNormalizedName(userDbId, normalized);
    if (candidates.length === 1) {
      item.matched_product_id = candidates[0].id;
    }
  }
}

/** Get daily nutrition summary. */
export async function getDailySummary(
  telegramId: number,
  date: string,
): Promise<NutritionDailySummaryDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const [aggregation, analyses] = await Promise.all([
    getDailySummaryAggregation(dbUser.id, date),
    getAnalysesByDate(dbUser.id, date),
  ]);

  return {
    date,
    mealsCount: aggregation.mealsCount,
    total: {
      weightG: aggregation.totalWeight,
      calories: aggregation.totalCalories,
      proteinsG: aggregation.totalProteins,
      fatsG: aggregation.totalFats,
      carbsG: aggregation.totalCarbs,
    },
    analyses: analyses.map(toDto),
  };
}

// ─── Product Catalog CRUD ────────────────────────────────────────

export interface CreateProductRequest {
  name: string;
  description?: string | null;
  unit: NutritionProductUnit;
  caloriesPer100: number;
  proteinsPer100G: number;
  fatsPer100G: number;
  carbsPer100G: number;
}

export interface UpdateProductRequest {
  name?: string;
  description?: string | null;
  unit?: NutritionProductUnit;
  caloriesPer100?: number;
  proteinsPer100G?: number;
  fatsPer100G?: number;
  carbsPer100G?: number;
  /**
   * - "replace": replace existing photo with `newPhotoBuffer`/`newPhotoMime`
   * - "remove": delete existing photo and clear columns
   * - undefined: leave photo unchanged
   */
  photoAction?: "remove" | "replace";
  newPhotoBuffer?: Buffer;
  newPhotoMime?: string;
}

function validateMacros(input: CreateProductRequest | UpdateProductRequest): void {
  const checkFinite = (label: string, value: number | undefined, min: number, max: number) => {
    if (value === undefined) return;
    if (!Number.isFinite(value)) {
      throw new Error(`Поле "${label}" должно быть числом.`);
    }
    if (value < min || value > max) {
      throw new Error(`Поле "${label}" должно быть в диапазоне ${min}–${max}.`);
    }
  };
  checkFinite("calories", input.caloriesPer100, 0, 900);
  checkFinite("proteins", input.proteinsPer100G, 0, 100);
  checkFinite("fats", input.fatsPer100G, 0, 100);
  checkFinite("carbs", input.carbsPer100G, 0, 100);
}

function validateNameDescription(
  input: { name?: string; description?: string | null },
  { requireName }: { requireName: boolean },
): void {
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length === 0) {
      throw new Error("Название продукта обязательно.");
    }
    if (trimmed.length > NUTRITION_PRODUCT_NAME_MAX_LENGTH) {
      throw new Error(
        `Название продукта не должно превышать ${NUTRITION_PRODUCT_NAME_MAX_LENGTH} символов.`,
      );
    }
  } else if (requireName) {
    throw new Error("Название продукта обязательно.");
  }
  if (input.description !== undefined && input.description !== null) {
    if (input.description.length > NUTRITION_PRODUCT_DESCRIPTION_MAX_LENGTH) {
      throw new Error(
        `Описание продукта не должно превышать ${NUTRITION_PRODUCT_DESCRIPTION_MAX_LENGTH} символов.`,
      );
    }
  }
}

function validateUnit(unit: string | undefined, { required }: { required: boolean }): void {
  if (unit === undefined) {
    if (required) throw new Error("Единица измерения обязательна.");
    return;
  }
  if (unit !== "g" && unit !== "ml") {
    throw new Error('Единица измерения должна быть "g" или "ml".');
  }
}

/** Create a new product in the user's catalog (with optional package photo). */
export async function addProduct(
  telegramId: number,
  input: CreateProductRequest,
  photoBuffer?: Buffer,
  photoMime?: string,
  telegramFileId?: string | null,
): Promise<NutritionProductDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const existingCount = await countProductsRows(dbUser.id);
  if (existingCount >= NUTRITION_MAX_PRODUCTS_PER_USER) {
    throw new Error(
      `Достигнут лимит продуктов в каталоге (${NUTRITION_MAX_PRODUCTS_PER_USER}). Удалите ненужные перед добавлением новых.`,
    );
  }

  validateNameDescription(input, { requireName: true });
  validateUnit(input.unit, { required: true });
  validateMacros(input);

  // Insert the row first to obtain an id, then (optionally) save the
  // photo on disk using that id as part of the filename.
  const created = await createProductRow({
    userId: dbUser.id,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    unit: input.unit,
    caloriesPer100: input.caloriesPer100,
    proteinsPer100G: input.proteinsPer100G,
    fatsPer100G: input.fatsPer100G,
    carbsPer100G: input.carbsPer100G,
    packageTelegramFileId: telegramFileId ?? null,
  });

  if (photoBuffer && photoMime) {
    try {
      const stored = await savePackagePhoto(dbUser.id, created.id, photoBuffer, photoMime);
      const updated = await updateProductRow(created.id, dbUser.id, {
        packagePhotoPath: stored.relativePath,
        packagePhotoMime: stored.mime,
      });
      return productRowToDto(updated ?? created);
    } catch (err) {
      log.error(`Failed to save package photo for product ${created.id}:`, err);
      // Row exists without photo — acceptable fallback.
    }
  }

  return productRowToDto(created);
}

/** Update a product (optionally replacing or removing its photo). */
export async function editProduct(
  telegramId: number,
  productId: number,
  patch: UpdateProductRequest,
): Promise<NutritionProductDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const existing = await getProductByIdRow(productId, dbUser.id);
  if (!existing) return null;

  validateNameDescription(patch, { requireName: false });
  validateUnit(patch.unit, { required: false });
  validateMacros(patch);

  let nextPhotoPath: string | null | undefined = undefined;
  let nextPhotoMime: string | null | undefined = undefined;
  let oldPhotoToDelete: string | null = null;

  if (patch.photoAction === "remove") {
    oldPhotoToDelete = existing.packagePhotoPath;
    nextPhotoPath = null;
    nextPhotoMime = null;
  } else if (patch.photoAction === "replace") {
    if (!patch.newPhotoBuffer || !patch.newPhotoMime) {
      throw new Error("Для замены фото требуется файл.");
    }
    const stored = await savePackagePhoto(
      dbUser.id,
      productId,
      patch.newPhotoBuffer,
      patch.newPhotoMime,
    );
    nextPhotoPath = stored.relativePath;
    nextPhotoMime = stored.mime;
    oldPhotoToDelete = existing.packagePhotoPath;
  }

  const updated = await updateProductRow(productId, dbUser.id, {
    name: patch.name?.trim(),
    description:
      patch.description === undefined
        ? undefined
        : patch.description === null
          ? null
          : patch.description.trim() || null,
    unit: patch.unit,
    caloriesPer100: patch.caloriesPer100,
    proteinsPer100G: patch.proteinsPer100G,
    fatsPer100G: patch.fatsPer100G,
    carbsPer100G: patch.carbsPer100G,
    packagePhotoPath: nextPhotoPath,
    packagePhotoMime: nextPhotoMime,
  });

  if (updated && oldPhotoToDelete && oldPhotoToDelete !== updated.packagePhotoPath) {
    await removePackagePhoto(oldPhotoToDelete);
  }

  return updated ? productRowToDto(updated) : null;
}

/** Delete a product (and its photo, if any). Returns true if deleted. */
export async function removeProduct(
  telegramId: number,
  productId: number,
): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const deleted = await deleteProductRow(productId, dbUser.id);
  if (!deleted) return false;
  if (deleted.packagePhotoPath) {
    await removePackagePhoto(deleted.packagePhotoPath);
  }
  return true;
}

/** List products with pagination and optional search. */
export async function listUserProducts(
  telegramId: number,
  limit: number,
  offset: number,
  search?: string,
): Promise<NutritionProductsListResponse> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const [rows, total] = await Promise.all([
    listProductsRows(dbUser.id, limit, offset, search),
    countProductsRows(dbUser.id, search),
  ]);

  return {
    products: rows.map(productRowToDto),
    total,
    limit,
    offset,
    maxAllowed: NUTRITION_MAX_PRODUCTS_PER_USER,
  };
}

/** Get a single product by id (with ownership check). */
export async function getUserProduct(
  telegramId: number,
  productId: number,
): Promise<NutritionProductDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const row = await getProductByIdRow(productId, dbUser.id);
  return row ? productRowToDto(row) : null;
}

/**
 * Load the binary package photo for a product (with ownership check).
 * Returns null if the product does not exist, does not belong to the
 * user, or has no photo.
 */
export async function getProductPhoto(
  telegramId: number,
  productId: number,
): Promise<{ buffer: Buffer; mime: string } | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const row = await getProductByIdRow(productId, dbUser.id);
  if (!row || !row.packagePhotoPath) return null;
  try {
    const buffer = await readPackagePhoto(row.packagePhotoPath);
    return { buffer, mime: row.packagePhotoMime ?? "image/jpeg" };
  } catch (err) {
    log.warn(`Failed to read product photo ${row.packagePhotoPath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Formatting ─────────────────────────────────────────────────

/** Format a human-readable summary of the nutrition analysis. */
function formatSummaryText(result: NutritionResult): string {
  if (result.items.length === 0) {
    return result.meal_assessment || "На фотографии не обнаружена еда.";
  }

  const lines: string[] = [];
  lines.push(`Блюдо: ${result.dish_type}`);
  lines.push("");

  for (const item of result.items) {
    lines.push(
      `• ${item.name} (${item.cooking_method}) — ${item.weight_g}г: ` +
      `${item.calories} ккал | Б ${item.proteins_g}г | Ж ${item.fats_g}г | У ${item.carbs_g}г`,
    );
  }

  lines.push("");
  lines.push(
    `Итого: ${result.total.weight_g}г — ` +
    `${result.total.calories} ккал | Б ${result.total.proteins_g}г | ` +
    `Ж ${result.total.fats_g}г | У ${result.total.carbs_g}г`,
  );
  lines.push("");
  lines.push(result.meal_assessment);

  return lines.join("\n");
}
