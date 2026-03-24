/**
 * Constants shared between backend API and frontend Mini App.
 * Only frontend-relevant constants belong here.
 * Backend-internal constants (API keys, models, etc.) stay in src/constants.ts.
 */

export const TIMEZONE_MSK = "Europe/Moscow";

/** Expense limits */
export const DEFAULT_MONTHLY_LIMIT = 350_000;
export const MAX_EXPENSE_AMOUNT = 10_000_000;
export const MIN_EXPENSE_AMOUNT = 1;
export const MAX_SUBCATEGORY_LENGTH = 200;

/** Reminders */
export const MAX_REMINDERS_PER_USER = 10;

/** OSINT */
export const OSINT_DAILY_LIMIT = 10;

/** Summarizer */
export const MAX_WORKPLACES_PER_USER = 10;
export const MAX_ACHIEVEMENT_LENGTH = 2000;

/** Blogger */
export const MAX_BLOGGER_CHANNELS = 5;
export const MAX_POST_SOURCES = 20;
export const MAX_POST_LENGTH = 12000;

/** Mode labels for UI */
export const MODE_LABELS: Record<string, { label: string; emoji: string; description: string }> = {
  calendar: { label: "Календарь", emoji: "📅", description: "Управление встречами в Google Calendar" },
  expenses: { label: "Расходы", emoji: "💰", description: "Учёт и аналитика расходов" },
  transcribe: { label: "Транскрибация", emoji: "🎙️", description: "Транскрибация голосовых сообщений" },
  digest: { label: "Дайджест", emoji: "📰", description: "Дайджесты из Telegram-каналов" },
  gandalf: { label: "База знаний", emoji: "🧙", description: "Структурированная база знаний" },
  neuro: { label: "Нейро", emoji: "🧠", description: "AI-чат с контекстом" },
  goals: { label: "Цели", emoji: "🎯", description: "Постановка и отслеживание целей" },
  reminders: { label: "Напоминания", emoji: "⏰", description: "Персональные напоминания" },
  wishlist: { label: "Вишлист", emoji: "🎁", description: "Списки желаний с резервированием" },
  notable_dates: { label: "Даты", emoji: "🎂", description: "Дни рождения и важные даты" },
  osint: { label: "OSINT", emoji: "🔍", description: "Поиск информации о людях и компаниях" },
  summarizer: { label: "Резюме", emoji: "📋", description: "Учёт достижений и генерация резюме" },
  blogger: { label: "Блогер", emoji: "✍️", description: "Генерация постов для каналов" },
  broadcast: { label: "Рассылка", emoji: "📢", description: "Рассылка сообщений по трайбу" },
  admin: { label: "Админка", emoji: "⚙️", description: "Управление пользователями и трайбами" },
};

/** Modes accessible without a tribe */
export const INDIVIDUAL_MODES = [
  "calendar", "transcribe", "gandalf", "neuro", "goals", "reminders",
] as const;

/** Modes requiring tribe membership */
export const TRIBE_MODES = [
  "expenses", "digest", "notable_dates", "wishlist", "osint", "summarizer", "blogger",
] as const;

/** Admin-only modes */
export const ADMIN_MODES = ["broadcast", "admin"] as const;
