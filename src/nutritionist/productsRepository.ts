/**
 * Repository for the nutrition_products table (user product catalog).
 * Raw SQL via query() — follows the pattern of nutritionist/repository.ts.
 */
import { query } from "../db/connection.js";

// ─── Types ──────────────────────────────────────────────────────

export type NutritionProductUnit = "g" | "ml";

export interface NutritionProduct {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  unit: NutritionProductUnit;
  caloriesPer100: number;
  proteinsPer100G: number;
  fatsPer100G: number;
  carbsPer100G: number;
  packagePhotoPath: string | null;
  packagePhotoMime: string | null;
  packageTelegramFileId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NutritionProductRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  unit: string;
  calories_per_100: string;
  proteins_per_100_g: string;
  fats_per_100_g: string;
  carbs_per_100_g: string;
  package_photo_path: string | null;
  package_photo_mime: string | null;
  package_telegram_file_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: NutritionProductRow): NutritionProduct {
  const unit = row.unit === "ml" ? "ml" : "g";
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    unit,
    caloriesPer100: parseFloat(row.calories_per_100),
    proteinsPer100G: parseFloat(row.proteins_per_100_g),
    fatsPer100G: parseFloat(row.fats_per_100_g),
    carbsPer100G: parseFloat(row.carbs_per_100_g),
    packagePhotoPath: row.package_photo_path,
    packagePhotoMime: row.package_photo_mime,
    packageTelegramFileId: row.package_telegram_file_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateNutritionProductInput {
  userId: number;
  name: string;
  description: string | null;
  unit: NutritionProductUnit;
  caloriesPer100: number;
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
  caloriesPer100?: number;
  proteinsPer100G?: number;
  fatsPer100G?: number;
  carbsPer100G?: number;
  packagePhotoPath?: string | null;
  packagePhotoMime?: string | null;
  packageTelegramFileId?: string | null;
}

// ─── CRUD ───────────────────────────────────────────────────────

/** Insert a new product row and return the created entity. */
export async function createProduct(
  input: CreateNutritionProductInput,
): Promise<NutritionProduct> {
  const { rows } = await query<NutritionProductRow>(
    `INSERT INTO nutrition_products (
       user_id, name, description, unit,
       calories_per_100, proteins_per_100_g, fats_per_100_g, carbs_per_100_g,
       package_photo_path, package_photo_mime, package_telegram_file_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.userId,
      input.name,
      input.description,
      input.unit,
      input.caloriesPer100,
      input.proteinsPer100G,
      input.fatsPer100G,
      input.carbsPer100G,
      input.packagePhotoPath ?? null,
      input.packagePhotoMime ?? null,
      input.packageTelegramFileId ?? null,
    ],
  );
  return mapRow(rows[0]);
}

/**
 * Update a product by id with ownership check. Only columns explicitly set
 * in `patch` are updated. Returns the updated row or null if not found.
 */
export async function updateProduct(
  id: number,
  userId: number,
  patch: UpdateNutritionProductInput,
): Promise<NutritionProduct | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const push = (column: string, value: unknown) => {
    fields.push(`${column} = $${idx}`);
    values.push(value);
    idx++;
  };

  if (patch.name !== undefined) push("name", patch.name);
  if (patch.description !== undefined) push("description", patch.description);
  if (patch.unit !== undefined) push("unit", patch.unit);
  if (patch.caloriesPer100 !== undefined) push("calories_per_100", patch.caloriesPer100);
  if (patch.proteinsPer100G !== undefined) push("proteins_per_100_g", patch.proteinsPer100G);
  if (patch.fatsPer100G !== undefined) push("fats_per_100_g", patch.fatsPer100G);
  if (patch.carbsPer100G !== undefined) push("carbs_per_100_g", patch.carbsPer100G);
  if (patch.packagePhotoPath !== undefined) push("package_photo_path", patch.packagePhotoPath);
  if (patch.packagePhotoMime !== undefined) push("package_photo_mime", patch.packagePhotoMime);
  if (patch.packageTelegramFileId !== undefined) {
    push("package_telegram_file_id", patch.packageTelegramFileId);
  }

  if (fields.length === 0) {
    // Nothing to update — return the current row.
    return getProductById(id, userId);
  }

  fields.push(`updated_at = NOW()`);
  values.push(id, userId);
  const idParam = `$${idx}`;
  const userParam = `$${idx + 1}`;

  const { rows } = await query<NutritionProductRow>(
    `UPDATE nutrition_products
        SET ${fields.join(", ")}
      WHERE id = ${idParam} AND user_id = ${userParam}
      RETURNING *`,
    values,
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

/**
 * Delete a product with ownership check. Returns the deleted row so the
 * caller can remove the associated photo file from disk, or null if the
 * row did not exist or did not belong to the user.
 */
export async function deleteProduct(
  id: number,
  userId: number,
): Promise<NutritionProduct | null> {
  const { rows } = await query<NutritionProductRow>(
    `DELETE FROM nutrition_products
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
    [id, userId],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

/** Get a single product by id with ownership check. */
export async function getProductById(
  id: number,
  userId: number,
): Promise<NutritionProduct | null> {
  const { rows } = await query<NutritionProductRow>(
    "SELECT * FROM nutrition_products WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

/**
 * Paginated list of products for a user. Optional case-insensitive substring
 * search by name or description. Newest first.
 */
export async function listProducts(
  userId: number,
  limit: number,
  offset: number,
  search?: string,
): Promise<NutritionProduct[]> {
  const trimmed = search?.trim();
  if (trimmed) {
    const pattern = `%${trimmed}%`;
    const { rows } = await query<NutritionProductRow>(
      `SELECT * FROM nutrition_products
         WHERE user_id = $1
           AND (name ILIKE $2 OR description ILIKE $2)
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
      [userId, pattern, limit, offset],
    );
    return rows.map(mapRow);
  }
  const { rows } = await query<NutritionProductRow>(
    `SELECT * FROM nutrition_products
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return rows.map(mapRow);
}

/** Count products for a user (optional search). */
export async function countProducts(
  userId: number,
  search?: string,
): Promise<number> {
  const trimmed = search?.trim();
  if (trimmed) {
    const pattern = `%${trimmed}%`;
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM nutrition_products
         WHERE user_id = $1
           AND (name ILIKE $2 OR description ILIKE $2)`,
      [userId, pattern],
    );
    return parseInt(rows[0].count, 10);
  }
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM nutrition_products WHERE user_id = $1",
    [userId],
  );
  return parseInt(rows[0].count, 10);
}

/**
 * Fetch up to `maxRows` most recent products for a user — used to build
 * the AI prompt catalog block. Returns newest first so recently added
 * products are prioritized when the catalog exceeds the prompt cap.
 */
export async function listAllProductsForUser(
  userId: number,
  maxRows: number,
): Promise<NutritionProduct[]> {
  const { rows } = await query<NutritionProductRow>(
    `SELECT * FROM nutrition_products
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
    [userId, maxRows],
  );
  return rows.map(mapRow);
}

/**
 * Find products whose lowercased/trimmed name matches the given
 * normalized string exactly. Used as a server-side fallback when the
 * AI did not explicitly tag an item with matched_product_id.
 */
export async function findProductsByNormalizedName(
  userId: number,
  normalizedName: string,
): Promise<NutritionProduct[]> {
  const { rows } = await query<NutritionProductRow>(
    `SELECT * FROM nutrition_products
       WHERE user_id = $1
         AND LOWER(TRIM(name)) = $2
       ORDER BY created_at DESC`,
    [userId, normalizedName],
  );
  return rows.map(mapRow);
}
