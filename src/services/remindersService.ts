/**
 * Reminders business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  createReminder,
  getRemindersByUser,
  getReminderById,
  countActiveReminders,
  deleteReminder,
  toggleReminderActive,
  updateReminderText,
  updateReminderSchedule,
  getTribeReminders,
  addSubscriber,
  removeSubscriber,
  getSubscribers,
  isSubscribed,
} from "../reminders/repository.js";
import type { ReminderSchedule } from "../reminders/types.js";
import { formatScheduleDescription, validateSchedule } from "../reminders/service.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { MAX_REMINDERS_PER_USER } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type {
  ReminderDto,
  ReminderScheduleDto,
  ReminderSubscriberDto,
} from "../shared/types.js";

const log = createLogger("reminders-service");

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

function reminderToDto(r: {
  id: number;
  text: string;
  schedule: ReminderSchedule;
  isActive: boolean;
  lastFiredAt: Date | null;
  createdAt: Date;
}, subscribers: ReminderSubscriberDto[] = []): ReminderDto {
  return {
    id: r.id,
    text: r.text,
    schedule: {
      times: r.schedule.times,
      weekdays: r.schedule.weekdays,
      endDate: r.schedule.endDate ?? null,
    },
    isActive: r.isActive,
    lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    subscribers,
  };
}

// ─── Service Functions ────────────────────────────────────────

/**
 * Get all reminders for a user.
 */
export async function getUserReminders(telegramId: number): Promise<ReminderDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const reminders = await getRemindersByUser(dbUser.id);

  const result: ReminderDto[] = [];
  for (const r of reminders) {
    const subs = await getSubscribers(r.id);
    result.push(reminderToDto(r, subs.map((s) => ({
      id: s.id,
      subscriberName: s.subscriberName ?? "",
    }))));
  }
  return result;
}

/**
 * Get a single reminder by ID.
 */
export async function getReminder(telegramId: number, reminderId: number): Promise<ReminderDto | null> {
  requireDb();
  const r = await getReminderById(reminderId);
  if (!r) return null;

  // Verify ownership
  const dbUser = await requireDbUser(telegramId);
  if (r.userId !== dbUser.id) return null;

  const subs = await getSubscribers(r.id);
  return reminderToDto(r, subs.map((s) => ({
    id: s.id,
    subscriberName: s.subscriberName ?? "",
  })));
}

/**
 * Create a new reminder.
 */
export async function createNewReminder(
  telegramId: number,
  text: string,
  schedule: ReminderScheduleDto,
  inputMethod: string = "text"
): Promise<ReminderDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const count = await countActiveReminders(dbUser.id);
  if (count >= MAX_REMINDERS_PER_USER) {
    throw new Error(`Достигнут лимит: максимум ${MAX_REMINDERS_PER_USER} активных напоминаний.`);
  }

  const reminderSchedule: ReminderSchedule = {
    times: schedule.times,
    weekdays: schedule.weekdays,
    endDate: schedule.endDate ?? null,
  };

  const validationError = validateSchedule(reminderSchedule);
  if (validationError) throw new Error(validationError);

  const reminder = await createReminder(
    dbUser.id,
    dbUser.tribeId,
    text,
    reminderSchedule,
    inputMethod
  );

  return reminderToDto(reminder);
}

/**
 * Delete a reminder.
 */
export async function removeReminder(telegramId: number, reminderId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return deleteReminder(reminderId, dbUser.id);
}

/**
 * Toggle reminder active/inactive.
 */
export async function toggleReminder(telegramId: number, reminderId: number): Promise<ReminderDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const updated = await toggleReminderActive(reminderId, dbUser.id);
  if (!updated) return null;
  return reminderToDto(updated);
}

/**
 * Update reminder text.
 */
export async function editReminderText(
  telegramId: number,
  reminderId: number,
  text: string
): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return updateReminderText(reminderId, dbUser.id, text);
}

/**
 * Get tribe reminders (excluding own).
 */
export async function getTribeRemindersList(telegramId: number): Promise<Array<ReminderDto & { ownerName: string }>> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) return [];

  const reminders = await getTribeReminders(dbUser.tribeId, dbUser.id);
  return reminders.map((r) => ({
    ...reminderToDto(r),
    ownerName: r.ownerName,
  }));
}

/**
 * Subscribe to a reminder.
 */
export async function subscribeToReminder(telegramId: number, reminderId: number): Promise<void> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  await addSubscriber(reminderId, dbUser.id);
}

/**
 * Unsubscribe from a reminder.
 */
export async function unsubscribeFromReminder(telegramId: number, reminderId: number): Promise<void> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  await removeSubscriber(reminderId, dbUser.id);
}
