import { extractUrls, fetchLinksContent, formatLinksForContext, type FetchedLink } from "./linkAnalyzer.js";
import { classifySearchNeed, executeWebSearch, formatSearchResultsForContext } from "./webSearch.js";
import { NEURO_MAX_AUGMENTED_CONTEXT } from "../constants.js";
import type { WebSearchStrategy } from "./webSearchStrategy.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("neuro-augment");

// The one implementation of "the assistant has internet": reads the URLs the user
// sent and, when the message needs fresh facts, runs a web search — then injects
// both as context blocks the system prompt teaches the model to use. Shared by the
// bot (text/voice/photo/document) and the Mini App API.
//
// Link reading always happens here. Search only happens on the "context" strategy;
// with "native" the model runs its own search through OpenRouter's web plugin, so
// spending a classifier call and a Tavily request here would be waste.

export type AugmentStatusKind = "reading_links" | "searching" | "search_unconfigured";

export interface AugmentStatus {
  kind: AugmentStatusKind;
  label: string;
}

export const AUGMENT_STATUS_LABELS: Record<AugmentStatusKind, string> = {
  reading_links: "🔗 Читаю ссылки…",
  searching: "🔍 Ищу информацию…",
  search_unconfigured: "⚠️ Веб-поиск не настроен — отвечаю без интернета",
};

const SEARCH_UNAVAILABLE_BLOCK =
  "--- Веб-поиск недоступен ---\n" +
  "Веб-поиск не настроен на сервере, свежие данные получить нельзя. " +
  "Отвечай по своим знаниям и честно предупреди пользователя, что информация может быть устаревшей. " +
  "Содержимое ссылок при этом читать можешь.\n" +
  "--- Конец блока ---";

export interface AugmentResult {
  /** User text plus the injected context blocks. The original text is what gets persisted. */
  augmentedText: string;
  links: FetchedLink[];
  searchQueries: string[];
  searchResultCount: number;
  searchSkippedUnconfigured: boolean;
  truncated: boolean;
}

export interface AugmentOptions {
  text: string;
  history: Array<{ role: string; content: string }>;
  onStatus?: (status: AugmentStatus) => void | Promise<void>;
  maxContextLength?: number;
  enableLinks?: boolean;
  /** Defaults to "context" (our Tavily path); see webSearchStrategy.ts. */
  searchStrategy?: WebSearchStrategy;
}

export function isWebSearchConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

// `\b` is ASCII-only in JS, so it never matches before a Cyrillic letter — use an
// explicit "not preceded by a letter/digit" lookbehind instead.
const WORD_START = "(?<![\\p{L}\\p{N}])";

const SEARCH_INTENT_PATTERNS: readonly RegExp[] = [
  new RegExp(`${WORD_START}(найди|найти|поищи|поиск|погугли|загугли|search|google)`, "iu"),
  new RegExp(`${WORD_START}(новост|актуальн|свеж|последн|сейчас|сегодня|вчера)`, "iu"),
  new RegExp(`${WORD_START}(курс|цена|цены|цену|стоимость|прогноз|погода|latest|current|news|today|price)`, "iu"),
];

/** Cheap pre-check used only to decide whether it is worth telling the user that
 *  search is unconfigured — the real decision is the classifier LLM call. */
export function looksLikeSearchIntent(text: string): boolean {
  return SEARCH_INTENT_PATTERNS.some((re) => re.test(text));
}

/** Assembles the final prompt text, trimming each injected block to half the budget
 *  so one huge block can't crowd out the other (or the dialog history). */
export function composeAugmentedText(
  text: string,
  linksContext: string,
  searchContext: string,
  maxLen: number = NEURO_MAX_AUGMENTED_CONTEXT
): { text: string; truncated: boolean } {
  let links = linksContext;
  let search = searchContext;
  let truncated = false;

  if (links.length + search.length > maxLen) {
    const halfLimit = Math.floor(maxLen / 2);
    if (links.length > halfLimit) {
      links = links.slice(0, halfLimit) + "\n[...содержимое ссылок обрезано]";
      truncated = true;
    }
    if (search.length > halfLimit) {
      search = search.slice(0, halfLimit) + "\n[...результаты поиска обрезаны]";
      truncated = true;
    }
  }

  const parts = [text];
  if (links) parts.push(links);
  if (search) parts.push(search);
  return { text: parts.join("\n\n"), truncated };
}

export async function augmentUserMessage(opts: AugmentOptions): Promise<AugmentResult> {
  const {
    text,
    history,
    onStatus,
    maxContextLength = NEURO_MAX_AUGMENTED_CONTEXT,
    enableLinks = true,
    searchStrategy = "context",
  } = opts;

  const runSearch = searchStrategy === "context" && isWebSearchConfigured();
  const urls = enableLinks ? extractUrls(text) : [];

  const notify = async (kind: AugmentStatusKind): Promise<void> => {
    if (!onStatus) return;
    try {
      await onStatus({ kind, label: AUGMENT_STATUS_LABELS[kind] });
    } catch (err) {
      // A status update is cosmetic — never let it fail the request.
      log.warn("Status callback failed:", err);
    }
  };

  if (urls.length > 0) await notify("reading_links");

  // Link fetching and search classification are independent — run them together.
  const [links, classification] = await Promise.all([
    urls.length > 0 ? fetchLinksContent(urls) : Promise.resolve<FetchedLink[]>([]),
    runSearch
      ? classifySearchNeed(text, history)
      : Promise.resolve({ needsSearch: false, queries: [], reason: "disabled" }),
  ]);

  let searchQueries: string[] = [];
  let searchContext = "";
  let searchResultCount = 0;
  let searchSkippedUnconfigured = false;

  if (searchStrategy === "off") {
    // Tell the model the truth instead of letting it claim it has no internet at all.
    searchContext = SEARCH_UNAVAILABLE_BLOCK;
    searchSkippedUnconfigured = true;
    if (looksLikeSearchIntent(text)) await notify("search_unconfigured");
  } else if (classification.needsSearch && classification.queries.length > 0) {
    await notify("searching");
    const searchResult = await executeWebSearch(classification.queries);
    searchQueries = searchResult.queries;
    searchResultCount = searchResult.results.length;
    searchContext = formatSearchResultsForContext(searchResult.results);
  }

  const linksContext = formatLinksForContext(links);
  const composed = composeAugmentedText(text, linksContext, searchContext, maxContextLength);

  return {
    augmentedText: composed.text,
    links,
    searchQueries,
    searchResultCount,
    searchSkippedUnconfigured,
    truncated: composed.truncated,
  };
}
