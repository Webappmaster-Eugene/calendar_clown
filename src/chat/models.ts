import { OPENROUTER_URL, OPENROUTER_REFERER } from "../constants.js";
import { openRouterRequest } from "../utils/proxyAgent.js";
import { createLogger } from "../utils/logger.js";
import type { OpenRouterModelDto } from "../shared/types.js";

const log = createLogger("chat-models");

const MODELS_URL = OPENROUTER_URL.replace(/\/chat\/completions$/, "/models");
const CACHE_TTL_MS = 60 * 60 * 1000; // models change rarely; refresh hourly

interface RawModel {
  id: string;
  name?: string;
  context_length?: number | null;
  pricing?: { prompt?: string; completion?: string };
}

let cache: { at: number; models: OpenRouterModelDto[] } | null = null;

function toNum(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapModel(m: RawModel): OpenRouterModelDto {
  const promptPrice = toNum(m.pricing?.prompt);
  const completionPrice = toNum(m.pricing?.completion);
  const isFree = m.id.endsWith(":free") || (promptPrice === 0 && completionPrice === 0);
  return {
    id: m.id,
    name: m.name || m.id,
    contextLength: m.context_length ?? null,
    promptPrice,
    completionPrice,
    isFree,
  };
}

/** Full OpenRouter catalog (cached). Goes through the OpenRouter proxy, so it works
 *  from the geo-blocked prod host just like the completion calls. */
export async function listOpenRouterModels(): Promise<OpenRouterModelDto[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models;

  const apiKey = process.env.OPENROUTER_API_KEY;
  const res = await openRouterRequest(MODELS_URL, {
    method: "GET",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "HTTP-Referer": OPENROUTER_REFERER,
    },
    timeoutMs: 20_000,
  });
  if (!res.ok) {
    // Serve a stale cache rather than failing the picker on a transient hiccup.
    if (cache) return cache.models;
    throw new Error(`OpenRouter models request failed: ${res.status}`);
  }
  const body = (await res.json()) as { data?: RawModel[] };
  const models = (body.data ?? [])
    .filter((m) => m && typeof m.id === "string")
    .map(mapModel)
    .sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), models };
  log.info(`Loaded ${models.length} OpenRouter models`);
  return models;
}

/** Search the catalog by id/name substring (case-insensitive). Empty query → the
 *  full list (capped). Ranks id/name prefix matches first, then free models. */
export async function searchModels(query: string, limit = 50): Promise<OpenRouterModelDto[]> {
  const all = await listOpenRouterModels();
  const q = query.trim().toLowerCase();
  let matched = all;
  if (q) {
    matched = all.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
    matched.sort((a, b) => {
      const ap = a.id.toLowerCase().startsWith(q) || a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.id.toLowerCase().startsWith(q) || b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
  }
  return matched.slice(0, limit);
}
