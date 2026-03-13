/** Moscow timezone identifier used across the app. */
export const TIMEZONE_MSK = "Europe/Moscow";

/** OpenRouter API base URL. */
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** DeepSeek model for intent/expense extraction. */
export const DEEPSEEK_MODEL = "deepseek/deepseek-chat-v3.1";

/** Gemini model for voice transcription. */
export const TRANSCRIBE_MODEL = "google/gemini-2.0-flash-001";

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
