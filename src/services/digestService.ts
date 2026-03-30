/**
 * Digest business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  getRubricsByUser,
  getRubricByIdAndUser,
  countRubricsByUser,
  createRubric,
  deleteRubric,
  toggleRubric,
  toggleRubricIsActive,
  updateRubric,
  addChannel,
  removeChannelById,
  getChannelById,
  getChannelsByRubric,
  countChannelsByRubric,
  countTotalChannels,
  MAX_RUBRICS_PER_USER,
  MAX_CHANNELS_PER_RUBRIC,
  MAX_CHANNELS_TOTAL,
} from "../digest/repository.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import type {
  DigestRubricDto,
  DigestChannelDto,
} from "../shared/types.js";

const log = createLogger("digest-service");

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
 * Get all rubrics for a user.
 */
export async function getUserRubrics(telegramId: number): Promise<DigestRubricDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const rubrics = await getRubricsByUser(dbUser.id);

  const result: DigestRubricDto[] = [];
  for (const r of rubrics) {
    const channelCount = await countChannelsByRubric(r.id);
    result.push({
      id: r.id,
      name: r.name,
      description: r.description,
      emoji: r.emoji,
      keywords: r.keywords,
      isActive: r.isActive,
      channelCount,
      lastRunAt: null,
    });
  }
  return result;
}

/**
 * Get a single rubric by ID.
 */
export async function getRubric(
  telegramId: number,
  rubricId: number
): Promise<DigestRubricDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const r = await getRubricByIdAndUser(rubricId, dbUser.id);
  if (!r) return null;

  const channelCount = await countChannelsByRubric(r.id);
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    emoji: r.emoji,
    keywords: r.keywords,
    isActive: r.isActive,
    channelCount,
    lastRunAt: null,
  };
}

/**
 * Create a new rubric.
 */
export async function createNewRubric(
  telegramId: number,
  params: { name: string; description?: string; emoji?: string; keywords?: string[] }
): Promise<DigestRubricDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const count = await countRubricsByUser(dbUser.id);
  if (count >= MAX_RUBRICS_PER_USER) {
    throw new Error(`Достигнут лимит: максимум ${MAX_RUBRICS_PER_USER} рубрик.`);
  }

  const rubric = await createRubric({
    userId: dbUser.id,
    name: params.name,
    description: params.description ?? null,
    emoji: params.emoji ?? "📰",
    keywords: params.keywords ?? [],
  });

  return {
    id: rubric.id,
    name: rubric.name,
    description: rubric.description,
    emoji: rubric.emoji,
    keywords: rubric.keywords,
    isActive: rubric.isActive,
    channelCount: 0,
    lastRunAt: null,
  };
}

/**
 * Edit a rubric (partial update).
 */
export async function editRubric(
  telegramId: number,
  rubricId: number,
  updates: { name?: string; description?: string | null; emoji?: string | null; keywords?: string[] }
): Promise<DigestRubricDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Verify ownership
  const existing = await getRubricByIdAndUser(rubricId, dbUser.id);
  if (!existing) return null;

  const updated = await updateRubric(rubricId, updates);
  if (!updated) return null;

  // Re-fetch to return the full updated DTO
  const rubric = await getRubricByIdAndUser(rubricId, dbUser.id);
  if (!rubric) return null;

  const channelCount = await countChannelsByRubric(rubric.id);
  return {
    id: rubric.id,
    name: rubric.name,
    description: rubric.description,
    emoji: rubric.emoji,
    keywords: rubric.keywords,
    isActive: rubric.isActive,
    channelCount,
    lastRunAt: null,
  };
}

/**
 * Delete a rubric.
 */
export async function removeRubric(telegramId: number, rubricId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return deleteRubric(rubricId, dbUser.id);
}

/**
 * Toggle rubric active/inactive (inverts current state).
 * Returns updated rubric DTO or null if not found.
 */
export async function toggleRubricActive(
  telegramId: number,
  rubricId: number
): Promise<DigestRubricDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const rubric = await toggleRubricIsActive(rubricId, dbUser.id);
  if (!rubric) return null;

  const channelCount = await countChannelsByRubric(rubric.id);
  return {
    id: rubric.id,
    name: rubric.name,
    description: rubric.description,
    emoji: rubric.emoji,
    keywords: rubric.keywords,
    isActive: rubric.isActive,
    channelCount,
    lastRunAt: null,
  };
}

/**
 * Get channels for a rubric.
 */
export async function getRubricChannels(
  telegramId: number,
  rubricId: number
): Promise<DigestChannelDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Verify ownership
  const rubric = await getRubricByIdAndUser(rubricId, dbUser.id);
  if (!rubric) throw new Error("Рубрика не найдена.");

  const channels = await getChannelsByRubric(rubricId);
  return channels.map((c) => ({
    id: c.id,
    rubricId: c.rubricId,
    channelUsername: c.channelUsername,
    channelTitle: c.channelTitle,
    subscriberCount: c.subscriberCount,
    isActive: c.isActive,
  }));
}

/**
 * Add a channel to a rubric.
 */
export async function addChannelToRubric(
  telegramId: number,
  rubricId: number,
  channelUsername: string
): Promise<DigestChannelDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Verify ownership
  const rubric = await getRubricByIdAndUser(rubricId, dbUser.id);
  if (!rubric) throw new Error("Рубрика не найдена.");

  const channelCount = await countChannelsByRubric(rubricId);
  if (channelCount >= MAX_CHANNELS_PER_RUBRIC) {
    throw new Error(`Достигнут лимит: максимум ${MAX_CHANNELS_PER_RUBRIC} каналов в рубрике.`);
  }

  const totalChannels = await countTotalChannels();
  if (totalChannels >= MAX_CHANNELS_TOTAL) {
    throw new Error(`Достигнут глобальный лимит каналов (${MAX_CHANNELS_TOTAL}).`);
  }

  const channel = await addChannel(rubricId, channelUsername);
  return {
    id: channel.id,
    rubricId: channel.rubricId,
    channelUsername: channel.channelUsername,
    channelTitle: channel.channelTitle,
    subscriberCount: channel.subscriberCount,
    isActive: channel.isActive,
  };
}

/**
 * Remove a channel from a rubric.
 */
export async function removeChannelFromRubric(
  telegramId: number,
  rubricId: number,
  channelId: number
): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Verify rubric ownership
  const rubric = await getRubricByIdAndUser(rubricId, dbUser.id);
  if (!rubric) throw new Error("Рубрика не найдена.");

  return removeChannelById(channelId, rubricId);
}
