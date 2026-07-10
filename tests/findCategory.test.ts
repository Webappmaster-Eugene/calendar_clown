/**
 * Unit tests for the expense category matcher `findCategory`.
 * Pure fuzzy-matching logic — the category list is passed in, no DB is touched
 * (the module's `getCategories` import is unused by this function).
 *
 * Scoring recap (see src/expenses/parser.ts):
 *   - exact equality with an alias scores highest (alias.length*10 + 100)
 *   - prefix / first-word / Levenshtein matches score lower
 *   - a score >= 40 is treated as "confident" by callers
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findCategory } from "../src/expenses/parser.js";
import type { Category } from "../src/expenses/types.js";

function cat(
  id: number,
  name: string,
  emoji: string,
  aliases: string[],
): Category {
  return {
    id,
    name,
    emoji,
    aliases,
    description: null,
    sortOrder: id,
    isActive: true,
    createdByUserId: null,
  };
}

const CATEGORIES: Category[] = [
  cat(1, "Продукты", "🛒", ["еда", "магазин", "пятёрочка"]),
  cat(2, "Транспорт", "🚕", ["такси", "метро", "бензин"]),
  cat(3, "Кафе", "☕", ["ресторан", "обед", "кофе"]),
  cat(4, "Другое", "📦", []),
];

describe("findCategory", () => {
  it("returns null when the category list is empty", () => {
    assert.equal(findCategory("такси", []), null);
  });

  it("matches an exact alias with the highest score", () => {
    const m = findCategory("такси", CATEGORIES);
    assert.ok(m);
    assert.equal(m.category.name, "Транспорт");
    assert.equal(m.matchedText, "такси");
    // Exact match: length*10 + 100 == 5*10 + 100 == 150.
    assert.equal(m.score, 150);
  });

  it("is case-insensitive", () => {
    const m = findCategory("ТАКСИ", CATEGORIES);
    assert.ok(m);
    assert.equal(m.category.name, "Транспорт");
  });

  it("matches the category name itself, not just aliases", () => {
    const m = findCategory("продукты", CATEGORIES);
    assert.ok(m);
    assert.equal(m.category.name, "Продукты");
  });

  it("prefers the alias-prefixed category when text has trailing words", () => {
    const m = findCategory("такси до аэропорта", CATEGORIES);
    assert.ok(m);
    assert.equal(m.category.name, "Транспорт");
    assert.equal(m.matchedText, "такси");
    // Prefix "такси " path: confident (>= 40).
    assert.ok(m.score >= 40);
  });

  it("tolerates a small typo via Levenshtein for short aliases", () => {
    // "ресторам" is one substitution away from the alias "ресторан".
    const m = findCategory("ресторам", CATEGORIES);
    assert.ok(m);
    assert.equal(m.category.name, "Кафе");
  });

  it("returns a low-confidence match rather than null for unrelated text", () => {
    // "к" is a shared first letter; the matcher still yields *some* best
    // match, but callers gate on score >= 40, so it stays a weak signal.
    const m = findCategory("зупзупзуп", CATEGORIES);
    // Either null or a sub-threshold score — never a confident match.
    if (m) {
      assert.ok(m.score < 40, `unexpected confident match: score ${m.score}`);
    }
  });

  it("matches a Cyrillic-ё alias exactly", () => {
    const m = findCategory("пятёрочка", CATEGORIES);
    assert.ok(m);
    assert.equal(m.category.name, "Продукты");
    assert.equal(m.matchedText, "пятёрочка");
  });
});
