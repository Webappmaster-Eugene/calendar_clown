import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for the Task Tracker repository (real DB).
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/tasks.integration.test.ts
 */

const TG = 999000020;
let userId: number;

let repo: typeof import("../src/tasks/repository.js");

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();

  const { ensureUser } = await import("../src/expenses/repository.js");
  const user = await ensureUser(TG, "tasktest", "Task", "Tester", false);
  userId = user.id;

  repo = await import("../src/tasks/repository.js");
});

after(async () => {
  // task_works cascade to task_items -> task_reminders; then remove the user.
  const { db } = await import("../src/db/drizzle.js");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM task_works WHERE user_id = ${userId}`);
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

describe("task tracker lifecycle", () => {
  let workId: number;
  let itemId: number;

  it("creates a task work", async () => {
    const work = await repo.createTaskWork(userId, "Ремонт", "🔨");
    assert.ok(work.id > 0);
    assert.equal(work.userId, userId);
    assert.equal(work.name, "Ремонт");
    assert.equal(work.emoji, "🔨");
    assert.equal(work.isArchived, false);
    workId = work.id;
  });

  it("enforces the unique (user, lower(name)) active constraint", async () => {
    await assert.rejects(() => repo.createTaskWork(userId, "ремонт", "📋"));
    // Case-insensitive lookup finds the existing active work.
    const found = await repo.getTaskWorkByName(userId, "РЕМОНТ");
    assert.ok(found);
    assert.equal(found?.id, workId);
  });

  it("creates a task item WITH reminders atomically", async () => {
    const deadline = new Date(Date.now() + 24 * 3600_000); // tomorrow
    const reminders = [{ remindAt: new Date(Date.now() + 3600_000), reminderType: "1h_before" }];
    const item = await repo.createTaskItemWithReminders(workId, "Купить краску", deadline, "text", reminders);
    assert.ok(item.id > 0);
    assert.equal(item.workId, workId);
    assert.equal(item.text, "Купить краску");
    assert.equal(item.isCompleted, false);
    assert.equal(item.completedAt, null);
    assert.equal(item.inputMethod, "text");
    itemId = item.id;

    // Both the item and its reminders are persisted.
    const items = await repo.getTaskItemsByWork(workId);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, itemId);

    const { db } = await import("../src/db/drizzle.js");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(
      sql`SELECT reminder_type FROM task_reminders WHERE task_item_id = ${itemId}`,
    );
    assert.equal(rows.rows.length, 1);
    assert.equal((rows.rows[0] as { reminder_type: string }).reminder_type, "1h_before");
  });

  it("toggles item completion (and back)", async () => {
    const done = await repo.toggleTaskItemCompleted(itemId);
    assert.equal(done?.isCompleted, true);
    assert.ok(done?.completedAt instanceof Date);

    const undone = await repo.toggleTaskItemCompleted(itemId);
    assert.equal(undone?.isCompleted, false);
    assert.equal(undone?.completedAt, null);
  });

  it("replaceTaskItemDeadline regenerates reminders", async () => {
    const newDeadline = new Date(Date.now() + 48 * 3600_000); // +2 days
    const newReminders = [
      { remindAt: new Date(Date.now() + 3600_000), reminderType: "1h_before" },
      { remindAt: new Date(Date.now() + 4 * 3600_000), reminderType: "4h_before" },
    ];
    const updated = await repo.replaceTaskItemDeadline(itemId, newDeadline, newReminders);
    assert.ok(updated);
    assert.equal(updated?.deadline.getTime(), newDeadline.getTime());

    const { db } = await import("../src/db/drizzle.js");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(
      sql`SELECT reminder_type FROM task_reminders WHERE task_item_id = ${itemId} ORDER BY remind_at`,
    );
    // Old single reminder replaced by the two new ones.
    assert.equal(rows.rows.length, 2);
    const types = rows.rows.map((r) => (r as { reminder_type: string }).reminder_type);
    assert.deepEqual(types, ["1h_before", "4h_before"]);
  });

  it("aggregates active/completed counts on the work", async () => {
    // One more item, completed, to exercise both buckets.
    const deadline = new Date(Date.now() + 24 * 3600_000);
    const second = await repo.createTaskItemWithReminders(workId, "Снять плинтус", deadline, "text", []);
    await repo.toggleTaskItemCompleted(second.id);

    const work = await repo.getTaskWorkById(workId);
    assert.ok(work);
    assert.equal(work?.activeCount, 1);
    assert.equal(work?.completedCount, 1);

    const works = await repo.getTaskWorksByUser(userId);
    const mine = works.find((w) => w.id === workId);
    assert.ok(mine);
    assert.equal(mine?.activeCount, 1);
    assert.equal(mine?.completedCount, 1);

    const n = await repo.countTaskWorksByUser(userId);
    assert.ok(n >= 1);
  });

  it("resolves task item ownership", async () => {
    const owned = await repo.getTaskItemWithOwnership(itemId, userId);
    assert.ok(owned);
    assert.equal(owned?.item.id, itemId);
    assert.equal(owned?.work.id, workId);

    // A different (non-owning) user id must not resolve.
    const notOwned = await repo.getTaskItemWithOwnership(itemId, userId + 999999);
    assert.equal(notOwned, null);
  });

  it("returns due pending reminders and marks them sent", async () => {
    // A task with a reminder already in the past should surface as pending.
    const deadline = new Date(Date.now() + 24 * 3600_000);
    const dueItem = await repo.createTaskItemWithReminders(workId, "Позвонить прорабу", deadline, "text", [
      { remindAt: new Date(Date.now() - 60_000), reminderType: "1h_before" },
    ]);

    const pending = await repo.getPendingTaskReminders(new Date());
    const mine = pending.filter((p) => p.taskItemId === dueItem.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].taskText, "Позвонить прорабу");
    assert.equal(mine[0].workName, "Ремонт");
    assert.equal(mine[0].telegramId, TG);
    assert.equal(mine[0].userId, userId);

    await repo.markTaskReminderSent(mine[0].reminderId);
    const after = (await repo.getPendingTaskReminders(new Date())).filter(
      (p) => p.taskItemId === dueItem.id,
    );
    assert.equal(after.length, 0);
  });

  it("cascade-deletes the work (items + reminders go with it)", async () => {
    const ok = await repo.deleteTaskWork(workId, userId);
    assert.equal(ok, true);
    assert.equal((await repo.getTaskItemsByWork(workId)).length, 0);
    assert.equal(await repo.getTaskWorkById(workId), null);

    const { db } = await import("../src/db/drizzle.js");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(
      sql`SELECT r.id FROM task_reminders r
          JOIN task_items i ON i.id = r.task_item_id
          WHERE i.work_id = ${workId}`,
    );
    assert.equal(rows.rows.length, 0);
  });
});
