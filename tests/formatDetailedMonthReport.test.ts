import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatDetailedMonthReport,
  type DetailedReportCategory,
} from "../src/expenses/formatter.js";

const MAX_SEGMENT_LENGTH = 3800;

function makeExpense(amount: number, sub: string | null, firstName = "Иван") {
  return {
    amount,
    subcategory: sub,
    firstName,
    createdAt: new Date("2026-04-15T10:00:00Z"),
  };
}

function makeCategory(name: string, emoji: string, expenses: Array<{ amount: number; sub: string | null }>): DetailedReportCategory {
  return {
    categoryName: name,
    categoryEmoji: emoji,
    total: expenses.reduce((s, e) => s + e.amount, 0),
    expenses: expenses.map((e) => makeExpense(e.amount, e.sub)),
  };
}

describe("formatDetailedMonthReport", () => {
  it("returns single segment with empty-state message when no categories", () => {
    const segments = formatDetailedMonthReport([], 0, 0, 2026, 4, "Семья");
    assert.equal(segments.length, 1);
    assert.match(segments[0], /Расходы за Апрель 2026/);
    assert.match(segments[0], /расходов нет/);
  });

  it("fits a small report into a single segment with header, totals and footer", () => {
    const categories: DetailedReportCategory[] = [
      makeCategory("Еда", "🍕", [
        { amount: 350, sub: "Кофе" },
        { amount: 1200, sub: "Ужин" },
      ]),
      makeCategory("Транспорт", "🚗", [{ amount: 800, sub: "Такси" }]),
    ];
    const segments = formatDetailedMonthReport(categories, 2350, 50000, 2026, 4, "Семья");
    assert.equal(segments.length, 1);
    const text = segments[0];
    assert.match(text, /Расходы за Апрель 2026/);
    assert.match(text, /\*Еда\*/);
    assert.match(text, /\*Транспорт\*/);
    assert.match(text, /Кофе/);
    assert.match(text, /Ужин/);
    assert.match(text, /Такси/);
    assert.match(text, /Итого:/);
    assert.match(text, /Лимит:/);
    assert.ok(text.length <= MAX_SEGMENT_LENGTH);
  });

  it("escapes Markdown special characters in subcategory and firstName", () => {
    const categories: DetailedReportCategory[] = [
      {
        categoryName: "Еда",
        categoryEmoji: "🍕",
        total: 100,
        expenses: [
          {
            amount: 100,
            subcategory: "*bold* _italic_ [link]",
            firstName: "Иван*",
            createdAt: new Date("2026-04-15T10:00:00Z"),
          },
        ],
      },
    ];
    const segments = formatDetailedMonthReport(categories, 100, 0, 2026, 4, "Семья");
    const text = segments.join("\n");
    assert.match(text, /\\\*bold\\\*/);
    assert.match(text, /\\_italic\\_/);
    assert.match(text, /\\\[link\\\]/);
    assert.match(text, /Иван\\\*/);
  });

  it("splits a large report into multiple segments and labels continuations", () => {
    // ~10 categories × ~50 operations each = 500 lines. Each line ~80 chars → ~40 KB.
    const categories: DetailedReportCategory[] = [];
    for (let c = 0; c < 10; c++) {
      const expenses = [];
      for (let i = 0; i < 50; i++) {
        expenses.push({ amount: 100 + i, sub: `Покупка номер ${i} в категории ${c}` });
      }
      categories.push(makeCategory(`Категория${c}`, "📦", expenses));
    }
    const grandTotal = categories.reduce((s, c) => s + c.total, 0);

    const segments = formatDetailedMonthReport(categories, grandTotal, 100000, 2026, 4, "Семья");

    assert.ok(segments.length >= 3, `expected ≥3 segments, got ${segments.length}`);

    for (const seg of segments) {
      assert.ok(seg.length <= MAX_SEGMENT_LENGTH, `segment too long: ${seg.length}`);
    }

    // First segment carries the canonical header.
    assert.match(segments[0], /^📊 \*Расходы за Апрель 2026\*/);
    // Subsequent segments carry the continuation marker, with proper N/M.
    for (let idx = 1; idx < segments.length; idx++) {
      const expected = new RegExp(`продолжение ${idx + 1}/${segments.length}`);
      assert.match(segments[idx], expected, `segment ${idx} missing continuation marker`);
    }
    // Footer (Итого) only on the very last segment.
    const totalsCount = segments.filter((s) => /Итого:/.test(s)).length;
    assert.equal(totalsCount, 1, "footer must appear exactly once (last segment)");
  });

  it("splits inside a single oversize category", () => {
    // One category with 200 long-subcategory operations: forces splitting mid-category.
    const longSub = "Очень длинная подкатегория для проверки разбиения отчёта";
    const expenses = Array.from({ length: 200 }, (_, i) => ({
      amount: 1000 + i,
      sub: `${longSub} #${i}`,
    }));
    const categories: DetailedReportCategory[] = [makeCategory("Большая", "🛒", expenses)];
    const grandTotal = categories[0].total;

    const segments = formatDetailedMonthReport(categories, grandTotal, 0, 2026, 4, "Семья");

    assert.ok(segments.length >= 2);
    for (const seg of segments) {
      assert.ok(seg.length <= MAX_SEGMENT_LENGTH);
    }
    // The footer with grand total appears exactly once.
    assert.equal(segments.filter((s) => /Итого:/.test(s)).length, 1);
  });

  it("truncates very long subcategories with an ellipsis", () => {
    const veryLong = "x".repeat(200);
    const categories: DetailedReportCategory[] = [
      makeCategory("Тест", "🧪", [{ amount: 100, sub: veryLong }]),
    ];
    const segments = formatDetailedMonthReport(categories, 100, 0, 2026, 4, "Семья");
    const text = segments.join("\n");
    assert.match(text, /…/);
    assert.ok(!text.includes(veryLong));
  });
});
