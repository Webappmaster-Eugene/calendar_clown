/** Moscow timezone identifier used across the app. */
export const TIMEZONE_MSK = "Europe/Moscow";

/** OpenRouter API base URL. */
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** DeepSeek model for intent/expense extraction. */
export const DEEPSEEK_MODEL = "deepseek/deepseek-chat-v3.1";

/** Gemini model for voice transcription (calendar/expenses modes). */
export const TRANSCRIBE_MODEL = process.env.STT_MODEL || "google/gemini-2.0-flash-001";

/** Gemini model for high-quality voice transcription (transcribe mode). */
export const TRANSCRIBE_MODEL_HQ = process.env.STT_MODEL_HQ || "google/gemini-2.0-flash-001";

/** Fallback model for STT when primary model is geo-blocked. */
export const TRANSCRIBE_MODEL_FALLBACK = process.env.STT_MODEL_FALLBACK || "openai/gpt-4o-mini-audio-preview";

/** Default monthly expense limit in rubles. */
export const DEFAULT_MONTHLY_LIMIT = 350_000;

/** Maximum allowed single expense amount (anti-abuse). */
export const MAX_EXPENSE_AMOUNT = 10_000_000;

/** Minimum allowed single expense amount. */
export const MIN_EXPENSE_AMOUNT = 1;

/** Maximum subcategory text length. */
export const MAX_SUBCATEGORY_LENGTH = 200;

/** Rate limit: max expense entries per user per minute. */
export const RATE_LIMIT_PER_MINUTE = 10;

/** Directory for temporary voice files. */
export const VOICE_DIR = "./data/voice";

/** HTTP Referer header for OpenRouter requests. */
export const OPENROUTER_REFERER = "https://github.com/telegram-google-calendar-bot";

/** Message shown when database is unavailable. */
export const DB_UNAVAILABLE_MSG =
  "⚠️ Учёт расходов временно недоступен (нет подключения к базе данных).\n" +
  "Календарь работает в обычном режиме.";
