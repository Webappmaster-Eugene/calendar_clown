import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapModel, filterAndRankModels, vendorsOf } from "../src/chat/models.js";

/**
 * Unit tests for the OpenRouter model-catalog logic powering the per-dialog model
 * picker: mapModel (vendor/isFree/price/context), filterAndRankModels (free-only +
 * vendor + query filters, prefix ranking, cap), and vendorsOf. Pure, no network.
 */

describe("mapModel", () => {
  it("derives vendor from the id prefix", () => {
    assert.equal(mapModel({ id: "anthropic/claude-sonnet-4" }).vendor, "anthropic");
    assert.equal(mapModel({ id: "openai/gpt-4o-mini" }).vendor, "openai");
  });

  it("strips the '~' prefix on floating 'latest' aliases", () => {
    assert.equal(mapModel({ id: "~anthropic/claude-sonnet-latest" }).vendor, "anthropic");
  });

  it("marks ':free' ids and zero-priced models as free", () => {
    assert.equal(mapModel({ id: "google/gemma:free" }).isFree, true);
    assert.equal(mapModel({ id: "x/y", pricing: { prompt: "0", completion: "0" } }).isFree, true);
    assert.equal(mapModel({ id: "a/b", pricing: { prompt: "0.000003", completion: "0.000015" } }).isFree, false);
  });

  it("parses pricing + context and falls back name→id, vendor→other", () => {
    const m = mapModel({ id: "anthropic/claude", name: "Claude", context_length: 200000, pricing: { prompt: "0.000003", completion: "0.000015" } });
    assert.equal(m.promptPrice, 0.000003);
    assert.equal(m.completionPrice, 0.000015);
    assert.equal(m.contextLength, 200000);
    assert.equal(m.name, "Claude");
    assert.equal(mapModel({ id: "noslashid" }).vendor, "other");
    assert.equal(mapModel({ id: "x/y" }).name, "x/y"); // name defaults to id
  });
});

const CATALOG = [
  mapModel({ id: "openai/gpt-4o-mini", name: "GPT-4o mini", pricing: { prompt: "0.0000001", completion: "0.0000004" } }),
  mapModel({ id: "openai/gpt-5", name: "GPT-5", pricing: { prompt: "0.00001", completion: "0.00003" } }),
  mapModel({ id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", pricing: { prompt: "0.000003", completion: "0.000015" } }),
  mapModel({ id: "google/gemma:free", name: "Gemma (free)" }),
  mapModel({ id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", pricing: { prompt: "0.0000003", completion: "0.0000012" } }),
];

describe("filterAndRankModels", () => {
  it("free filter keeps only free models", () => {
    const r = filterAndRankModels(CATALOG, "", { free: true });
    assert.ok(r.length > 0 && r.every((m) => m.isFree));
  });

  it("vendor filter keeps only that vendor", () => {
    const r = filterAndRankModels(CATALOG, "", { vendor: "openai" });
    assert.equal(r.length, 2);
    assert.ok(r.every((m) => m.vendor === "openai"));
  });

  it("query matches id or name (case-insensitive)", () => {
    assert.equal(filterAndRankModels(CATALOG, "GEMINI", {}).length, 1);
    assert.equal(filterAndRankModels(CATALOG, "gpt", {}).length, 2);
  });

  it("ranks id/name prefix matches first", () => {
    const r = filterAndRankModels(CATALOG, "gpt", {});
    assert.ok(r[0].id.startsWith("openai/gpt"));
  });

  it("combines free + vendor filters", () => {
    assert.equal(filterAndRankModels(CATALOG, "", { free: true, vendor: "openai" }).length, 0);
    assert.equal(filterAndRankModels(CATALOG, "", { free: true, vendor: "google" }).length, 1);
  });

  it("respects the limit cap", () => {
    assert.equal(filterAndRankModels(CATALOG, "", { limit: 2 }).length, 2);
  });
});

describe("vendorsOf", () => {
  it("returns distinct vendors, sorted", () => {
    assert.deepEqual(vendorsOf(CATALOG), ["anthropic", "google", "openai"]);
  });
});
