import { filterAndRankModels } from "./models.js";
import { truncateText } from "../utils/uiKit.js";
import type { OpenRouterModelDto } from "../shared/types.js";

// Pure logic behind the bot's dialog-settings panel: paging, filtering, labels,
// callback-data grammar and input validation. No telegraf, no DB — unit-testable.

export const MODEL_PICKER_PAGE_SIZE = 8;
/** Hard cap on the working set: the OpenRouter catalog is ~300+ models and paging
 *  through all of it in an inline keyboard is unusable — filters exist for that. */
export const MODEL_PICKER_MAX = 200;
export const VENDOR_PAGE_SIZE = 12;
/** = varchar(120) on chat_dialogs.model. */
export const MODEL_ID_MAX = 120;
/** One Telegram message; the API's zod schema allows up to 8000. */
export const SYSTEM_PROMPT_MAX = 4000;
export const DIALOG_TITLE_MAX = 100;
export const SEARCH_QUERY_MAX = 60;

/** Typing "-" in a text step means "clear this value". */
const CLEAR_TOKENS = new Set(["-", "—", "–"]);

export interface PickerFilters {
  query: string;
  free: boolean;
  vendor?: string;
}

export function buildPickerResults(
  all: OpenRouterModelDto[],
  filters: PickerFilters
): OpenRouterModelDto[] {
  return filterAndRankModels(all, filters.query, {
    free: filters.free || undefined,
    vendor: filters.vendor,
    limit: MODEL_PICKER_MAX,
  });
}

export function pageCount(total: number, pageSize: number = MODEL_PICKER_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampPage(
  page: number,
  total: number,
  pageSize: number = MODEL_PICKER_PAGE_SIZE
): number {
  if (!Number.isFinite(page)) return 0;
  const last = pageCount(total, pageSize) - 1;
  return Math.min(Math.max(Math.trunc(page), 0), last);
}

export function pageSlice<T>(
  items: T[],
  page: number,
  pageSize: number = MODEL_PICKER_PAGE_SIZE
): { items: T[]; startIndex: number } {
  const safePage = clampPage(page, items.length, pageSize);
  const startIndex = safePage * pageSize;
  return { items: items.slice(startIndex, startIndex + pageSize), startIndex };
}

export function formatModelLabel(model: OpenRouterModelDto, isCurrent: boolean): string {
  const mark = isCurrent ? "✅ " : "";
  const price = model.isFree ? "🆓 " : "💎 ";
  return `${mark}${price}${truncateText(model.name, 60)}`;
}

export function formatModelHint(model: OpenRouterModelDto): string {
  const ctx = model.contextLength ? ` · ctx ${Math.round(model.contextLength / 1000)}k` : "";
  const perM = model.promptPrice != null ? ` · $${(model.promptPrice * 1e6).toFixed(2)}/1M` : "";
  return `${model.id}${ctx}${perM}`;
}

export function formatFiltersLine(filters: PickerFilters, total: number, page: number): string {
  const parts: string[] = [];
  if (filters.free) parts.push("только бесплатные");
  if (filters.vendor) parts.push(`вендор: ${filters.vendor}`);
  if (filters.query) parts.push(`поиск: «${filters.query}»`);
  const filtersText = parts.length > 0 ? parts.join(" · ") : "без фильтров";
  const pages = pageCount(total);
  const capped = total >= MODEL_PICKER_MAX
    ? `\nПоказаны первые ${MODEL_PICKER_MAX} — уточните поиск.`
    : "";
  return `Фильтры: ${filtersText}\nНайдено: ${total} · страница ${clampPage(page, total) + 1}/${pages}${capped}`;
}

export function isClearToken(raw: string): boolean {
  return CLEAR_TOKENS.has(raw.trim());
}

export function normalizeSearchQuery(raw: string): string {
  const trimmed = raw.trim();
  if (isClearToken(trimmed)) return "";
  return trimmed.slice(0, SEARCH_QUERY_MAX);
}

const MODEL_ID_RE = /^[a-z0-9~._-]+\/[a-z0-9._:-]+$/i;

export function validateModelId(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MODEL_ID_MAX) return null;
  return MODEL_ID_RE.test(trimmed) ? trimmed : null;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateSystemPrompt(raw: string): ValidationResult<string | null> {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || isClearToken(trimmed)) return { ok: true, value: null };
  if (trimmed.length > SYSTEM_PROMPT_MAX) {
    return { ok: false, error: `Слишком длинный промпт (максимум ${SYSTEM_PROMPT_MAX} символов).` };
  }
  return { ok: true, value: trimmed };
}

export function validateDialogTitle(raw: string): ValidationResult<string> {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > DIALOG_TITLE_MAX) {
    return { ok: false, error: `Название должно быть от 1 до ${DIALOG_TITLE_MAX} символов.` };
  }
  return { ok: true, value: trimmed };
}

// ─── Callback data ──────────────────────────────────────────────────────────

export const NEURO_SETTINGS_PREFIX = "ncfg:";

export type PickerAction =
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "models" }
  | { kind: "page"; page: number }
  | { kind: "select"; index: number }
  | { kind: "toggleFree" }
  | { kind: "vendors" }
  | { kind: "vendorPage"; page: number }
  | { kind: "vendor"; index: number }
  | { kind: "search" }
  | { kind: "manualId" }
  | { kind: "clearFilters" }
  | { kind: "useDefault" }
  | { kind: "prompt" }
  | { kind: "promptSet" }
  | { kind: "promptClear" }
  | { kind: "rename" }
  | { kind: "reset" }
  | { kind: "resetConfirm" }
  | { kind: "cancelInput" };

const SIMPLE_VERBS: Record<string, PickerAction> = {
  open: { kind: "open" },
  close: { kind: "close" },
  mdl: { kind: "models" },
  mfree: { kind: "toggleFree" },
  mven: { kind: "vendors" },
  msrch: { kind: "search" },
  mid: { kind: "manualId" },
  mclr: { kind: "clearFilters" },
  mdef: { kind: "useDefault" },
  prm: { kind: "prompt" },
  prmset: { kind: "promptSet" },
  prmdel: { kind: "promptClear" },
  ren: { kind: "rename" },
  rst: { kind: "reset" },
  rstyes: { kind: "resetConfirm" },
  cancel: { kind: "cancelInput" },
};

function parseInt10(raw: string): number | null {
  if (!/^-?\d{1,6}$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : null;
}

/** Model ids reach ~60 chars and callback_data is capped at 64 bytes, so the
 *  grammar only ever carries short verbs and integer indices into panel state. */
export function parseSettingsCallback(data: string): PickerAction | null {
  if (!data.startsWith(NEURO_SETTINGS_PREFIX)) return null;
  const rest = data.slice(NEURO_SETTINGS_PREFIX.length);
  if (rest.length === 0) return null;

  const simple = SIMPLE_VERBS[rest];
  if (simple) return simple;

  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  const verb = rest.slice(0, sep);
  const arg = parseInt10(rest.slice(sep + 1));
  if (arg == null) return null;

  switch (verb) {
    case "mp": return arg >= 0 ? { kind: "page", page: arg } : null;
    case "ms": return arg >= 0 ? { kind: "select", index: arg } : null;
    case "mvp": return arg >= 0 ? { kind: "vendorPage", page: arg } : null;
    case "mv": return { kind: "vendor", index: arg };
    default: return null;
  }
}

export function buildSelectData(absoluteIndex: number): string {
  return `${NEURO_SETTINGS_PREFIX}ms:${absoluteIndex}`;
}

export function buildPageData(page: number): string {
  return `${NEURO_SETTINGS_PREFIX}mp:${page}`;
}

export function buildVendorData(index: number): string {
  return `${NEURO_SETTINGS_PREFIX}mv:${index}`;
}

export function buildVendorPageData(page: number): string {
  return `${NEURO_SETTINGS_PREFIX}mvp:${page}`;
}
