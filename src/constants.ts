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

/** Maximum active reminders per user. */
export const MAX_REMINDERS_PER_USER = 10;

/** Directory for temporary voice files. */
export const VOICE_DIR = "./data/voice";

/** HTTP Referer header for OpenRouter requests. */
export const OPENROUTER_REFERER = "https://github.com/telegram-google-calendar-bot";

/** Message shown when database is unavailable. */
export const DB_UNAVAILABLE_MSG =
  "⚠️ Учёт расходов временно недоступен (нет подключения к базе данных).\n" +
  "Календарь работает в обычном режиме.";

/** OSINT: daily search limit per user. */
export const OSINT_DAILY_LIMIT = 10;

/** OSINT: AI model for report analysis (via OpenRouter). */
export const OSINT_ANALYSIS_MODEL = process.env.OSINT_MODEL || "anthropic/claude-sonnet-4";

/** OSINT: Tavily API base URL. */
export const TAVILY_API_URL = "https://api.tavily.com";

/** OSINT: max search queries for Phase 1. */
export const OSINT_QUERIES_LIMIT = 45;

/** OSINT: results per query. */
export const OSINT_RESULTS_PER_QUERY = 10;

/** OSINT: top sources for final analysis. */
export const OSINT_TOP_SOURCES = 80;

/** OSINT: how many top results get raw_content in final analysis. */
export const OSINT_RAW_CONTENT_TOP = 20;

/** OSINT: max follow-up queries in Phase 2. */
export const OSINT_PHASE2_QUERIES_LIMIT = 15;

/** OSINT: max URLs for extract API. */
export const OSINT_EXTRACT_URLS_LIMIT = 20;

/** OSINT: max tokens for final analysis. */
export const OSINT_ANALYSIS_MAX_TOKENS = 20000;

/** Summarizer: AI model for summary generation (via OpenRouter). */
export const SUMMARIZER_MODEL = process.env.SUMMARIZER_MODEL || "anthropic/claude-sonnet-4";

/** Blogger: AI model for post generation (via OpenRouter). */
export const BLOGGER_MODEL = process.env.BLOGGER_MODEL || "anthropic/claude-sonnet-4";

/** Summarizer: max workplaces per user. */
export const MAX_WORKPLACES_PER_USER = 10;

/** Blogger: max channels per user. */
export const MAX_BLOGGER_CHANNELS = 5;

/** Blogger: max sources per post. */
export const MAX_POST_SOURCES = 20;

/** Summarizer: max achievement text length. */
export const MAX_ACHIEVEMENT_LENGTH = 2000;

/** Blogger: max generated post length. */
export const MAX_POST_LENGTH = 12000;

/** Neuro: vision model for image/document analysis (supports images, PDF, DOCX natively). */
export const NEURO_VISION_MODEL = process.env.NEURO_VISION_MODEL || "google/gemini-2.0-flash-001";

/** Neuro: debounce delay after last message before flushing batch. */
export const NEURO_BATCH_DEBOUNCE_MS = 3_000;

/** Neuro: max wait time from first message in batch. */
export const NEURO_BATCH_MAX_WAIT_MS = 30_000;

/** Neuro: max URLs to fetch from user message. */
export const NEURO_MAX_URLS = 5;

/** Neuro: max search results from Tavily. */
export const NEURO_MAX_SEARCH_RESULTS = 8;
