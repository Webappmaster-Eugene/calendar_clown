import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveWebSearchMode,
  resolveWebSearchStrategy,
  supportsNativeWebSearch,
} from "../src/chat/webSearchStrategy.js";

/**
 * Which web-search backend a dialog gets: OpenRouter's provider-side search for
 * models that have it (no classifier call, no Tavily request), our Tavily path for
 * everything else, and "off" when neither is available — so the model is told to say
 * it answers from memory instead of guessing.
 */

describe("supportsNativeWebSearch", () => {
  it("recognizes the vendors with provider-side search", () => {
    for (const model of [
      "anthropic/claude-sonnet-4",
      "openai/gpt-4o-mini",
      "google/gemini-2.5-flash",
      "perplexity/sonar",
      "x-ai/grok-4",
    ]) {
      assert.equal(supportsNativeWebSearch(model), true, model);
    }
  });

  it("handles the '~latest' alias prefix and letter case", () => {
    assert.equal(supportsNativeWebSearch("~anthropic/claude-opus-latest"), true);
    assert.equal(supportsNativeWebSearch("Anthropic/Claude-Opus"), true);
  });

  it("returns false for other vendors and malformed ids", () => {
    for (const model of [
      "deepseek/deepseek-chat-v3.1",
      "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
      "meta-llama/llama-3.3-70b-instruct",
      "noslash",
      "",
    ]) {
      assert.equal(supportsNativeWebSearch(model), false, model);
    }
  });
});

describe("resolveWebSearchMode", () => {
  it("accepts the four known modes and falls back to auto", () => {
    assert.equal(resolveWebSearchMode("auto"), "auto");
    assert.equal(resolveWebSearchMode(" Tavily "), "tavily");
    assert.equal(resolveWebSearchMode("OPENROUTER"), "openrouter");
    assert.equal(resolveWebSearchMode("off"), "off");

    assert.equal(resolveWebSearchMode(undefined), "auto");
    assert.equal(resolveWebSearchMode(""), "auto");
    assert.equal(resolveWebSearchMode("nonsense"), "auto");
  });
});

describe("resolveWebSearchStrategy", () => {
  const native = "anthropic/claude-sonnet-4";
  const plain = "deepseek/deepseek-chat-v3.1";

  it("auto: native search wins for vendors that have it", () => {
    assert.equal(resolveWebSearchStrategy(native, { tavilyConfigured: true, mode: "auto" }), "native");
    assert.equal(resolveWebSearchStrategy(native, { tavilyConfigured: false, mode: "auto" }), "native");
  });

  it("auto: other models use Tavily, or nothing without a key", () => {
    assert.equal(resolveWebSearchStrategy(plain, { tavilyConfigured: true, mode: "auto" }), "context");
    assert.equal(resolveWebSearchStrategy(plain, { tavilyConfigured: false, mode: "auto" }), "off");
  });

  it("tavily: never uses the plugin, even for native-capable models", () => {
    assert.equal(resolveWebSearchStrategy(native, { tavilyConfigured: true, mode: "tavily" }), "context");
    assert.equal(resolveWebSearchStrategy(native, { tavilyConfigured: false, mode: "tavily" }), "off");
  });

  it("openrouter: always the plugin, key or not", () => {
    assert.equal(resolveWebSearchStrategy(plain, { tavilyConfigured: false, mode: "openrouter" }), "native");
    assert.equal(resolveWebSearchStrategy(native, { tavilyConfigured: true, mode: "openrouter" }), "native");
  });

  it("off: disables search everywhere", () => {
    assert.equal(resolveWebSearchStrategy(native, { tavilyConfigured: true, mode: "off" }), "off");
    assert.equal(resolveWebSearchStrategy(plain, { tavilyConfigured: true, mode: "off" }), "off");
  });

  it("reads the mode from the environment when it is not passed", () => {
    const original = process.env.NEURO_WEB_SEARCH;
    try {
      process.env.NEURO_WEB_SEARCH = "off";
      assert.equal(resolveWebSearchStrategy(native, { tavilyConfigured: true }), "off");
      process.env.NEURO_WEB_SEARCH = "tavily";
      assert.equal(resolveWebSearchStrategy(native, { tavilyConfigured: true }), "context");
      delete process.env.NEURO_WEB_SEARCH;
      assert.equal(resolveWebSearchStrategy(native, { tavilyConfigured: true }), "native");
    } finally {
      if (original === undefined) delete process.env.NEURO_WEB_SEARCH;
      else process.env.NEURO_WEB_SEARCH = original;
    }
  });
});
