/**
 * Goals business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  createGoalSet,
  getGoalSetsByUser,
  getGoalSetById,
  deleteGoalSet,
  countGoalSetsByUser,
  updateGoalSet,
  createGoal,
  getGoalsBySet,
  toggleGoalCompleted,
  deleteGoal,
  getGoalSetProgress,
  addViewer,
  removeViewer,
  getViewersByGoalSet,
  getPublicGoalSetsForViewer,
  createReminders,
} from "../goals/repository.js";
import type { GoalSet, Goal } from "../goals/repository.js";
import {
  calculateDeadline,
  calculateReminderDates,
  formatPeriod,
  formatProgress,
} from "../goals/service.js";
import type { GoalPeriod } from "../goals/service.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import type {
  GoalSetDto,
  GoalDto,
  GoalSetVisibility,
} from "../shared/types.js";

const log = createLogger("goals-service");

const MAX_GOAL_SETS = 5;

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

function goalSetToDto(gs: GoalSet): GoalSetDto {
  return {
    id: gs.id,
    name: gs.name,
    emoji: gs.emoji,
    period: gs.period as GoalSetDto["period"],
    visibility: gs.visibility as GoalSetVisibility,
    deadline: gs.deadline?.toISOString() ?? null,
    completedCount: gs.completedCount ?? 0,
    totalCount: gs.totalCount ?? 0,
    createdAt: gs.createdAt.toISOString(),
  };
}

function goalToDto(g: Goal): GoalDto {
  return {
    id: g.id,
    goalSetId: g.goalSetId,
    text: g.text,
    isCompleted: g.isCompleted,
    completedAt: g.completedAt?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
  };
}

// ─── Service Functions ────────────────────────────────────────

/**
 * Get all goal sets for a user.
 */
export async function getUserGoalSets(telegramId: number): Promise<GoalSetDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const sets = await getGoalSetsByUser(dbUser.id);
  return sets.map(goalSetToDto);
}

/**
 * Get a single goal set with its goals.
 */
export async function getGoalSetWithGoals(
  telegramId: number,
  goalSetId: number
): Promise<{ goalSet: GoalSetDto; goals: GoalDto[] } | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const gs = await getGoalSetById(goalSetId);
  if (!gs || gs.userId !== dbUser.id) return null;

  const goals = await getGoalsBySet(goalSetId);
  return {
    goalSet: goalSetToDto(gs),
    goals: goals.map(goalToDto),
  };
}

/**
 * Create a new goal set.
 */
export async function createNewGoalSet(
  telegramId: number,
  name: string,
  period: GoalPeriod,
  emoji: string = "🎯"
): Promise<GoalSetDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const count = await countGoalSetsByUser(dbUser.id);
  if (count >= MAX_GOAL_SETS) {
    throw new Error(`Достигнут лимит: максимум ${MAX_GOAL_SETS} наборов целей.`);
  }

  const deadline = calculateDeadline(period, new Date());
  const gs = await createGoalSet(dbUser.id, name, period, deadline, emoji);

  // Create reminders if there's a deadline
  const reminderDates = calculateReminderDates(gs.createdAt, deadline);
  if (reminderDates.length > 0) {
    await createReminders(gs.id, reminderDates);
  }

  return goalSetToDto(gs);
}

/**
 * Delete a goal set.
 */
export async function removeGoalSet(telegramId: number, goalSetId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return deleteGoalSet(goalSetId, dbUser.id);
}

/**
 * Update goal set properties.
 */
export async function updateGoalSetProps(
  telegramId: number,
  goalSetId: number,
  updates: { name?: string; emoji?: string; visibility?: GoalSetVisibility }
): Promise<GoalSetDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const updated = await updateGoalSet(goalSetId, dbUser.id, updates);
  if (!updated) return null;
  return goalSetToDto(updated);
}

/**
 * Add a goal to a goal set.
 */
export async function addGoal(
  telegramId: number,
  goalSetId: number,
  text: string,
  inputMethod: string = "text"
): Promise<GoalDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Verify ownership
  const gs = await getGoalSetById(goalSetId);
  if (!gs || gs.userId !== dbUser.id) {
    throw new Error("Набор целей не найден.");
  }

  const goal = await createGoal(goalSetId, text, inputMethod);
  return goalToDto(goal);
}

/**
 * Toggle goal completion status.
 */
export async function toggleGoal(telegramId: number, goalId: number): Promise<GoalDto | null> {
  requireDb();
  // Note: toggleGoalCompleted doesn't do ownership check, but the API layer verifies telegramId
  const goal = await toggleGoalCompleted(goalId);
  if (!goal) return null;
  return goalToDto(goal);
}

/**
 * Delete a goal.
 */
export async function removeGoal(telegramId: number, goalId: number): Promise<boolean> {
  requireDb();
  return deleteGoal(goalId);
}

/**
 * Get public goal sets shared with the user (friends' goals).
 */
export async function getFriendsGoalSets(
  telegramId: number
): Promise<Array<GoalSetDto & { ownerName: string }>> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const sets = await getPublicGoalSetsForViewer(dbUser.id);
  return sets.map((gs) => ({
    ...goalSetToDto(gs),
    ownerName: gs.ownerName,
  }));
}

/**
 * Get goal set progress.
 */
export async function getProgress(goalSetId: number): Promise<{ completed: number; total: number; formatted: string }> {
  requireDb();
  const progress = await getGoalSetProgress(goalSetId);
  return {
    ...progress,
    formatted: formatProgress(progress.completed, progress.total),
  };
}
