import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for the Goals repository (real DB).
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/goals.integration.test.ts
 */

const TG = 999000010;
let userId: number;

let repo: typeof import("../src/goals/repository.js");

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();

  const { ensureUser } = await import("../src/expenses/repository.js");
  const user = await ensureUser(TG, "goaltest", "Goal", "Tester", false);
  userId = user.id;

  repo = await import("../src/goals/repository.js");
});

after(async () => {
  // goal_sets cascade to goals/viewers/reminders; then remove the user.
  const { db } = await import("../src/db/drizzle.js");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM goal_sets WHERE user_id = ${userId}`);
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

describe("goal set lifecycle", () => {
  let setId: number;
  let goalId: number;

  it("creates a goal set", async () => {
    const set = await repo.createGoalSet(userId, "Q3", "month", null, "🎯");
    assert.ok(set.id > 0);
    assert.equal(set.name, "Q3");
    assert.equal(set.visibility, "private");
    setId = set.id;
  });

  it("adds goals and lists them", async () => {
    const g1 = await repo.createGoal(setId, "goal-one");
    goalId = g1.id;
    await repo.createGoal(setId, "goal-two");
    const goals = await repo.getGoalsBySet(setId);
    assert.equal(goals.length, 2);
    assert.equal(goals.every((g) => !g.isCompleted), true);
  });

  it("toggles a goal and reflects it in the aggregate progress", async () => {
    const toggled = await repo.toggleGoalCompleted(goalId);
    assert.equal(toggled?.isCompleted, true);
    const progress = await repo.getGoalSetProgress(setId);
    assert.equal(progress.total, 2);
    assert.equal(progress.completed, 1);
    const withCounts = await repo.getGoalSetById(setId);
    assert.equal(withCounts?.totalCount, 2);
    assert.equal(withCounts?.completedCount, 1);
  });

  it("updates goal text and set fields", async () => {
    const g = await repo.updateGoalText(goalId, "goal-one-edited");
    assert.equal(g?.text, "goal-one-edited");
    const s = await repo.updateGoalSet(setId, userId, { name: "Q3-edited", visibility: "public" });
    assert.equal(s?.name, "Q3-edited");
    assert.equal(s?.visibility, "public");
  });

  it("counts goal sets for the user", async () => {
    const n = await repo.countGoalSetsByUser(userId);
    assert.ok(n >= 1);
  });

  it("delivers a due reminder then marks it sent", async () => {
    await repo.createReminders(setId, [new Date(Date.now() - 60_000)]);
    const pending = await repo.getPendingReminders(new Date());
    const mine = pending.filter((p) => p.goalSetId === setId);
    assert.ok(mine.length >= 1);
    await repo.markReminderSent(mine[0].reminderId);
    const after = (await repo.getPendingReminders(new Date())).filter((p) => p.goalSetId === setId);
    assert.equal(after.length, 0);
  });

  it("cascade-deletes the set (goals go with it)", async () => {
    const ok = await repo.deleteGoalSet(setId, userId);
    assert.equal(ok, true);
    assert.equal((await repo.getGoalsBySet(setId)).length, 0);
    assert.equal(await repo.getGoalSetById(setId), null);
  });
});
