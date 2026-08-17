import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapModel } from "../src/chat/models.js";
import {
  buildPickerResults,
  buildPageData,
  buildSelectData,
  buildVendorData,
  buildVendorPageData,
  clampPage,
  formatModelLabel,
  normalizeSearchQuery,
  pageCount,
  pageSlice,
  parseSettingsCallback,
  validateDialogTitle,
  validateModelId,
  validateSystemPrompt,
  MODEL_PICKER_MAX,
  MODEL_PICKER_PAGE_SIZE,
  SYSTEM_PROMPT_MAX,
  DIALOG_TITLE_MAX,
} from "../src/chat/modelPicker.js";

/**
 * Unit tests for the bot's in-chat model picker: paging math, filtering, the
 * callback-data grammar (Telegram caps callback_data at 64 bytes, which is why the
 * grammar carries indices instead of model ids) and the text-step validators.
 */

const CATALOG = [
  mapModel({ id: "openai/gpt-4o-mini", name: "GPT-4o mini", pricing: { prompt: "0.0000001", completion: "0.0000004" } }),
  mapModel({ id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", pricing: { prompt: "0.000003", completion: "0.000015" } }),
  mapModel({ id: "google/gemma-3-27b:free", name: "Gemma 3 27B" }),
  mapModel({ id: "deepseek/deepseek-chat-v3.1", name: "DeepSeek V3.1", pricing: { prompt: "0.0000002", completion: "0.0000008" } }),
];

describe("pageCount / clampPage / pageSlice", () => {
  it("always reports at least one page, even for an empty list", () => {
    assert.equal(pageCount(0), 1);
    assert.equal(clampPage(0, 0), 0);
    assert.equal(clampPage(5, 0), 0);
    assert.deepEqual(pageSlice([], 3), { items: [], startIndex: 0 });
  });

  it("handles exact multiples and a partial last page", () => {
    assert.equal(pageCount(16), 2);
    assert.equal(pageCount(17), 3);
    assert.equal(pageCount(5, 2), 3);
  });

  it("clamps out-of-range pages in both directions", () => {
    assert.equal(clampPage(-4, 30), 0);
    assert.equal(clampPage(99, 30), pageCount(30) - 1);
    assert.equal(clampPage(Number.NaN, 30), 0);
    assert.equal(clampPage(1.7, 30), 1);
  });

  it("returns an absolute startIndex that round-trips to the source item", () => {
    const items = Array.from({ length: 30 }, (_, i) => `m${i}`);
    const { items: page, startIndex } = pageSlice(items, 2);
    assert.equal(startIndex, 2 * MODEL_PICKER_PAGE_SIZE);
    page.forEach((item, i) => assert.equal(items[startIndex + i], item));
  });
});

describe("buildPickerResults", () => {
  it("applies filters before the cap so nothing is hidden by it", () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      mapModel({ id: `vendor${i % 5}/model-${i}`, name: `Model ${i}`, pricing: { prompt: "0.001", completion: "0.001" } })
    );
    const all = buildPickerResults(many, { query: "", free: false });
    assert.equal(all.length, MODEL_PICKER_MAX);

    const oneVendor = buildPickerResults(many, { query: "", free: false, vendor: "vendor3" });
    assert.equal(oneVendor.length, 100, "filtered set is smaller than the cap");
    assert.ok(oneVendor.every((m) => m.vendor === "vendor3"));
  });

  it("combines free-only, vendor and query filters", () => {
    assert.deepEqual(
      buildPickerResults(CATALOG, { query: "", free: true }).map((m) => m.id),
      ["google/gemma-3-27b:free"]
    );
    assert.deepEqual(
      buildPickerResults(CATALOG, { query: "claude", free: false }).map((m) => m.id),
      ["anthropic/claude-sonnet-4"]
    );
    assert.deepEqual(
      buildPickerResults(CATALOG, { query: "", free: false, vendor: "openai" }).map((m) => m.id),
      ["openai/gpt-4o-mini"]
    );
  });
});

describe("formatModelLabel", () => {
  it("marks the current model and free/paid, truncating long names", () => {
    assert.match(formatModelLabel(CATALOG[1], true), /^✅ 💎 Claude Sonnet 4$/);
    assert.match(formatModelLabel(CATALOG[2], false), /^🆓 Gemma 3 27B$/);

    const long = mapModel({ id: "x/y", name: "N".repeat(120) });
    const label = formatModelLabel(long, false);
    assert.ok(label.length <= 2 + 60 + 2, `label too long: ${label.length}`);
    assert.match(label, /…$/);
  });
});

describe("callback_data budget", () => {
  it("keeps every generated payload within Telegram's 64-byte cap", () => {
    // Worst case: a full catalog of long ids, walked page by page.
    const many = Array.from({ length: 300 }, (_, i) =>
      mapModel({
        id: `cognitivecomputations/dolphin-mistral-24b-venice-${String(i).padStart(3, "0")}:free`,
        name: `Dolphin Mistral 24B Venice Edition ${i}`,
      })
    );
    const results = buildPickerResults(many, { query: "", free: false });

    const payloads: string[] = [];
    for (let page = 0; page < pageCount(results.length); page++) {
      payloads.push(buildPageData(page), buildVendorPageData(page));
      const { startIndex, items } = pageSlice(results, page);
      items.forEach((_, i) => payloads.push(buildSelectData(startIndex + i)));
    }
    payloads.push(buildVendorData(-1), buildVendorData(299));

    for (const data of payloads) {
      assert.ok(Buffer.byteLength(data, "utf8") <= 64, `${data} is ${Buffer.byteLength(data, "utf8")} bytes`);
      assert.ok(parseSettingsCallback(data), `${data} must parse back`);
    }
  });
});

describe("parseSettingsCallback", () => {
  it("round-trips every verb", () => {
    assert.deepEqual(parseSettingsCallback("ncfg:open"), { kind: "open" });
    assert.deepEqual(parseSettingsCallback("ncfg:close"), { kind: "close" });
    assert.deepEqual(parseSettingsCallback("ncfg:mdl"), { kind: "models" });
    assert.deepEqual(parseSettingsCallback("ncfg:mfree"), { kind: "toggleFree" });
    assert.deepEqual(parseSettingsCallback("ncfg:mven"), { kind: "vendors" });
    assert.deepEqual(parseSettingsCallback("ncfg:msrch"), { kind: "search" });
    assert.deepEqual(parseSettingsCallback("ncfg:mid"), { kind: "manualId" });
    assert.deepEqual(parseSettingsCallback("ncfg:mclr"), { kind: "clearFilters" });
    assert.deepEqual(parseSettingsCallback("ncfg:mdef"), { kind: "useDefault" });
    assert.deepEqual(parseSettingsCallback("ncfg:prm"), { kind: "prompt" });
    assert.deepEqual(parseSettingsCallback("ncfg:prmset"), { kind: "promptSet" });
    assert.deepEqual(parseSettingsCallback("ncfg:prmdel"), { kind: "promptClear" });
    assert.deepEqual(parseSettingsCallback("ncfg:ren"), { kind: "rename" });
    assert.deepEqual(parseSettingsCallback("ncfg:rst"), { kind: "reset" });
    assert.deepEqual(parseSettingsCallback("ncfg:rstyes"), { kind: "resetConfirm" });
    assert.deepEqual(parseSettingsCallback("ncfg:cancel"), { kind: "cancelInput" });
    assert.deepEqual(parseSettingsCallback("ncfg:mp:3"), { kind: "page", page: 3 });
    assert.deepEqual(parseSettingsCallback("ncfg:ms:17"), { kind: "select", index: 17 });
    assert.deepEqual(parseSettingsCallback("ncfg:mvp:2"), { kind: "vendorPage", page: 2 });
    assert.deepEqual(parseSettingsCallback("ncfg:mv:4"), { kind: "vendor", index: 4 });
  });

  it("treats mv:-1 as 'all vendors' but rejects negative pages/indices", () => {
    assert.deepEqual(parseSettingsCallback("ncfg:mv:-1"), { kind: "vendor", index: -1 });
    assert.equal(parseSettingsCallback("ncfg:mp:-1"), null);
    assert.equal(parseSettingsCallback("ncfg:ms:-2"), null);
  });

  it("rejects malformed and foreign payloads", () => {
    for (const data of ["", "ncfg:", "ncfg:ms:abc", "ncfg:ms:", "ncfg:zzz", "ncfgx:open", "neuro_dlg:1", "ncfg:ms:1:2"]) {
      assert.equal(parseSettingsCallback(data), null, data);
    }
  });
});

describe("input validators", () => {
  it("normalizes the search query and treats a dash as 'clear'", () => {
    assert.equal(normalizeSearchQuery("  Claude  "), "Claude");
    assert.equal(normalizeSearchQuery("-"), "");
    assert.equal(normalizeSearchQuery("—"), "");
    assert.equal(normalizeSearchQuery("x".repeat(200)).length, 60);
  });

  it("accepts real OpenRouter ids and rejects junk", () => {
    assert.equal(validateModelId("anthropic/claude-sonnet-4"), "anthropic/claude-sonnet-4");
    assert.equal(validateModelId("cognitivecomputations/dolphin-mistral-24b-venice-edition:free"), "cognitivecomputations/dolphin-mistral-24b-venice-edition:free");
    assert.equal(validateModelId("~openai/gpt-latest"), "~openai/gpt-latest");
    assert.equal(validateModelId(" google/gemini-2.5-flash "), "google/gemini-2.5-flash");

    assert.equal(validateModelId("noslash"), null);
    assert.equal(validateModelId("with space/model"), null);
    assert.equal(validateModelId(""), null);
    assert.equal(validateModelId(`a/${"b".repeat(200)}`), null);
  });

  it("clears the prompt on empty/dash and rejects overlong ones", () => {
    assert.deepEqual(validateSystemPrompt("  "), { ok: true, value: null });
    assert.deepEqual(validateSystemPrompt("-"), { ok: true, value: null });
    assert.deepEqual(validateSystemPrompt(" Ты юрист "), { ok: true, value: "Ты юрист" });

    const tooLong = validateSystemPrompt("x".repeat(SYSTEM_PROMPT_MAX + 1));
    assert.equal(tooLong.ok, false);
  });

  it("requires a 1..100 character title", () => {
    assert.deepEqual(validateDialogTitle(" Мой диалог "), { ok: true, value: "Мой диалог" });
    assert.equal(validateDialogTitle("   ").ok, false);
    assert.equal(validateDialogTitle("t".repeat(DIALOG_TITLE_MAX + 1)).ok, false);
    assert.equal(validateDialogTitle("t".repeat(DIALOG_TITLE_MAX)).ok, true);
  });
});
