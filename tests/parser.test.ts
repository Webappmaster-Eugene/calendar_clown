import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for the expense text parser.
 * Run with: npx tsx --test tests/parser.test.ts
 *
 * Note: requires DATABASE_URL to be set (parser loads categories from DB).
 * Use docker-compose to start PostgreSQL before running tests.
 */

// Dynamically import after env is loaded
let parseExpenseText: (text: string) => Promise<import("../src/expenses/types.js").ParsedExpense | null>;

before(async () => {
  // Load env
  const dotenv = await import("dotenv");
  dotenv.config();
  dotenv.config({ path: ".env.local", override: true });

  // Run migrations to ensure categories exist
  const { runMigrations } = await import("../src/db/migrate.js");
  await runMigrations();

  const parser = await import("../src/expenses/parser.js");
  parseExpenseText = parser.parseExpenseText;
});

after(async () => {
  const { closePool } = await import("../src/db/connection.js");
  await closePool();
});

describe("parseExpenseText", () => {
  it("parses simple category + amount", async () => {
    const result = await parseExpenseText("Аптека 5000");
    assert.notEqual(result, null);
    assert.equal(result!.categoryName, "Аптека");
    assert.equal(result!.amount, 5000);
    assert.equal(result!.subcategory, null);
  });

  it("parses category + subcategory + amount", async () => {
    const result = await parseExpenseText("Кафе Хот-дог 400");
    assert.notEqual(result, null);
    assert.equal(result!.amount, 400);
    assert.notEqual(result!.subcategory, null);
  });

  it("parses amount with space separator", async () => {
    const result = await parseExpenseText("Продукты 55 000");
    assert.notEqual(result, null);
    assert.equal(result!.amount, 55000);
  });

  it("returns null for empty input", async () => {
    const result = await parseExpenseText("");
    assert.equal(result, null);
  });

  it("returns null for text without amount", async () => {
    const result = await parseExpenseText("Аптека");
    assert.equal(result, null);
  });

  it("returns null for just a number (no category text)", async () => {
    const result = await parseExpenseText("12345");
    assert.equal(result, null);
  });

  it("falls back to 'Другое' for unrecognized category text", async () => {
    const result = await parseExpenseText("xyzthing 1000");
    assert.notEqual(result, null);
    assert.equal(result!.categoryName, "Другое");
    assert.equal(result!.amount, 1000);
    assert.equal(result!.subcategory, "xyzthing");
  });

  it("handles amount with 'руб' suffix", async () => {
    const result = await parseExpenseText("Бензин 2000 руб");
    assert.notEqual(result, null);
    assert.equal(result!.amount, 2000);
  });

  it("handles fuzzy category matching", async () => {
    const result = await parseExpenseText("аптка 300");
    assert.notEqual(result, null);
    assert.equal(result!.categoryName, "Аптека");
    assert.equal(result!.amount, 300);
  });

  it("handles decimal amounts", async () => {
    const result = await parseExpenseText("Такси 350.50");
    assert.notEqual(result, null);
    assert.equal(result!.amount, 350.5);
  });
});
