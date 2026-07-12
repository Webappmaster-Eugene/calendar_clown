import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration test for the DETERMINISTIC core of the voice→expense funnel: the
 * saving step (addExpenseFromVoice). The upstream STT + AI intent-extraction are
 * paid/non-deterministic and out of scope here; this locks in what happens once
 * an intent {category, subcategory, amount} is extracted:
 *   - category resolved by exact name, then by alias, else falls back to "Другое";
 *   - on the "Другое" fallback the original AI guess is preserved as subcategory;
 *   - the row is persisted with input_method = 'voice', linked to the user/tribe.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/voiceExpense.integration.test.ts
 */

const TG = 999000070;
let userId: number;
let addExpenseFromVoice: typeof import("../src/services/expenseService.js").addExpenseFromVoice;
let db: typeof import("../src/db/drizzle.js").db;
let schema: typeof import("../src/db/schema.js");

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures(); // ensures the seeded categories (with aliases) are loaded and the cache is fresh

  ({ addExpenseFromVoice } = await import("../src/services/expenseService.js"));
  db = (await import("../src/db/drizzle.js")).db;
  schema = await import("../src/db/schema.js");

  const { ensureUser } = await import("../src/expenses/repository.js");
  const user = await ensureUser(TG, "voicetest", "Voice", "Tester", false);
  userId = user.id;
});

after(async () => {
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

describe("voice→expense saving", () => {
  it("saves with input_method='voice' when the category name matches exactly", async () => {
    const { eq } = await import("drizzle-orm");
    const res = await addExpenseFromVoice(TG, "voicetest", "Voice", "Tester", false, "Продукты", "молоко", 150);
    assert.equal(res.expense.categoryName, "Продукты");
    assert.equal(res.expense.subcategory, "молоко");
    assert.equal(res.expense.amount, 150);
    assert.equal(res.expense.inputMethod, "voice");
    assert.ok(res.expense.id > 0);

    // The persisted row really carries input_method='voice' and the right amount.
    const [row] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, res.expense.id));
    assert.ok(row, "expense row must be persisted");
    assert.equal(row.inputMethod, "voice");
    assert.equal(Number(row.amount), 150);
    assert.equal(row.userId, userId);
  });

  it("resolves the category via an alias when the name is not exact", async () => {
    // "еда" is a seeded alias of "Продукты".
    const res = await addExpenseFromVoice(TG, "voicetest", "Voice", "Tester", false, "еда", null, 300);
    assert.equal(res.expense.categoryName, "Продукты", "alias 'еда' must resolve to Продукты");
    assert.equal(res.expense.amount, 300);
    assert.equal(res.expense.inputMethod, "voice");
  });

  it("falls back to 'Другое' for an unknown category and preserves the original guess as subcategory", async () => {
    const res = await addExpenseFromVoice(TG, "voicetest", "Voice", "Tester", false, "Криптовалюта", null, 999);
    assert.equal(res.expense.categoryName, "Другое");
    // No subcategory was given → the unmatched AI guess is preserved so nothing is lost.
    assert.equal(res.expense.subcategory, "Криптовалюта");
    assert.equal(res.expense.amount, 999);
    assert.equal(res.expense.inputMethod, "voice");
  });

  it("keeps an explicit subcategory on the 'Другое' fallback (does not overwrite it with the guess)", async () => {
    const res = await addExpenseFromVoice(TG, "voicetest", "Voice", "Tester", false, "Нечто", "подарок другу", 500);
    assert.equal(res.expense.categoryName, "Другое");
    assert.equal(res.expense.subcategory, "подарок другу");
  });
});
