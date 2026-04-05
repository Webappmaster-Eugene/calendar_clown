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
  calendar: { label: "Календарь", emoji: "📅", description: "Встречи в Google Calendar — текстом и голосом" },
  expenses: { label: "Расходы", emoji: "💰", description: "Учёт трат, отчёты по категориям, экспорт в Excel" },
  transcribe: { label: "Транскрибация", emoji: "🎙️", description: "Расшифровка голосовых сообщений в текст" },
  simplifier: { label: "Упрощатель", emoji: "🧹", description: "Очистка текста от мусора, повторений и слов-паразитов" },
  digest: { label: "Дайджест", emoji: "📰", description: "AI-саммари Telegram-каналов по рубрикам" },
  gandalf: { label: "База знаний", emoji: "🧙", description: "Каталог записей с категориями, файлами и приоритетами" },
  neuro: { label: "Нейро", emoji: "🧠", description: "AI-чат — текст, голос, фото, документы, веб-поиск" },
  goals: { label: "Цели", emoji: "🎯", description: "Наборы целей с отслеживанием прогресса" },
  reminders: { label: "Напоминания", emoji: "⏰", description: "Гибкие напоминания по расписанию — текстом или голосом" },
  wishlist: { label: "Вишлист", emoji: "🎁", description: "Списки желаний с бронированием подарков для семьи" },
  notable_dates: { label: "Даты", emoji: "🎂", description: "Дни рождения и важные даты с уведомлениями" },
  osint: { label: "OSINT", emoji: "🔍", description: "Поиск информации о людях и компаниях через AI" },
  summarizer: { label: "Резюме", emoji: "📋", description: "Учёт рабочих достижений и генерация AI-саммари" },
  blogger: { label: "Блогер", emoji: "✍️", description: "Генерация постов для Telegram-каналов через AI" },
  broadcast: { label: "Рассылка", emoji: "📢", description: "Отправка сообщений участникам трайба" },
  admin: { label: "Админка", emoji: "⚙️", description: "Управление пользователями, трайбами и данными" },
  tasks: { label: "Задачи", emoji: "✅", description: "Проекты и задачи с дедлайнами и напоминаниями" },
  nutritionist: { label: "Нутрициолог", emoji: "🥗", description: "Анализ еды по фото — калории, БЖУ, оценка полезности" },
};

/** Simplifier */
export const MAX_SIMPLIFIER_INPUT_LENGTH = 15_000;

/** Modes accessible without a tribe */
export const INDIVIDUAL_MODES = [
  "calendar", "transcribe", "simplifier", "gandalf", "neuro", "goals", "reminders", "nutritionist",
] as const;

/** Modes requiring tribe membership */
export const TRIBE_MODES = [
  "expenses", "digest", "notable_dates", "wishlist", "osint", "tasks", "summarizer", "blogger",
] as const;

/** Tasks */
export const MAX_TASK_WORKS = 10;
export const MAX_TASKS_PER_WORK = 50;

/** Nutritionist */
export const NUTRITIONIST_DAILY_LIMIT = 20;

/** Nutritionist: user product catalog */
export const NUTRITION_MAX_PRODUCTS_PER_USER = 200;
export const NUTRITION_PRODUCT_CATALOG_PROMPT_LIMIT = 60;
export const NUTRITION_PRODUCT_NAME_MAX_LENGTH = 200;
export const NUTRITION_PRODUCT_DESCRIPTION_MAX_LENGTH = 1000;

/** Admin-only modes */
export const ADMIN_MODES = ["broadcast", "admin"] as const;
