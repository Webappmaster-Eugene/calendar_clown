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
import { CHAT_DIALOG_MESSAGE_LIMIT, CHAT_MAX_DIALOGS_DEFAULT } from "./shared/constants.js";

// ─── Backend-only constants ───────────────────────────────────────

export function resolvePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = parseInt((raw ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const CHAT_MESSAGE_LIMIT = resolvePositiveInt(process.env.CHAT_MESSAGE_LIMIT, CHAT_DIALOG_MESSAGE_LIMIT);
export const CHAT_MAX_DIALOGS = resolvePositiveInt(process.env.CHAT_MAX_DIALOGS, CHAT_MAX_DIALOGS_DEFAULT);

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek/deepseek-chat-v3.1";

// meta-llama/llama-3.3-70b-instruct:free throttled hard by the OpenRouter free pool
// (persistent 429). Env key kept for deploy back-compat.
export const DEEPSEEK_FREE_MODEL = process.env.DEEPSEEK_FREE_MODEL || "google/gemini-2.5-flash";

export const NEURO_UNCENSORED_MODEL = process.env.NEURO_UNCENSORED_MODEL || "cognitivecomputations/dolphin-mistral-24b-venice-edition:free";

export const TRANSCRIBE_MODEL = process.env.STT_MODEL || "google/gemini-2.5-flash";

export const TRANSCRIBE_MODEL_HQ = process.env.STT_MODEL_HQ || "google/gemini-2.5-flash";

// Legacy singular STT_MODEL_FALLBACK is read as a source when the plural is unset,
// for back-compat with deploys that still set it.
export const TRANSCRIBE_MODEL_FALLBACKS: readonly string[] = (
  process.env.STT_MODEL_FALLBACKS ?? process.env.STT_MODEL_FALLBACK ?? "google/gemini-2.5-flash-lite"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const RATE_LIMIT_PER_MINUTE = 10;

export const VOICE_DIR = "./data/voice";

export const OPENROUTER_REFERER = "https://github.com/telegram-google-calendar-bot";

export const DB_UNAVAILABLE_MSG =
  "⚠️ Учёт расходов временно недоступен (нет подключения к базе данных).\n" +
  "Календарь работает в обычном режиме.";

export const OSINT_ANALYSIS_MODEL = process.env.OSINT_MODEL || "anthropic/claude-sonnet-4";

export const TAVILY_API_URL = "https://api.tavily.com";

export const OSINT_QUERIES_LIMIT = 55;

export const OSINT_RESULTS_PER_QUERY = 10;

export const OSINT_TOP_SOURCES = 100;

/** Top results (Tier 1) that get full raw_content in final analysis. */
export const OSINT_RAW_CONTENT_TOP = 40;

/** Tier 2 boundary: results from RAW_CONTENT_TOP to this index get medium raw_content. */
export const OSINT_RAW_CONTENT_MEDIUM_END = 70;

export const OSINT_PHASE2_QUERIES_LIMIT = 25;

export const OSINT_EXTRACT_URLS_LIMIT = 30;

export const OSINT_ANALYSIS_MAX_TOKENS = 32000;

export const OSINT_PHASE1_ANALYSIS_LIMIT = 60;

export const SUMMARIZER_MODEL = process.env.SUMMARIZER_MODEL || "anthropic/claude-sonnet-4";

// anthropic/claude-sonnet-4 overran the 30s client timeout on longer posts.
// Env key kept for deploy back-compat.
export const BLOGGER_MODEL = process.env.BLOGGER_MODEL || "google/gemini-2.5-flash";

export const SIMPLIFIER_MODEL = process.env.SIMPLIFIER_MODEL || "deepseek/deepseek-chat-v3.1";

export const NEURO_VISION_MODEL = process.env.NEURO_VISION_MODEL || "google/gemini-2.5-flash";

export const NUTRITIONIST_VISION_MODEL = process.env.NUTRITIONIST_MODEL || "google/gemini-2.5-flash";

export const NUTRITION_PRODUCT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export const NUTRITION_PRODUCTS_DIR = "./data/nutritionist-products";

export const NEURO_BATCH_DEBOUNCE_MS = 3_000;

export const NEURO_BATCH_MAX_WAIT_MS = 30_000;

export const NEURO_MAX_URLS = 5;

export const NEURO_MAX_SEARCH_RESULTS = 8;
