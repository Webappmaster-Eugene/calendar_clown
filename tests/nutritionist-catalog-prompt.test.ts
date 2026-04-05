/**
 * Unit tests for the Nutritionist product catalog prompt injection.
 * Verifies buildCatalogBlock output shape without needing a database.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCatalogBlock } from "../src/nutritionist/analyze.js";
import type {
  AnalyzeFoodOptions,
  CatalogProductForPrompt,
} from "../src/nutritionist/analyze.js";

function makeProduct(overrides: Partial<CatalogProductForPrompt> = {}): CatalogProductForPrompt {
  return {
    id: 1,
    name: "Молоко Простоквашино 2.5%",
    description: "Тетрапак, синий",
    unit: "ml",
    caloriesPer100: 54,
    proteinsPer100G: 2.9,
    fatsPer100G: 2.5,
    carbsPer100G: 4.7,
    ...overrides,
  };
}

describe("buildCatalogBlock", () => {
  it("renders a single product correctly", () => {
    const opts: AnalyzeFoodOptions = {
      products: [makeProduct({ id: 17 })],
      total: 1,
    };
    const block = buildCatalogBlock(opts);
    assert.ok(block.includes("ПОЛЬЗОВАТЕЛЬСКИЙ КАТАЛОГ ПРОДУКТОВ"));
    assert.ok(block.includes('[id=17]'));
    assert.ok(block.includes('"Молоко Простоквашино 2.5%"'));
    assert.ok(block.includes("(ml)"));
    assert.ok(block.includes("54 ккал"));
    assert.ok(block.includes("Б 2.9"));
    assert.ok(block.includes("Ж 2.5"));
    assert.ok(block.includes("У 4.7"));
    assert.ok(block.includes("Тетрапак, синий"));
    assert.ok(block.includes("matched_product_id"));
  });

  it("does not show truncation hint when all products fit", () => {
    const opts: AnalyzeFoodOptions = {
      products: [makeProduct({ id: 1 }), makeProduct({ id: 2, name: "Хлеб Бородинский", unit: "g" })],
      total: 2,
    };
    const block = buildCatalogBlock(opts);
    assert.ok(!block.includes("показано"));
  });

  it("shows truncation hint when total > products.length", () => {
    const opts: AnalyzeFoodOptions = {
      products: Array.from({ length: 60 }, (_, i) => makeProduct({ id: i + 1, name: `Продукт ${i + 1}` })),
      total: 150,
    };
    const block = buildCatalogBlock(opts);
    assert.ok(block.includes("(показано 60 из 150)"));
  });

  it("truncates long descriptions to 80 characters with ellipsis", () => {
    const longDesc = "а".repeat(200);
    const opts: AnalyzeFoodOptions = {
      products: [makeProduct({ description: longDesc })],
      total: 1,
    };
    const block = buildCatalogBlock(opts);
    const lineWithProduct = block.split("\n").find((l) => l.startsWith("1."));
    assert.ok(lineWithProduct);
    // 80 chars + ellipsis
    assert.ok(lineWithProduct.includes("а".repeat(80) + "…"));
    assert.ok(!lineWithProduct.includes("а".repeat(81)));
  });

  it("handles null description without dash", () => {
    const opts: AnalyzeFoodOptions = {
      products: [makeProduct({ description: null })],
      total: 1,
    };
    const block = buildCatalogBlock(opts);
    // Line should not end with " — "
    const lineWithProduct = block.split("\n").find((l) => l.startsWith("1."));
    assert.ok(lineWithProduct);
    assert.ok(!lineWithProduct.endsWith(" — "));
  });

  it("formats integers without unnecessary decimals", () => {
    const opts: AnalyzeFoodOptions = {
      products: [
        makeProduct({ caloriesPer100: 54, proteinsPer100G: 3, fatsPer100G: 0, carbsPer100G: 10 }),
      ],
      total: 1,
    };
    const block = buildCatalogBlock(opts);
    const line = block.split("\n").find((l) => l.startsWith("1."));
    assert.ok(line);
    assert.ok(line.includes("54 ккал"));
    assert.ok(line.includes("Б 3,"));
    assert.ok(line.includes("Ж 0,"));
    assert.ok(line.includes("У 10"));
    // Should NOT have .0 suffix
    assert.ok(!line.includes("3.0"));
    assert.ok(!line.includes("0.0"));
  });

  it("includes explicit instruction for matched_product_id", () => {
    const opts: AnalyzeFoodOptions = {
      products: [makeProduct()],
      total: 1,
    };
    const block = buildCatalogBlock(opts);
    assert.ok(block.includes("ЕСЛИ ты визуально идентифицируешь"));
    assert.ok(block.includes("используй ТОЧНО эти значения"));
    assert.ok(block.includes("matched_product_id"));
    assert.ok(block.includes("Если уверенности в совпадении нет"));
  });
});
