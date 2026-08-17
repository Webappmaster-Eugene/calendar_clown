import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  composeAugmentedText,
  isWebSearchConfigured,
  looksLikeSearchIntent,
  AUGMENT_STATUS_LABELS,
} from "../src/chat/augment.js";

/**
 * Pure parts of the shared augmentation layer (the "assistant has internet" path):
 * block assembly + truncation budget, the search-intent heuristic that decides when
 * to warn about an unconfigured search backend, and the config probe. No network, no DB.
 */

const LINKS = "--- Содержимое ссылок ---\nсодержимое\n--- Конец содержимого ссылок ---";
const SEARCH = "--- Результаты веб-поиска ---\nрезультат\n--- Конец результатов поиска ---";

describe("composeAugmentedText", () => {
  it("keeps the user text first, then links, then search", () => {
    const { text, truncated } = composeAugmentedText("вопрос", LINKS, SEARCH);
    assert.equal(truncated, false);
    assert.ok(text.startsWith("вопрос"));
    assert.ok(text.indexOf(LINKS) < text.indexOf(SEARCH));
  });

  it("omits empty blocks entirely", () => {
    assert.equal(composeAugmentedText("вопрос", "", "").text, "вопрос");
    assert.equal(composeAugmentedText("вопрос", LINKS, "").text, `вопрос\n\n${LINKS}`);
    assert.equal(composeAugmentedText("вопрос", "", SEARCH).text, `вопрос\n\n${SEARCH}`);
  });

  it("passes through when the blocks fit the budget", () => {
    const links = "l".repeat(400);
    const search = "s".repeat(400);
    const { text, truncated } = composeAugmentedText("q", links, search, 1000);
    assert.equal(truncated, false);
    assert.ok(text.includes(links) && text.includes(search));
  });

  it("trims each oversized block to half the budget and marks truncation", () => {
    const links = "l".repeat(5_000);
    const search = "s".repeat(5_000);
    const { text, truncated } = composeAugmentedText("q", links, search, 1_000);

    assert.equal(truncated, true);
    assert.match(text, /\[\.\.\.содержимое ссылок обрезано\]/);
    assert.match(text, /\[\.\.\.результаты поиска обрезаны\]/);
    // "q" + separators + two halves + two markers — well under the raw 10k input.
    assert.ok(text.length < 1_500, `unexpected length ${text.length}`);
  });

  it("leaves a small block alone when only the other one is oversized", () => {
    const links = "l".repeat(50);
    const search = "s".repeat(5_000);
    const { text, truncated } = composeAugmentedText("q", links, search, 1_000);

    assert.equal(truncated, true);
    assert.ok(text.includes(links), "the small block must survive intact");
    assert.doesNotMatch(text, /содержимое ссылок обрезано/);
    assert.match(text, /результаты поиска обрезаны/);
  });
});

describe("isWebSearchConfigured", () => {
  it("requires a non-blank TAVILY_API_KEY", () => {
    const original = process.env.TAVILY_API_KEY;
    try {
      delete process.env.TAVILY_API_KEY;
      assert.equal(isWebSearchConfigured(), false);
      process.env.TAVILY_API_KEY = "";
      assert.equal(isWebSearchConfigured(), false);
      process.env.TAVILY_API_KEY = "   ";
      assert.equal(isWebSearchConfigured(), false);
      process.env.TAVILY_API_KEY = "tvly-abc";
      assert.equal(isWebSearchConfigured(), true);
    } finally {
      if (original === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = original;
    }
  });
});

describe("looksLikeSearchIntent", () => {
  it("detects explicit search and fresh-data phrasing", () => {
    for (const text of [
      "Найди отзывы про этот ноутбук",
      "погугли цену",
      "какие новости сегодня",
      "актуальный курс доллара",
      "what is the latest price",
    ]) {
      assert.equal(looksLikeSearchIntent(text), true, text);
    }
  });

  it("stays quiet for offline-answerable requests", () => {
    for (const text of [
      "Напиши функцию сортировки на Python",
      "Переведи этот абзац на английский",
      "спасибо",
    ]) {
      assert.equal(looksLikeSearchIntent(text), false, text);
    }
  });
});

describe("AUGMENT_STATUS_LABELS", () => {
  it("has a short, distinct label for every status kind", () => {
    const labels = Object.values(AUGMENT_STATUS_LABELS);
    assert.equal(labels.length, 3);
    assert.equal(new Set(labels).size, labels.length, "labels must be distinct");
    for (const label of labels) {
      assert.ok(label.length > 0 && label.length <= 64, label);
    }
  });
});
