// Two ways to give the chat web access, picked per dialog model:
//
//  "native"  — OpenRouter's `web` plugin on the provider's own search. The model
//              decides mid-generation and can run several queries, which beats a
//              single pre-fetch; only OpenAI/Anthropic/Google/Perplexity/xAI models
//              have it, and it bills through the provider.
//  "context" — our Tavily path: a cheap classifier decides, results are injected as
//              text blocks. Works with any model and costs nothing when no search is
//              needed (the classifier is skipped for models with native search).
//  "off"     — no search backend available; the model must say so instead of guessing.

export type WebSearchStrategy = "native" | "context" | "off";

/** NEURO_WEB_SEARCH: auto (default) | tavily | openrouter | off. */
export type WebSearchMode = "auto" | "tavily" | "openrouter" | "off";

const MODES: ReadonlySet<string> = new Set<WebSearchMode>(["auto", "tavily", "openrouter", "off"]);

/** Vendors whose models carry provider-side search, per OpenRouter's web plugin. */
export const NATIVE_SEARCH_VENDORS: ReadonlySet<string> = new Set([
  "openai",
  "anthropic",
  "google",
  "perplexity",
  "x-ai",
]);

export function resolveWebSearchMode(raw: string | undefined = process.env.NEURO_WEB_SEARCH): WebSearchMode {
  const value = raw?.trim().toLowerCase();
  return value && MODES.has(value) ? (value as WebSearchMode) : "auto";
}

export function supportsNativeWebSearch(model: string): boolean {
  if (!model.includes("/")) return false;
  // OpenRouter prefixes floating "latest" aliases with "~".
  const vendor = model.split("/")[0].replace(/^~/, "").toLowerCase();
  return NATIVE_SEARCH_VENDORS.has(vendor);
}

export function resolveWebSearchStrategy(
  model: string,
  opts: { tavilyConfigured: boolean; mode?: WebSearchMode }
): WebSearchStrategy {
  const mode = opts.mode ?? resolveWebSearchMode();

  switch (mode) {
    case "off":
      return "off";
    case "tavily":
      return opts.tavilyConfigured ? "context" : "off";
    case "openrouter":
      // Explicitly requested: let OpenRouter pick the engine (Exa for models without
      // provider search) rather than falling back to Tavily.
      return "native";
    case "auto":
      if (supportsNativeWebSearch(model)) return "native";
      return opts.tavilyConfigured ? "context" : "off";
  }
}
