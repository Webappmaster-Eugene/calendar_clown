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
import type { NutritionResult } from "../nutritionist/analyze.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { NUTRITIONIST_DAILY_LIMIT } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type {
  NutritionAnalysisDto,
  NutritionistHistoryResponse,
  NutritionDailySummaryDto,
  NutritionFoodItemDto,
  NutritionTotalDto,
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

  const record = await createAnalysis(dbUser.id, telegramFileId, caption);
  await markAnalysisProcessing(record.id);

  try {
    const { result, model } = await analyzeFood(imageBase64, mimeType, caption ?? undefined);
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
