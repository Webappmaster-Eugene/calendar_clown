/**
 * Repository for nutrition_analyses table.
 * Raw SQL via query() — follows the pattern of simplifier/repository.ts.
 */
import { query } from "../db/connection.js";

// ─── Types ──────────────────────────────────────────────────────

export interface NutritionAnalysis {
  id: number;
  userId: number;
  telegramFileId: string | null;
  caption: string | null;
  nutritionData: Record<string, unknown> | null;
  summaryText: string | null;
  modelUsed: string | null;
  status: string;
  source: string;
  errorMessage: string | null;
  createdAt: Date;
  analyzedAt: Date | null;
}

interface NutritionAnalysisRow {
  id: number;
  user_id: number;
  telegram_file_id: string | null;
  caption: string | null;
  nutrition_data: Record<string, unknown> | null;
  summary_text: string | null;
  model_used: string | null;
  status: string;
  source: string;
  error_message: string | null;
  created_at: Date;
  analyzed_at: Date | null;
}

function mapRow(row: NutritionAnalysisRow): NutritionAnalysis {
  return {
    id: row.id,
    userId: row.user_id,
    telegramFileId: row.telegram_file_id,
    caption: row.caption,
    nutritionData: row.nutrition_data,
    summaryText: row.summary_text,
    modelUsed: row.model_used,
    status: row.status,
    source: row.source,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    analyzedAt: row.analyzed_at,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────

/** Insert a new analysis record (status: pending). */
export async function createAnalysis(
  userId: number,
  telegramFileId: string | null,
  caption: string | null,
): Promise<NutritionAnalysis> {
  const { rows } = await query<NutritionAnalysisRow>(
    `INSERT INTO nutrition_analyses
       (user_id, telegram_file_id, caption, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING *`,
    [userId, telegramFileId, caption],
  );
  return mapRow(rows[0]);
}

/** Update analysis status to 'processing'. */
export async function markAnalysisProcessing(id: number): Promise<void> {
  await query(
    "UPDATE nutrition_analyses SET status = 'processing' WHERE id = $1",
    [id],
  );
}

/** Mark analysis as completed with results. */
export async function markAnalysisCompleted(
  id: number,
  nutritionData: Record<string, unknown>,
  summaryText: string,
  modelUsed: string,
): Promise<void> {
  await query(
    `UPDATE nutrition_analyses
     SET status = 'completed',
         nutrition_data = $2,
         summary_text = $3,
         model_used = $4,
         analyzed_at = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(nutritionData), summaryText, modelUsed],
  );
}

/** Mark analysis as failed with an error message. */
export async function markAnalysisFailed(
  id: number,
  errorMessage: string,
): Promise<void> {
  await query(
    `UPDATE nutrition_analyses
     SET status = 'failed', error_message = $2, analyzed_at = NOW()
     WHERE id = $1`,
    [id, errorMessage],
  );
}

/** Insert a completed manual calculation (no AI, no pending phase). */
export async function createManualAnalysis(
  userId: number,
  nutritionData: Record<string, unknown>,
  summaryText: string,
): Promise<NutritionAnalysis> {
  const { rows } = await query<NutritionAnalysisRow>(
    `INSERT INTO nutrition_analyses
       (user_id, source, status, nutrition_data, summary_text, analyzed_at)
     VALUES ($1, 'manual', 'completed', $2, $3, NOW())
     RETURNING *`,
    [userId, JSON.stringify(nutritionData), summaryText],
  );
  return mapRow(rows[0]);
}

// ─── History Queries ────────────────────────────────────────────

/** Get paginated analyses for a user (newest first). */
export async function getAnalysesPaginated(
  userId: number,
  limit: number,
  offset: number,
): Promise<NutritionAnalysis[]> {
  const { rows } = await query<NutritionAnalysisRow>(
    `SELECT * FROM nutrition_analyses
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return rows.map(mapRow);
}

/** Count all analyses for a user. */
export async function countAnalyses(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM nutrition_analyses WHERE user_id = $1",
    [userId],
  );
  return parseInt(rows[0].count, 10);
}

/** Count photo-based analyses for a user created today (MSK timezone).
 *  Manual calculations are excluded — they don't consume the daily AI limit. */
export async function countAnalysesToday(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM nutrition_analyses
     WHERE user_id = $1
       AND source = 'photo'
       AND created_at >= (NOW() AT TIME ZONE 'Europe/Moscow')::date AT TIME ZONE 'Europe/Moscow'`,
    [userId],
  );
  return parseInt(rows[0].count, 10);
}

/** Get a single analysis by ID (with ownership check). */
export async function getAnalysisById(
  id: number,
  userId: number,
): Promise<NutritionAnalysis | null> {
  const { rows } = await query<NutritionAnalysisRow>(
    "SELECT * FROM nutrition_analyses WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

/** Delete an analysis (with ownership check). Returns true if deleted. */
export async function deleteAnalysis(
  id: number,
  userId: number,
): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM nutrition_analyses WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

// ─── Daily Summary ─────────────────────────────────────────────

interface DailySummaryRow {
  meals_count: string;
  total_calories: string | null;
  total_proteins: string | null;
  total_fats: string | null;
  total_carbs: string | null;
  total_weight: string | null;
}

export interface DailySummaryAggregation {
  mealsCount: number;
  totalCalories: number;
  totalProteins: number;
  totalFats: number;
  totalCarbs: number;
  totalWeight: number;
}

/** Get aggregated nutrition for a specific date (MSK timezone). */
export async function getDailySummaryAggregation(
  userId: number,
  date: string,
): Promise<DailySummaryAggregation> {
  const { rows } = await query<DailySummaryRow>(
    `SELECT
       COUNT(*) AS meals_count,
       SUM((nutrition_data->'total'->>'calories')::numeric) AS total_calories,
       SUM((nutrition_data->'total'->>'proteins_g')::numeric) AS total_proteins,
       SUM((nutrition_data->'total'->>'fats_g')::numeric) AS total_fats,
       SUM((nutrition_data->'total'->>'carbs_g')::numeric) AS total_carbs,
       SUM((nutrition_data->'total'->>'weight_g')::numeric) AS total_weight
     FROM nutrition_analyses
     WHERE user_id = $1
       AND status = 'completed'
       AND (created_at AT TIME ZONE 'Europe/Moscow')::date = $2::date`,
    [userId, date],
  );
  const row = rows[0];
  return {
    mealsCount: parseInt(row.meals_count, 10),
    totalCalories: Math.round(parseFloat(row.total_calories ?? "0")),
    totalProteins: Math.round(parseFloat(row.total_proteins ?? "0") * 10) / 10,
    totalFats: Math.round(parseFloat(row.total_fats ?? "0") * 10) / 10,
    totalCarbs: Math.round(parseFloat(row.total_carbs ?? "0") * 10) / 10,
    totalWeight: Math.round(parseFloat(row.total_weight ?? "0")),
  };
}

/** Get completed analyses for a specific date (MSK timezone), newest first. */
export async function getAnalysesByDate(
  userId: number,
  date: string,
): Promise<NutritionAnalysis[]> {
  const { rows } = await query<NutritionAnalysisRow>(
    `SELECT * FROM nutrition_analyses
     WHERE user_id = $1
       AND status = 'completed'
       AND (created_at AT TIME ZONE 'Europe/Moscow')::date = $2::date
     ORDER BY created_at ASC`,
    [userId, date],
  );
  return rows.map(mapRow);
}
