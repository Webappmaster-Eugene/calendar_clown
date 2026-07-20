import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle.js";
import { nutritionProducts } from "../db/schema.js";

// ─── Types ──────────────────────────────────────────────────────

export type NutritionProductUnit = "g" | "ml";

export interface NutritionProduct {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  unit: NutritionProductUnit;
  caloriesPer100G: number;
  proteinsPer100G: number;
  fatsPer100G: number;
  carbsPer100G: number;
  packagePhotoPath: string | null;
  packagePhotoMime: string | null;
  packageTelegramFileId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapRow(row: typeof nutritionProducts.$inferSelect): NutritionProduct {
  const unit = row.unit === "ml" ? "ml" : "g";
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    unit,
    caloriesPer100G: parseFloat(row.caloriesPer100G),
    proteinsPer100G: parseFloat(row.proteinsPer100G),
    fatsPer100G: parseFloat(row.fatsPer100G),
    carbsPer100G: parseFloat(row.carbsPer100G),
    packagePhotoPath: row.packagePhotoPath,
    packagePhotoMime: row.packagePhotoMime,
    packageTelegramFileId: row.packageTelegramFileId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateNutritionProductInput {
  userId: number;
  name: string;
  description: string | null;
  unit: NutritionProductUnit;
  caloriesPer100G: number;
  proteinsPer100G: number;
  fatsPer100G: number;
  carbsPer100G: number;
  packagePhotoPath?: string | null;
  packagePhotoMime?: string | null;
  packageTelegramFileId?: string | null;
}

export interface UpdateNutritionProductInput {
  name?: string;
  description?: string | null;
  unit?: NutritionProductUnit;
  caloriesPer100G?: number;
  proteinsPer100G?: number;
  fatsPer100G?: number;
  carbsPer100G?: number;
  packagePhotoPath?: string | null;
  packagePhotoMime?: string | null;
  packageTelegramFileId?: string | null;
}

// ─── CRUD ───────────────────────────────────────────────────────

export async function createProduct(
  input: CreateNutritionProductInput,
): Promise<NutritionProduct> {
  const [row] = await db
    .insert(nutritionProducts)
    .values({
      userId: input.userId,
      name: input.name,
      description: input.description,
      unit: input.unit,
      caloriesPer100G: String(input.caloriesPer100G),
      proteinsPer100G: String(input.proteinsPer100G),
      fatsPer100G: String(input.fatsPer100G),
      carbsPer100G: String(input.carbsPer100G),
      packagePhotoPath: input.packagePhotoPath ?? null,
      packagePhotoMime: input.packagePhotoMime ?? null,
      packageTelegramFileId: input.packageTelegramFileId ?? null,
    })
    .returning();
  return mapRow(row);
}

export async function updateProduct(
  id: number,
  userId: number,
  patch: UpdateNutritionProductInput,
): Promise<NutritionProduct | null> {
  const set: PgUpdateSetSource<typeof nutritionProducts> = {};

  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.unit !== undefined) set.unit = patch.unit;
  if (patch.caloriesPer100G !== undefined) set.caloriesPer100G = String(patch.caloriesPer100G);
  if (patch.proteinsPer100G !== undefined) set.proteinsPer100G = String(patch.proteinsPer100G);
  if (patch.fatsPer100G !== undefined) set.fatsPer100G = String(patch.fatsPer100G);
  if (patch.carbsPer100G !== undefined) set.carbsPer100G = String(patch.carbsPer100G);
  if (patch.packagePhotoPath !== undefined) set.packagePhotoPath = patch.packagePhotoPath;
  if (patch.packagePhotoMime !== undefined) set.packagePhotoMime = patch.packagePhotoMime;
  if (patch.packageTelegramFileId !== undefined) {
    set.packageTelegramFileId = patch.packageTelegramFileId;
  }

  if (Object.keys(set).length === 0) {
    return getProductById(id, userId);
  }

  set.updatedAt = sql`now()`;
  const [row] = await db
    .update(nutritionProducts)
    .set(set)
    .where(and(eq(nutritionProducts.id, id), eq(nutritionProducts.userId, userId)))
    .returning();
  return row ? mapRow(row) : null;
}

// Returns the deleted row so the caller can remove its photo file from disk.
export async function deleteProduct(
  id: number,
  userId: number,
): Promise<NutritionProduct | null> {
  const [row] = await db
    .delete(nutritionProducts)
    .where(and(eq(nutritionProducts.id, id), eq(nutritionProducts.userId, userId)))
    .returning();
  return row ? mapRow(row) : null;
}

export async function getProductById(
  id: number,
  userId: number,
): Promise<NutritionProduct | null> {
  const [row] = await db
    .select()
    .from(nutritionProducts)
    .where(and(eq(nutritionProducts.id, id), eq(nutritionProducts.userId, userId)));
  return row ? mapRow(row) : null;
}

export async function listProducts(
  userId: number,
  limit: number,
  offset: number,
  search?: string,
): Promise<NutritionProduct[]> {
  const trimmed = search?.trim();
  if (trimmed) {
    const pattern = `%${trimmed}%`;
    const rows = await db
      .select()
      .from(nutritionProducts)
      .where(
        and(
          eq(nutritionProducts.userId, userId),
          or(ilike(nutritionProducts.name, pattern), ilike(nutritionProducts.description, pattern)),
        ),
      )
      .orderBy(desc(nutritionProducts.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map(mapRow);
  }
  const rows = await db
    .select()
    .from(nutritionProducts)
    .where(eq(nutritionProducts.userId, userId))
    .orderBy(desc(nutritionProducts.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(mapRow);
}

export async function countProducts(
  userId: number,
  search?: string,
): Promise<number> {
  const trimmed = search?.trim();
  if (trimmed) {
    const pattern = `%${trimmed}%`;
    const [row] = await db
      .select({ value: count() })
      .from(nutritionProducts)
      .where(
        and(
          eq(nutritionProducts.userId, userId),
          or(ilike(nutritionProducts.name, pattern), ilike(nutritionProducts.description, pattern)),
        ),
      );
    return row.value;
  }
  const [row] = await db
    .select({ value: count() })
    .from(nutritionProducts)
    .where(eq(nutritionProducts.userId, userId));
  return row.value;
}

// Newest first so recent products are prioritized when the catalog exceeds the prompt cap.
export async function listAllProductsForUser(
  userId: number,
  maxRows: number,
): Promise<NutritionProduct[]> {
  const rows = await db
    .select()
    .from(nutritionProducts)
    .where(eq(nutritionProducts.userId, userId))
    .orderBy(desc(nutritionProducts.createdAt))
    .limit(maxRows);
  return rows.map(mapRow);
}

// Server-side fallback when the AI did not tag an item with matched_product_id.
export async function findProductsByNormalizedName(
  userId: number,
  normalizedName: string,
): Promise<NutritionProduct[]> {
  const rows = await db
    .select()
    .from(nutritionProducts)
    .where(
      and(
        eq(nutritionProducts.userId, userId),
        sql`lower(trim(${nutritionProducts.name})) = ${normalizedName}`,
      ),
    )
    .orderBy(desc(nutritionProducts.createdAt));
  return rows.map(mapRow);
}
