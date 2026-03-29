/**
 * Tasks business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  createTaskWork,
  getTaskWorksByUser,
  getTaskWorkById,
  getTaskWorkByName,
  updateTaskWork,
  deleteTaskWork,
  countTaskWorksByUser,
  createTaskItem,
  getTaskItemsByWork,
  getTaskItemById,
  toggleTaskItemCompleted,
  updateTaskItemDeadline as repoUpdateDeadline,
  updateTaskItemText,
  deleteTaskItem,
  countTaskItemsByWork,
  getCompletedTaskItems,
  getTaskItemWithOwnership,
  createTaskReminders,
  deleteRemindersForTask,
} from "../tasks/repository.js";
import type { TaskWork, TaskItem } from "../tasks/repository.js";
import { calculateTaskReminders } from "../tasks/logic.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import { MAX_TASK_WORKS, MAX_TASKS_PER_WORK } from "../shared/constants.js";
import type { TaskWorkDto, TaskItemDto } from "../shared/types.js";

const log = createLogger("tasks-service");

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

async function requireTribeMember(telegramId: number) {
  const dbUser = await requireDbUser(telegramId);
  if (dbUser.tribeId == null) {
    throw new Error("Трекер задач доступен только участникам трайба.");
  }
  return dbUser;
}

function taskWorkToDto(tw: TaskWork): TaskWorkDto {
  return {
    id: tw.id,
    name: tw.name,
    emoji: tw.emoji,
    isArchived: tw.isArchived,
    activeCount: tw.activeCount ?? 0,
    completedCount: tw.completedCount ?? 0,
    createdAt: tw.createdAt.toISOString(),
  };
}

function taskItemToDto(ti: TaskItem): TaskItemDto {
  return {
    id: ti.id,
    workId: ti.workId,
    text: ti.text,
    deadline: ti.deadline.toISOString(),
    isCompleted: ti.isCompleted,
    completedAt: ti.completedAt?.toISOString() ?? null,
    inputMethod: ti.inputMethod,
    createdAt: ti.createdAt.toISOString(),
  };
}

// ─── Works ────────────────────────────────────────────────────

export async function getUserWorks(telegramId: number): Promise<TaskWorkDto[]> {
  requireDb();
  const dbUser = await requireTribeMember(telegramId);
  const works = await getTaskWorksByUser(dbUser.id);
  return works.map(taskWorkToDto);
}

export async function getWorkWithTasks(
  telegramId: number,
  workId: number,
): Promise<{ work: TaskWorkDto; tasks: TaskItemDto[] } | null> {
  requireDb();
  const dbUser = await requireTribeMember(telegramId);
  const work = await getTaskWorkById(workId);
  if (!work || work.userId !== dbUser.id) return null;
  const tasks = await getTaskItemsByWork(workId);
  return { work: taskWorkToDto(work), tasks: tasks.map(taskItemToDto) };
}

export async function createNewWork(
  telegramId: number,
  name: string,
  emoji?: string,
): Promise<TaskWorkDto> {
  requireDb();
  const dbUser = await requireTribeMember(telegramId);

  const count = await countTaskWorksByUser(dbUser.id);
  if (count >= MAX_TASK_WORKS) {
    throw new Error(`Максимум ${MAX_TASK_WORKS} активных проектов.`);
  }

  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 100) {
    throw new Error("Название проекта должно быть от 1 до 100 символов.");
  }

  const work = await createTaskWork(dbUser.id, trimmedName, emoji);
  return taskWorkToDto(work);
}

export async function removeWork(telegramId: number, workId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireTribeMember(telegramId);
  return deleteTaskWork(workId, dbUser.id);
}

export async function archiveWork(
  telegramId: number,
  workId: number,
): Promise<TaskWorkDto | null> {
  requireDb();
  const dbUser = await requireTribeMember(telegramId);
  const updated = await updateTaskWork(workId, dbUser.id, { isArchived: true });
  return updated ? taskWorkToDto(updated) : null;
}

export async function findWorkByName(
  telegramId: number,
  name: string,
): Promise<TaskWorkDto | null> {
  requireDb();
  const dbUser = await requireTribeMember(telegramId);
  const work = await getTaskWorkByName(dbUser.id, name);
  return work ? taskWorkToDto(work) : null;
}

// ─── Tasks ────────────────────────────────────────────────────

export async function addTask(
  telegramId: number,
  workId: number,
  text: string,
  deadline: Date,
  inputMethod: string = "text",
): Promise<TaskItemDto> {
  requireDb();

  if (deadline.getTime() <= Date.now()) {
    throw new Error("Дедлайн не может быть в прошлом.");
  }

  const dbUser = await requireTribeMember(telegramId);

  // Verify ownership
  const work = await getTaskWorkById(workId);
  if (!work || work.userId !== dbUser.id) {
    throw new Error("Проект не найден.");
  }

  // Check limit
  const count = await countTaskItemsByWork(workId);
  if (count >= MAX_TASKS_PER_WORK) {
    throw new Error(`Максимум ${MAX_TASKS_PER_WORK} задач в проекте.`);
  }

  const trimmedText = text.trim();
  if (!trimmedText || trimmedText.length > 500) {
    throw new Error("Текст задачи должен быть от 1 до 500 символов.");
  }

  // Create task
  const item = await createTaskItem(workId, trimmedText, deadline, inputMethod);

  // Generate and store reminders
  const reminders = calculateTaskReminders(deadline);
  if (reminders.length > 0) {
    await createTaskReminders(item.id, reminders);
    log.info(`Created ${reminders.length} reminders for task ${item.id}`);
  }

  return taskItemToDto(item);
}

export async function toggleTask(
  telegramId: number,
  taskItemId: number,
): Promise<TaskItemDto | null> {
  requireDb();
  const dbUser = await requireTribeMember(telegramId);

  // Verify ownership
  const ownership = await getTaskItemWithOwnership(taskItemId, dbUser.id);
  if (!ownership) return null;

  const toggled = await toggleTaskItemCompleted(taskItemId);
  return toggled ? taskItemToDto(toggled) : null;
}

export async function updateDeadline(
  telegramId: number,
  taskItemId: number,
  deadline: Date,
): Promise<TaskItemDto | null> {
  requireDb();
  const dbUser = await requireTribeMember(telegramId);

  // Verify ownership
  const ownership = await getTaskItemWithOwnership(taskItemId, dbUser.id);
  if (!ownership) return null;

  // Update deadline
  const updated = await repoUpdateDeadline(taskItemId, deadline);
  if (!updated) return null;

  // Regenerate reminders
  await deleteRemindersForTask(taskItemId);
  const reminders = calculateTaskReminders(deadline);
  if (reminders.length > 0) {
    await createTaskReminders(taskItemId, reminders);
    log.info(`Regenerated ${reminders.length} reminders for task ${taskItemId}`);
  }

  return taskItemToDto(updated);
}

export async function updateText(
  telegramId: number,
  taskItemId: number,
  text: string,
): Promise<TaskItemDto | null> {
  requireDb();
  const dbUser = await requireTribeMember(telegramId);

  // Verify ownership
  const ownership = await getTaskItemWithOwnership(taskItemId, dbUser.id);
  if (!ownership) return null;

  const trimmedText = text.trim();
  if (!trimmedText || trimmedText.length > 500) {
    throw new Error("Текст задачи должен быть от 1 до 500 символов.");
  }

  const updated = await updateTaskItemText(taskItemId, trimmedText);
  return updated ? taskItemToDto(updated) : null;
}

export async function removeTask(
  telegramId: number,
  taskItemId: number,
): Promise<boolean> {
  requireDb();
  const dbUser = await requireTribeMember(telegramId);

  // Verify ownership
  const ownership = await getTaskItemWithOwnership(taskItemId, dbUser.id);
  if (!ownership) return false;

  return deleteTaskItem(taskItemId);
}

export async function getCompletedHistory(
  telegramId: number,
  workId: number,
): Promise<TaskItemDto[]> {
  requireDb();
  const dbUser = await requireTribeMember(telegramId);

  // Verify ownership
  const work = await getTaskWorkById(workId);
  if (!work || work.userId !== dbUser.id) return [];

  const items = await getCompletedTaskItems(workId);
  return items.map(taskItemToDto);
}
