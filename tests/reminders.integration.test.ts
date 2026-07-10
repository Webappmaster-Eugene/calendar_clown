import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for the Reminders repository (real DB).
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/reminders.integration.test.ts
 */

const TG = 999000050;
const TG_SUB = 999000051;
let userId: number;
let subscriberUserId: number;

let repo: typeof import("../src/reminders/repository.js");

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();

  const { ensureUser } = await import("../src/expenses/repository.js");
  const user = await ensureUser(TG, "remindtest", "Remind", "Tester", false);
  userId = user.id;
  const sub = await ensureUser(TG_SUB, "remindsub", "Remind", "Subscriber", false);
  subscriberUserId = sub.id;

  repo = await import("../src/reminders/repository.js");
});

after(async () => {
  // reminders cascade to reminder_subscribers; drop them, then both users.
  const { db } = await import("../src/db/drizzle.js");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM reminders WHERE user_id = ${userId}`);
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await cleanupTestUser(TG_SUB);
  await closeTestDb();
});

describe("reminder lifecycle", () => {
  let reminderId: number;
  const schedule = { times: ["09:00", "18:30"], weekdays: [1, 2, 3, 4, 5], endDate: null };

  it("creates a reminder with a jsonb schedule that round-trips as an object", async () => {
    const rem = await repo.createReminder(userId, null, "Drink water", schedule);
    assert.ok(rem.id > 0);
    assert.equal(rem.userId, userId);
    assert.equal(rem.text, "Drink water");
    assert.equal(rem.isActive, true);
    assert.equal(rem.inputMethod, "text");
    reminderId = rem.id;

    // The schedule must come back as a structured object (jsonb), not a JSON string.
    assert.equal(typeof rem.schedule, "object");
    assert.notEqual(typeof rem.schedule, "string");
    assert.deepEqual(rem.schedule.times, ["09:00", "18:30"]);
    assert.deepEqual(rem.schedule.weekdays, [1, 2, 3, 4, 5]);
    assert.equal(rem.schedule.endDate, null);

    // Re-fetch from DB to confirm the round-trip is not just the in-memory insert value.
    const fetched = await repo.getReminderById(reminderId);
    assert.ok(fetched);
    assert.equal(typeof fetched.schedule, "object");
    assert.deepEqual(fetched.schedule.times, ["09:00", "18:30"]);
    assert.deepEqual(fetched.schedule.weekdays, [1, 2, 3, 4, 5]);
  });

  it("lists reminders for the user", async () => {
    const list = await repo.getRemindersByUser(userId);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, reminderId);
    assert.deepEqual(list[0].schedule.times, ["09:00", "18:30"]);
  });

  it("toggles active off and on, updating the active count", async () => {
    assert.equal(await repo.countActiveReminders(userId), 1);

    const off = await repo.toggleReminderActive(reminderId, userId);
    assert.ok(off);
    assert.equal(off.isActive, false);
    assert.equal(await repo.countActiveReminders(userId), 0);

    const on = await repo.toggleReminderActive(reminderId, userId);
    assert.ok(on);
    assert.equal(on.isActive, true);
    assert.equal(await repo.countActiveReminders(userId), 1);
  });

  it("adds a subscriber, lists them, then removes", async () => {
    assert.equal(await repo.isSubscribed(reminderId, subscriberUserId), false);

    await repo.addSubscriber(reminderId, subscriberUserId);
    assert.equal(await repo.isSubscribed(reminderId, subscriberUserId), true);

    const subs = await repo.getSubscribers(reminderId);
    assert.equal(subs.length, 1);
    assert.equal(subs[0].subscriberUserId, subscriberUserId);
    assert.equal(subs[0].reminderId, reminderId);
    assert.equal(subs[0].subscriberTelegramId, TG_SUB);
    assert.equal(subs[0].subscriberName, "Remind");

    // Idempotent add (onConflictDoNothing) must not create a duplicate row.
    await repo.addSubscriber(reminderId, subscriberUserId);
    assert.equal((await repo.getSubscribers(reminderId)).length, 1);

    await repo.removeSubscriber(reminderId, subscriberUserId);
    assert.equal(await repo.isSubscribed(reminderId, subscriberUserId), false);
    assert.equal((await repo.getSubscribers(reminderId)).length, 0);
  });

  it("returns the active reminder in the scheduler query with owner telegram id", async () => {
    const active = await repo.getActiveRemindersWithUsers();
    const mine = active.filter((r) => r.id === reminderId);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].telegramId, TG);
    assert.equal(mine[0].soundFilename, null);
    assert.deepEqual(mine[0].schedule.weekdays, [1, 2, 3, 4, 5]);
  });

  it("cascade-deletes the reminder and its subscribers", async () => {
    // Re-add a subscriber so we can prove the cascade removes it.
    await repo.addSubscriber(reminderId, subscriberUserId);
    assert.equal((await repo.getSubscribers(reminderId)).length, 1);

    const ok = await repo.deleteReminder(reminderId, userId);
    assert.equal(ok, true);
    assert.equal(await repo.getReminderById(reminderId), null);

    // Subscriber rows are gone via ON DELETE CASCADE.
    assert.equal((await repo.getSubscribers(reminderId)).length, 0);
    assert.equal(await repo.isSubscribed(reminderId, subscriberUserId), false);
  });
});
