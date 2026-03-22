import { DEEPSEEK_MODEL, NEURO_MAX_SEARCH_RESULTS } from "../constants.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import { tavilySearchMulti } from "../osint/searchClient.js";
import type { TavilyResult } from "../osint/types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("neuro-search");

/** Max content length per search result. */
const MAX_CONTENT_PER_RESULT = 500;

export interface SearchClassification {
  needsSearch: boolean;
  queries: string[];
  reason: string;
}

export interface WebSearchResult {
  results: TavilyResult[];
  queries: string[];
}

/** Classify whether a user message needs web search. */
export async function classifySearchNeed(
  userMessage: string,
  recentHistory: Array<{ role: string; content: string }>
): Promise<SearchClassification> {
  // If no Tavily API key, skip classification
  if (!process.env.TAVILY_API_KEY) {
    return { needsSearch: false, queries: [], reason: "no_api_key" };
  }

  const historyContext = recentHistory.length > 0
    ? `\nПоследние сообщения диалога:\n${recentHistory.slice(-4).map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join("\n")}`
    : "";

  const prompt = `Определи, нужен ли веб-поиск для ответа на сообщение пользователя.

Поиск НУЖЕН если: текущие события/новости, фактическая информация которую ты можешь не знать, цены/курсы/погода, конкретные люди/компании/продукты, "что такое X", "когда произошло Z", актуальные данные.

Поиск НЕ НУЖЕН если: программирование, математика, творчество, перевод, анализ предоставленного текста/файла, продолжение разговора без новых фактов, общие знания, философские вопросы.
${historyContext}

Сообщение пользователя: ${userMessage}

Верни строго JSON без markdown-обёрток: {"needsSearch": bool, "queries": ["запрос1", "запрос2"], "reason": "краткая причина"}
Запросы должны быть на языке, наиболее подходящем для поиска (обычно русский или английский). Максимум 3 запроса.`;

  try {
    const result = await callOpenRouter({
      model: DEEPSEEK_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 300,
    });

    if (!result) {
      return { needsSearch: false, queries: [], reason: "empty_response" };
    }

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn("Search classification: no JSON found in response:", result);
      return { needsSearch: false, queries: [], reason: "parse_error" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as SearchClassification;
    return {
      needsSearch: Boolean(parsed.needsSearch),
      queries: Array.isArray(parsed.queries) ? parsed.queries.slice(0, 3) : [],
      reason: String(parsed.reason || ""),
    };
  } catch (err) {
    log.error("Search classification error:", err);
    return { needsSearch: false, queries: [], reason: "error" };
  }
}

/** Execute web search using Tavily. */
export async function executeWebSearch(queries: string[]): Promise<WebSearchResult> {
  if (queries.length === 0) {
    return { results: [], queries };
  }

  try {
    const maxPerQuery = Math.ceil(NEURO_MAX_SEARCH_RESULTS / queries.length);
    const searchResult = await tavilySearchMulti(queries, maxPerQuery);
    return {
      results: searchResult.results.slice(0, NEURO_MAX_SEARCH_RESULTS),
      queries,
    };
  } catch (err) {
    log.error("Web search error:", err);
    return { results: [], queries };
  }
}

/** Format search results as context string for AI prompt. */
export function formatSearchResultsForContext(results: TavilyResult[]): string {
  if (results.length === 0) return "";

  const parts = results.map((r, i) => {
    const content = r.content.length > MAX_CONTENT_PER_RESULT
      ? r.content.slice(0, MAX_CONTENT_PER_RESULT) + "..."
      : r.content;
    return `[${i + 1}] ${r.title} (${r.url})\n${content}`;
  });

  return `--- Результаты веб-поиска ---\n${parts.join("\n---\n")}\n--- Конец результатов поиска ---`;
}
