/**
 * Summarizer business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  createWorkplace,
  getWorkplacesByUser,
  getWorkplaceById,
  updateWorkplace,
  deleteWorkplace,
  createAchievement,
  getAchievementsByWorkplace,
  updateAchievement,
  deleteAchievement,
  getAllAchievementsForSummary,
} from "../summarizer/repository.js";
import { SUMMARIZER_MODEL } from "../constants.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import type {
  WorkplaceDto,
  WorkAchievementDto,
  SummaryDto,
} from "../shared/types.js";

const log = createLogger("summarizer-service");

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

// ─── Service Functions ────────────────────────────────────────

/**
 * Get all workplaces for a user.
 */
export async function getUserWorkplaces(telegramId: number): Promise<WorkplaceDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const workplaces = await getWorkplacesByUser(dbUser.id);

  return workplaces.map((w) => ({
    id: w.id,
    title: w.title,
    company: w.company,
    isActive: w.isActive,
    achievementCount: w.achievementCount ?? 0,
    createdAt: w.createdAt.toISOString(),
  }));
}

/**
 * Get a single workplace by ID.
 */
export async function getWorkplace(
  telegramId: number,
  workplaceId: number
): Promise<WorkplaceDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const w = await getWorkplaceById(workplaceId, dbUser.id);
  if (!w) return null;

  return {
    id: w.id,
    title: w.title,
    company: w.company,
    isActive: w.isActive,
    achievementCount: w.achievementCount ?? 0,
    createdAt: w.createdAt.toISOString(),
  };
}

/**
 * Create a new workplace.
 */
export async function createNewWorkplace(
  telegramId: number,
  title: string,
  company?: string
): Promise<WorkplaceDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const w = await createWorkplace(dbUser.id, title, company);

  return {
    id: w.id,
    title: w.title,
    company: w.company,
    isActive: w.isActive,
    achievementCount: 0,
    createdAt: w.createdAt.toISOString(),
  };
}

/**
 * Delete a workplace.
 */
export async function removeWorkplace(telegramId: number, workplaceId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return deleteWorkplace(workplaceId, dbUser.id);
}

/**
 * Update workplace properties.
 */
export async function editWorkplace(
  telegramId: number,
  workplaceId: number,
  updates: { title?: string; company?: string }
): Promise<WorkplaceDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const w = await updateWorkplace(workplaceId, dbUser.id, updates);
  if (!w) return null;

  return {
    id: w.id,
    title: w.title,
    company: w.company,
    isActive: w.isActive,
    achievementCount: 0,
    createdAt: w.createdAt.toISOString(),
  };
}

/**
 * Get achievements for a workplace with pagination.
 */
export async function getWorkplaceAchievements(
  telegramId: number,
  workplaceId: number,
  limit: number = 5,
  offset: number = 0
): Promise<WorkAchievementDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Verify ownership
  const w = await getWorkplaceById(workplaceId, dbUser.id);
  if (!w) throw new Error("Место работы не найдено.");

  const achievements = await getAchievementsByWorkplace(workplaceId, limit, offset);
  return achievements.map((a) => ({
    id: a.id,
    workplaceId: a.workplaceId,
    text: a.text,
    inputMethod: a.inputMethod,
    createdAt: a.createdAt.toISOString(),
  }));
}

/**
 * Add an achievement to a workplace.
 */
export async function addAchievement(
  telegramId: number,
  workplaceId: number,
  text: string,
  inputMethod: string = "text"
): Promise<WorkAchievementDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Verify ownership
  const w = await getWorkplaceById(workplaceId, dbUser.id);
  if (!w) throw new Error("Место работы не найдено.");

  const a = await createAchievement(workplaceId, text, inputMethod);
  return {
    id: a.id,
    workplaceId: a.workplaceId,
    text: a.text,
    inputMethod: a.inputMethod,
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * Delete an achievement.
 */
export async function removeAchievement(telegramId: number, achievementId: number): Promise<boolean> {
  requireDb();
  return deleteAchievement(achievementId);
}

/**
 * Generate an AI summary of all achievements for a workplace.
 */
export async function generateSummary(
  telegramId: number,
  workplaceId: number
): Promise<SummaryDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const w = await getWorkplaceById(workplaceId, dbUser.id);
  if (!w) throw new Error("Место работы не найдено.");

  const achievements = await getAllAchievementsForSummary(workplaceId);
  if (achievements.length === 0) {
    throw new Error("Нет достижений для саммари. Добавьте хотя бы одно достижение.");
  }

  const achievementTexts = achievements.map((a, i) => `${i + 1}. ${a.text}`).join("\n");

  const prompt = `Составь профессиональное саммари достижений для резюме на основе следующих записей.
Должность: ${w.title}${w.company ? ` в компании ${w.company}` : ""}.

Записи достижений:
${achievementTexts}

Напиши краткое, профессиональное описание достижений (3-5 пунктов) в формате, подходящем для резюме.
Используй активные глаголы, конкретные результаты и метрики где возможно.
Ответ на русском языке.`;

  const result = await callOpenRouter({
    model: SUMMARIZER_MODEL,
    messages: [
      { role: "system", content: "Ты — HR-специалист, помогающий составить профессиональное резюме." },
      { role: "user", content: prompt },
    ],
    max_tokens: 1000,
    temperature: 0.7,
  });

  if (!result) {
    throw new Error("Не удалось сгенерировать саммари. Попробуйте ещё раз.");
  }

  return {
    workplaceId,
    summary: result,
    achievementCount: achievements.length,
  };
}
