import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for multi-line text entry via addExpenseFromText — the
 * single-expense path used after addMultipleExpenses declines (fewer than 2
 * parseable lines). Locks the fix where a message with ONE real expense line plus
 * junk/note lines is recorded cleanly from that line, instead of a whole-text parse
 * folding the junk into the subcategory. The "description + orphan amount line"
 * split (0 lines parse standalone) must still fall back to a whole-text parse.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/addExpenseTextMultiline.integration.test.ts
 */

const TG = 999_000_092;
let addExpenseFromText: typeof import("../src/services/expenseService.js").addExpenseFromText;

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures(); // seeds Продукты / Такси / Другое (+ aliases) — all fuzzy, no AI needed
  ({ addExpenseFromText } = await import("../src/services/expenseService.js"));
  const { ensureUser } = await import("../src/expenses/repository.js");
  await ensureUser(TG, "mltest", "Multi", "Line", false);
});

after(async () => {
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

describe("addExpenseFromText — multi-line with a single valid line", () => {
  it("records the one valid line cleanly and drops junk lines (no subcategory pollution)", async () => {
    const res = await addExpenseFromText(TG, "mltest", "Multi", "Line", false, "такси 300\nэто просто заметка без суммы");
    assert.equal(res.expense.categoryName, "Такси");
    assert.equal(res.expense.amount, 300);
    assert.equal(res.expense.subcategory, null, "junk line must NOT leak into the subcategory");
  });

  it("keeps the valid line's own subcategory, still dropping the junk line", async () => {
    const res = await addExpenseFromText(TG, "mltest", "Multi", "Line", false, "продукты молоко 250\nнапоминание купить хлеб");
    assert.equal(res.expense.categoryName, "Продукты");
    assert.equal(res.expense.amount, 250);
    assert.equal(res.expense.subcategory, "молоко");
  });

  it("still whole-text parses when the amount is on its own line (0 lines parse standalone)", async () => {
    // Neither line is a standalone expense (line 1 has no amount; a bare "500" has
    // no category text), so the whole-text fallback must reunite them.
    const res = await addExpenseFromText(TG, "mltest", "Multi", "Line", false, "продукты магазин\n500");
    assert.equal(res.expense.categoryName, "Продукты");
    assert.equal(res.expense.amount, 500);
  });

  it("rejects when no line has an amount at all", async () => {
    await assert.rejects(
      () => addExpenseFromText(TG, "mltest", "Multi", "Line", false, "продукты\nхлеб молоко"),
      /Не удалось разобрать трату/
    );
  });
});
