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
  updateReminderSound,
  getTribeReminders,
  addSubscriber,
  removeSubscriber,
  getSubscribers,
  isSubscribed,
} from "../reminders/repository.js";
import {
  getAvailableSounds as getAvailableSoundsRepo,
  getSoundById,
  getFiredRemindersWithSound,
} from "../reminders/soundRepository.js";
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
  ReminderSoundDto,
  FiredReminderDto,
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

function reminderToDto(
  r: {
    id: number;
    text: string;
    schedule: ReminderSchedule;
    isActive: boolean;
    lastFiredAt: Date | null;
    soundId: number | null;
    soundEnabled: boolean;
    createdAt: Date;
  },
  subscribers: ReminderSubscriberDto[] = [],
  soundInfo?: { name: string; emoji: string } | null,
): ReminderDto {
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
    soundId: r.soundId,
    soundEnabled: r.soundEnabled,
    soundName: soundInfo?.name ?? null,
    soundEmoji: soundInfo?.emoji ?? null,
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
    const soundInfo = r.soundId ? await getSoundById(r.soundId) : null;
    result.push(reminderToDto(
      r,
      subs.map((s) => ({ id: s.id, subscriberName: s.subscriberName ?? "" })),
      soundInfo ? { name: soundInfo.name, emoji: soundInfo.emoji } : null,
    ));
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
  const soundInfo = r.soundId ? await getSoundById(r.soundId) : null;
  return reminderToDto(
    r,
    subs.map((s) => ({ id: s.id, subscriberName: s.subscriberName ?? "" })),
    soundInfo ? { name: soundInfo.name, emoji: soundInfo.emoji } : null,
  );
}

/**
 * Create a new reminder.
 */
export async function createNewReminder(
  telegramId: number,
  text: string,
  schedule: ReminderScheduleDto,
  inputMethod: string = "text",
  soundId?: number,
  soundEnabled?: boolean
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

  // Validate sound exists if provided
  let soundInfo: { name: string; emoji: string } | null = null;
  const resolvedSoundId = soundId ?? null;
  const resolvedSoundEnabled = (soundEnabled === true && resolvedSoundId !== null);
  if (resolvedSoundId !== null) {
    const sound = await getSoundById(resolvedSoundId);
    if (!sound) throw new Error("Выбранный звук не найден.");
    soundInfo = { name: sound.name, emoji: sound.emoji };
  }

  const reminder = await createReminder(
    dbUser.id,
    dbUser.tribeId,
    text,
    reminderSchedule,
    inputMethod,
    resolvedSoundId,
    resolvedSoundEnabled,
  );

  return reminderToDto(reminder, [], soundInfo);
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
  const soundInfo = updated.soundId ? await getSoundById(updated.soundId) : null;
  return reminderToDto(
    updated,
    [],
    soundInfo ? { name: soundInfo.name, emoji: soundInfo.emoji } : null,
  );
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
 * Edit reminder schedule.
 */
export async function editReminderSchedule(
  telegramId: number,
  reminderId: number,
  schedule: ReminderScheduleDto
): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const scheduleData: ReminderSchedule = {
    times: schedule.times,
    weekdays: schedule.weekdays,
    endDate: schedule.endDate ?? null,
  };
  const validationError = validateSchedule(scheduleData);
  if (validationError) throw new Error(validationError);
  return updateReminderSchedule(reminderId, dbUser.id, scheduleData);
}

/**
 * Update reminder sound settings.
 */
export async function editReminderSoundSettings(
  telegramId: number,
  reminderId: number,
  soundId: number | null,
  soundEnabled: boolean
): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (soundId !== null) {
    const sound = await getSoundById(soundId);
    if (!sound) throw new Error("Выбранный звук не найден.");
  }
  const resolvedEnabled = soundEnabled && soundId !== null;
  return updateReminderSound(reminderId, dbUser.id, soundId, resolvedEnabled);
}

/**
 * Get available reminder sounds.
 */
export async function getAvailableSounds(): Promise<ReminderSoundDto[]> {
  requireDb();
  const sounds = await getAvailableSoundsRepo();
  return sounds.map((s) => ({
    id: s.id,
    name: s.name,
    emoji: s.emoji,
    durationSeconds: s.durationSeconds,
  }));
}

/**
 * Get recently fired reminders with sound for Mini App polling.
 */
export async function getFiredReminders(
  telegramId: number,
  since: Date
): Promise<FiredReminderDto[]> {
  requireDb();
  return getFiredRemindersWithSound(telegramId, since);
}

/**
 * Get tribe reminders (excluding own).
 */
export async function getTribeRemindersList(telegramId: number): Promise<Array<ReminderDto & { ownerName: string }>> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) return [];

  const reminders = await getTribeReminders(dbUser.tribeId, dbUser.id);
  const result: Array<ReminderDto & { ownerName: string }> = [];
  for (const r of reminders) {
    const soundInfo = r.soundId ? await getSoundById(r.soundId) : null;
    result.push({
      ...reminderToDto(
        r,
        [],
        soundInfo ? { name: soundInfo.name, emoji: soundInfo.emoji } : null,
      ),
      ownerName: r.ownerName,
    });
  }
  return result;
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
