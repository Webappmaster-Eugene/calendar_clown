import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for the idempotency guards in the repositories — the places
 * that must stay safe under repeated calls (retries, duplicate deliveries,
 * double-taps). These lock in three real guards:
 *   - ensureUser: idempotent by telegram_id (no dup), role upgrades only, profile
 *     updates on change;
 *   - insertBankPushExpense: same dedup_hash inserts once, second delivery is a no-op;
 *   - addViewer: onConflictDoNothing — adding the same viewer twice keeps one row.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/repositoryIdempotency.integration.test.ts
 */

const TG = 999000080;
let userId: number;
let tribeId: number;
let categoryId: number;
let repo: typeof import("../src/expenses/repository.js");
let bankPush: typeof import("../src/expenses/bankPush/repository.js");
let goals: typeof import("../src/goals/repository.js");
let db: typeof import("../src/db/drizzle.js").db;
let schema: typeof import("../src/db/schema.js");

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();

  repo = await import("../src/expenses/repository.js");
  bankPush = await import("../src/expenses/bankPush/repository.js");
  goals = await import("../src/goals/repository.js");
  db = (await import("../src/db/drizzle.js")).db;
  schema = await import("../src/db/schema.js");

  const user = await repo.ensureUser(TG, "idem", "Idem", "User", false);
  userId = user.id;
  tribeId = user.tribeId!;
  const { eq } = await import("drizzle-orm");
  const [cat] = await db.select().from(schema.categories).where(eq(schema.categories.name, "Другое"));
  categoryId = cat.id;
});

after(async () => {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM goal_sets WHERE user_id = ${userId}`);
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

describe("ensureUser idempotency", () => {
  it("returns the same user and never creates a duplicate for the same telegram_id", async () => {
    const again = await repo.ensureUser(TG, "idem", "Idem", "User", false);
    assert.equal(again.id, userId);
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(schema.users).where(eq(schema.users.telegramId, BigInt(TG)));
    assert.equal(rows.length, 1, "must be exactly one row for this telegram_id");
  });

  it("upgrades role to admin but never downgrades it", async () => {
    const { eq } = await import("drizzle-orm");
    await repo.ensureUser(TG, "idem", "Idem", "User", true); // upgrade
    let [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    assert.equal(row.role, "admin", "isAdmin=true must upgrade to admin");

    await repo.ensureUser(TG, "idem", "Idem", "User", false); // must NOT downgrade
    [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    assert.equal(row.role, "admin", "isAdmin=false must not downgrade an existing admin");
  });

  it("updates profile fields when they change", async () => {
    const { eq } = await import("drizzle-orm");
    await repo.ensureUser(TG, "idem2", "Renamed", "Person", false);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    assert.equal(row.firstName, "Renamed");
    assert.equal(row.username, "idem2");
  });
});

describe("insertBankPushExpense dedup guard", () => {
  it("inserts once for a dedup_hash and no-ops on repeated delivery", async () => {
    const dedupHash = `idem_dedup_${TG}`;
    const input = { userId, tribeId, categoryId, amount: 123, subcategory: "push", dedupHash };

    const first = await bankPush.insertBankPushExpense(input);
    assert.ok(first && first.id > 0, "first delivery must insert a row");

    const second = await bankPush.insertBankPushExpense(input);
    assert.equal(second, null, "repeated delivery with same dedup_hash must be a no-op");

    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(schema.expenses).where(eq(schema.expenses.dedupHash, dedupHash));
    assert.equal(rows.length, 1, "exactly one expense must exist for the dedup_hash");
  });
});

describe("addViewer onConflictDoNothing guard", () => {
  it("keeps a single row when the same viewer is added twice", async () => {
    const set = await goals.createGoalSet(userId, "IdemSet", "month", null, "🎯");
    await goals.addViewer(set.id, userId);
    await goals.addViewer(set.id, userId); // duplicate — must be swallowed

    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(schema.goalSetViewers).where(eq(schema.goalSetViewers.goalSetId, set.id));
    assert.equal(rows.length, 1, "adding the same viewer twice must keep exactly one row");
  });
});
