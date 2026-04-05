// ─── Re-exported from shared (single source of truth) ─────────────
export {
  TIMEZONE_MSK,
  DEFAULT_MONTHLY_LIMIT,
  MAX_EXPENSE_AMOUNT,
  MIN_EXPENSE_AMOUNT,
  MAX_SUBCATEGORY_LENGTH,
  MAX_REMINDERS_PER_USER,
  OSINT_DAILY_LIMIT,
  MAX_WORKPLACES_PER_USER,
  MAX_ACHIEVEMENT_LENGTH,
  MAX_BLOGGER_CHANNELS,
  MAX_POST_SOURCES,
  MAX_POST_LENGTH,
  MAX_SIMPLIFIER_INPUT_LENGTH,
  NUTRITIONIST_DAILY_LIMIT,
  NUTRITION_MAX_PRODUCTS_PER_USER,
  NUTRITION_PRODUCT_CATALOG_PROMPT_LIMIT,
  NUTRITION_PRODUCT_NAME_MAX_LENGTH,
  NUTRITION_PRODUCT_DESCRIPTION_MAX_LENGTH,
} from "./shared/constants.js";

// ─── Backend-only constants ───────────────────────────────────────

/** OpenRouter API base URL. */
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** DeepSeek model for intent/expense extraction. */
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek/deepseek-chat-v3.1";

/** DeepSeek free model via OpenRouter (rate-limited but genuinely free). */
export const DEEPSEEK_FREE_MODEL = process.env.DEEPSEEK_FREE_MODEL || "deepseek/deepseek-chat-v3.1:free";

/** Uncensored model for neuro chat (via OpenRouter, no content filters). */
export const NEURO_UNCENSORED_MODEL = process.env.NEURO_UNCENSORED_MODEL || "gryphe/mythomax-l2-13b:free";

/** Gemini model for voice transcription (calendar/expenses modes). */
export const TRANSCRIBE_MODEL = process.env.STT_MODEL || "google/gemini-2.0-flash-001";

/** Gemini model for high-quality voice transcription (transcribe mode). */
export const TRANSCRIBE_MODEL_HQ = process.env.STT_MODEL_HQ || "google/gemini-2.0-flash-001";

/** Fallback model for STT when primary model is geo-blocked. */
export const TRANSCRIBE_MODEL_FALLBACK = process.env.STT_MODEL_FALLBACK || "openai/gpt-4o-mini-audio-preview";

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

/** OSINT: AI model for report analysis (via OpenRouter). */
export const OSINT_ANALYSIS_MODEL = process.env.OSINT_MODEL || "anthropic/claude-sonnet-4";

/** OSINT: Tavily API base URL. */
export const TAVILY_API_URL = "https://api.tavily.com";

/** OSINT: max search queries for Phase 1. */
export const OSINT_QUERIES_LIMIT = 55;

/** OSINT: results per query. */
export const OSINT_RESULTS_PER_QUERY = 10;

/** OSINT: top sources for final analysis. */
export const OSINT_TOP_SOURCES = 100;

/** OSINT: how many top results get raw_content (Tier 1) in final analysis. */
export const OSINT_RAW_CONTENT_TOP = 40;

/** OSINT: Tier 2 boundary — results from RAW_CONTENT_TOP to this index get medium raw_content. */
export const OSINT_RAW_CONTENT_MEDIUM_END = 70;

/** OSINT: max follow-up queries in Phase 2. */
export const OSINT_PHASE2_QUERIES_LIMIT = 25;

/** OSINT: max URLs for extract API. */
export const OSINT_EXTRACT_URLS_LIMIT = 30;

/** OSINT: max tokens for final analysis. */
export const OSINT_ANALYSIS_MAX_TOKENS = 32000;

/** OSINT: max results for Phase 1 intermediate analysis. */
export const OSINT_PHASE1_ANALYSIS_LIMIT = 60;

/** Summarizer: AI model for summary generation (via OpenRouter). */
export const SUMMARIZER_MODEL = process.env.SUMMARIZER_MODEL || "anthropic/claude-sonnet-4";

/** Blogger: AI model for post generation (via OpenRouter). */
export const BLOGGER_MODEL = process.env.BLOGGER_MODEL || "anthropic/claude-sonnet-4";

/** Simplifier: AI model for text simplification (via OpenRouter). */
export const SIMPLIFIER_MODEL = process.env.SIMPLIFIER_MODEL || "deepseek/deepseek-chat-v3.1";

/** Neuro: vision model for image/document analysis (supports images, PDF, DOCX natively). */
export const NEURO_VISION_MODEL = process.env.NEURO_VISION_MODEL || "google/gemini-2.0-flash-001";

/** Nutritionist: vision model for food photo analysis. */
export const NUTRITIONIST_VISION_MODEL = process.env.NUTRITIONIST_MODEL || "google/gemini-2.0-flash-001";

/** Nutritionist: max size of a product package photo uploaded by user (webapp or bot). */
export const NUTRITION_PRODUCT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/** Nutritionist: directory for storing user product package photos. */
export const NUTRITION_PRODUCTS_DIR = "./data/nutritionist-products";

/** Neuro: debounce delay after last message before flushing batch. */
export const NEURO_BATCH_DEBOUNCE_MS = 3_000;

/** Neuro: max wait time from first message in batch. */
export const NEURO_BATCH_MAX_WAIT_MS = 30_000;

/** Neuro: max URLs to fetch from user message. */
export const NEURO_MAX_URLS = 5;

/** Neuro: max search results from Tavily. */
export const NEURO_MAX_SEARCH_RESULTS = 8;
