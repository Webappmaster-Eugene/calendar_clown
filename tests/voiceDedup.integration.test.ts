import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration test for voice-expense idempotency (addExpenseFromVoice dedup flag).
 * A retried voice upload — same user/amount/category/subcategory within the same
 * minute — must collapse to a single row (the API path enables this so a gateway
 * timeout + client re-send does not duplicate). The bot path (dedup off) keeps its
 * original behavior: identical calls create separate rows.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/voiceDedup.integration.test.ts
 */

const TG = 999_000_093;
let svc: typeof import("../src/services/expenseService.js");
let query: typeof import("../src/db/connection.js").query;
let userId: number;

async function clear() {
  await query("DELETE FROM expenses WHERE user_id = $1", [userId]);
}

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures(); // Продукты (fuzzy, no AI)
  svc = await import("../src/services/expenseService.js");
  query = (await import("../src/db/connection.js")).query;
  const { ensureUser } = await import("../src/expenses/repository.js");
  const u = await ensureUser(TG, "vdedup", "Voice", "Dedup", false);
  userId = u.id;
});

beforeEach(clear);

after(async () => {
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await clear();
  await cleanupTestUser(TG);
  await closeTestDb();
});

async function rowCount(): Promise<number> {
  const r = await query("SELECT count(*)::int AS n FROM expenses WHERE user_id = $1", [userId]);
  return r.rows[0].n;
}

describe("voice expense idempotency", () => {
  it("dedup=true: a retried identical voice save returns the same row, creates no duplicate", async () => {
    const first = await svc.addExpenseFromVoice(TG, "vdedup", "Voice", "Dedup", false, "Продукты", "кофе", 250, true);
    const retry = await svc.addExpenseFromVoice(TG, "vdedup", "Voice", "Dedup", false, "Продукты", "кофе", 250, true);
    assert.equal(retry.expense.id, first.expense.id, "retry must return the original expense id");
    assert.equal(await rowCount(), 1, "only one row must exist after the retry");
  });

  it("dedup=false (bot path): identical calls create separate rows", async () => {
    await svc.addExpenseFromVoice(TG, "vdedup", "Voice", "Dedup", false, "Продукты", "чай", 100, false);
    await svc.addExpenseFromVoice(TG, "vdedup", "Voice", "Dedup", false, "Продукты", "чай", 100, false);
    assert.equal(await rowCount(), 2, "bot path must not dedup");
  });

  it("dedup=true: a genuinely different amount is not deduped", async () => {
    await svc.addExpenseFromVoice(TG, "vdedup", "Voice", "Dedup", false, "Продукты", "молоко", 90, true);
    await svc.addExpenseFromVoice(TG, "vdedup", "Voice", "Dedup", false, "Продукты", "молоко", 95, true);
    assert.equal(await rowCount(), 2, "different amounts are distinct expenses");
  });
});
