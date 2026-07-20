import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { nutritionAnalyses } from "../db/schema.js";

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

function mapRow(row: typeof nutritionAnalyses.$inferSelect): NutritionAnalysis {
  return {
    id: row.id,
    userId: row.userId,
    telegramFileId: row.telegramFileId,
    caption: row.caption,
    nutritionData: row.nutritionData as Record<string, unknown> | null,
    summaryText: row.summaryText,
    modelUsed: row.modelUsed,
    status: row.status,
    source: row.source,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    analyzedAt: row.analyzedAt,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────

export async function createAnalysis(
  userId: number,
  telegramFileId: string | null,
  caption: string | null,
): Promise<NutritionAnalysis> {
  const [row] = await db
    .insert(nutritionAnalyses)
    .values({ userId, telegramFileId, caption, status: "pending" })
    .returning();
  return mapRow(row);
}

export async function markAnalysisProcessing(id: number): Promise<void> {
  await db.update(nutritionAnalyses).set({ status: "processing" }).where(eq(nutritionAnalyses.id, id));
}

export async function markAnalysisCompleted(
  id: number,
  nutritionData: Record<string, unknown>,
  summaryText: string,
  modelUsed: string,
): Promise<void> {
  await db
    .update(nutritionAnalyses)
    .set({
      status: "completed",
      nutritionData,
      summaryText,
      modelUsed,
      analyzedAt: sql`now()`,
    })
    .where(eq(nutritionAnalyses.id, id));
}

export async function markAnalysisFailed(
  id: number,
  errorMessage: string,
): Promise<void> {
  await db
    .update(nutritionAnalyses)
    .set({ status: "failed", errorMessage, analyzedAt: sql`now()` })
    .where(eq(nutritionAnalyses.id, id));
}

export async function createManualAnalysis(
  userId: number,
  nutritionData: Record<string, unknown>,
  summaryText: string,
): Promise<NutritionAnalysis> {
  const [row] = await db
    .insert(nutritionAnalyses)
    .values({
      userId,
      source: "manual",
      status: "completed",
      nutritionData,
      summaryText,
      analyzedAt: sql`now()`,
    })
    .returning();
  return mapRow(row);
}

// ─── History Queries ────────────────────────────────────────────

export async function getAnalysesPaginated(
  userId: number,
  limit: number,
  offset: number,
): Promise<NutritionAnalysis[]> {
  const rows = await db
    .select()
    .from(nutritionAnalyses)
    .where(eq(nutritionAnalyses.userId, userId))
    .orderBy(desc(nutritionAnalyses.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(mapRow);
}

export async function countAnalyses(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(nutritionAnalyses)
    .where(eq(nutritionAnalyses.userId, userId));
  return row.value;
}

/** Manual calculations are excluded — they don't consume the daily AI limit. */
export async function countAnalysesToday(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(nutritionAnalyses)
    .where(
      and(
        eq(nutritionAnalyses.userId, userId),
        eq(nutritionAnalyses.source, "photo"),
        sql`${nutritionAnalyses.createdAt} >= (now() at time zone 'Europe/Moscow')::date at time zone 'Europe/Moscow'`,
      ),
    );
  return row.value;
}

export async function getAnalysisById(
  id: number,
  userId: number,
): Promise<NutritionAnalysis | null> {
  const [row] = await db
    .select()
    .from(nutritionAnalyses)
    .where(and(eq(nutritionAnalyses.id, id), eq(nutritionAnalyses.userId, userId)));
  return row ? mapRow(row) : null;
}

export async function deleteAnalysis(
  id: number,
  userId: number,
): Promise<boolean> {
  const rows = await db
    .delete(nutritionAnalyses)
    .where(and(eq(nutritionAnalyses.id, id), eq(nutritionAnalyses.userId, userId)))
    .returning({ id: nutritionAnalyses.id });
  return rows.length > 0;
}

// ─── Daily Summary ─────────────────────────────────────────────

export interface DailySummaryAggregation {
  mealsCount: number;
  totalCalories: number;
  totalProteins: number;
  totalFats: number;
  totalCarbs: number;
  totalWeight: number;
}

export async function getDailySummaryAggregation(
  userId: number,
  date: string,
): Promise<DailySummaryAggregation> {
  const [row] = await db
    .select({
      mealsCount: count(),
      totalCalories: sql<string | null>`sum((${nutritionAnalyses.nutritionData}->'total'->>'calories')::numeric)`,
      totalProteins: sql<string | null>`sum((${nutritionAnalyses.nutritionData}->'total'->>'proteins_g')::numeric)`,
      totalFats: sql<string | null>`sum((${nutritionAnalyses.nutritionData}->'total'->>'fats_g')::numeric)`,
      totalCarbs: sql<string | null>`sum((${nutritionAnalyses.nutritionData}->'total'->>'carbs_g')::numeric)`,
      totalWeight: sql<string | null>`sum((${nutritionAnalyses.nutritionData}->'total'->>'weight_g')::numeric)`,
    })
    .from(nutritionAnalyses)
    .where(
      and(
        eq(nutritionAnalyses.userId, userId),
        eq(nutritionAnalyses.status, "completed"),
        sql`(${nutritionAnalyses.createdAt} at time zone 'Europe/Moscow')::date = ${date}::date`,
      ),
    );
  return {
    mealsCount: row.mealsCount,
    totalCalories: Math.round(parseFloat(row.totalCalories ?? "0")),
    totalProteins: Math.round(parseFloat(row.totalProteins ?? "0") * 10) / 10,
    totalFats: Math.round(parseFloat(row.totalFats ?? "0") * 10) / 10,
    totalCarbs: Math.round(parseFloat(row.totalCarbs ?? "0") * 10) / 10,
    totalWeight: Math.round(parseFloat(row.totalWeight ?? "0")),
  };
}

export async function getAnalysesByDate(
  userId: number,
  date: string,
): Promise<NutritionAnalysis[]> {
  const rows = await db
    .select()
    .from(nutritionAnalyses)
    .where(
      and(
        eq(nutritionAnalyses.userId, userId),
        eq(nutritionAnalyses.status, "completed"),
        sql`(${nutritionAnalyses.createdAt} at time zone 'Europe/Moscow')::date = ${date}::date`,
      ),
    )
    .orderBy(asc(nutritionAnalyses.createdAt));
  return rows.map(mapRow);
}
