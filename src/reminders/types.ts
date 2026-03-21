/**
 * Types for the Reminders (Напоминатор) feature.
 */

/** Schedule definition stored as JSONB in PostgreSQL. */
export interface ReminderSchedule {
  /** Times to fire in HH:MM format (Moscow time). */
  times: string[];
  /** ISO-8601 weekdays: 1=Mon..7=Sun. */
  weekdays: number[];
  /** End date in YYYY-MM-DD format, or null for indefinite. */
  endDate: string | null;
}

/** Reminder row from the database (camelCase). */
export interface Reminder {
  id: number;
  userId: number;
  tribeId: number | null;
  text: string;
  schedule: ReminderSchedule;
  isActive: boolean;
  lastFiredAt: Date | null;
  inputMethod: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Reminder with owner info, used by scheduler. */
export interface ActiveReminderWithUser extends Reminder {
  telegramId: number;
}

/** Subscriber row from the database. */
export interface ReminderSubscriber {
  id: number;
  reminderId: number;
  subscriberUserId: number;
  createdAt: Date;
  subscriberTelegramId?: number;
  subscriberName?: string;
}

/** Pending wizard state for creating a reminder via text. */
export interface PendingReminderState {
  step: "awaiting_text" | "awaiting_schedule" | "confirming";
  text?: string;
  schedule?: ReminderSchedule;
  inputMethod: "text" | "voice";
}
