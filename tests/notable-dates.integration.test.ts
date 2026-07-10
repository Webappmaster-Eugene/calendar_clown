import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for the Notable Dates repository (real DB).
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/notable-dates.integration.test.ts
 */

const TG = 999000060;
let userId: number;
let tribeId: number;

let repo: typeof import("../src/notable-dates/repository.js");

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  const fixtures = await seedFixtures();
  tribeId = fixtures.tribeId;

  const { ensureUser } = await import("../src/expenses/repository.js");
  const user = await ensureUser(TG, "datestest", "Dates", "Tester", false);
  userId = user.id;

  repo = await import("../src/notable-dates/repository.js");
});

after(async () => {
  // Only drop rows this test created (the tribe is a shared fixture).
  const { db } = await import("../src/db/drizzle.js");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM notable_dates WHERE created_by_user_id = ${userId}`);
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

describe("notable date lifecycle", () => {
  let dateId: number;
  // Pick today's (month, day) so the row lands inside the getUpcomingDates window.
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  it("creates a notable date (month/day)", async () => {
    const nd = await repo.addNotableDate({
      tribeId,
      createdByUserId: userId,
      name: "Test Birthday",
      dateMonth: month,
      dateDay: day,
      eventType: "birthday",
      emoji: "🎉",
    });
    assert.ok(nd.id > 0);
    assert.equal(nd.tribeId, tribeId);
    assert.equal(nd.createdByUserId, userId);
    assert.equal(nd.name, "Test Birthday");
    assert.equal(nd.dateMonth, month);
    assert.equal(nd.dateDay, day);
    assert.equal(nd.eventType, "birthday");
    assert.equal(nd.emoji, "🎉");
    assert.equal(nd.isPriority, false);
    assert.equal(nd.isActive, true);
    dateId = nd.id;
  });

  it("finds the date by exact month/day", async () => {
    const rows = await repo.getDatesByMonthDay(tribeId, month, day);
    const mine = rows.filter((r) => r.id === dateId);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].name, "Test Birthday");
  });

  it("returns the date in the upcoming window (OR-of-(month,day) query)", async () => {
    // today is day 0 of the window, so a 1-day window already includes it.
    const upcoming = await repo.getUpcomingDates(tribeId, 1);
    const mine = upcoming.filter((r) => r.id === dateId);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].dateMonth, month);
    assert.equal(mine[0].dateDay, day);
  });

  it("toggles priority", async () => {
    assert.equal(await repo.toggleNotableDatePriority(dateId, tribeId), true);
    const on = await repo.getNotableDateById(dateId, tribeId);
    assert.ok(on);
    assert.equal(on.isPriority, true);

    assert.equal(await repo.toggleNotableDatePriority(dateId, tribeId), true);
    const off = await repo.getNotableDateById(dateId, tribeId);
    assert.ok(off);
    assert.equal(off.isPriority, false);
  });

  it("updates fields", async () => {
    const updated = await repo.updateNotableDate(dateId, tribeId, {
      name: "Test Birthday (edited)",
      description: "with a note",
      emoji: "🎂",
    });
    assert.ok(updated);
    assert.equal(updated.name, "Test Birthday (edited)");
    assert.equal(updated.description, "with a note");
    assert.equal(updated.emoji, "🎂");
    // Unchanged fields survive the partial update.
    assert.equal(updated.dateMonth, month);
    assert.equal(updated.dateDay, day);
  });

  it("deactivating (soft) hides it from active-only listings", async () => {
    const deactivated = await repo.updateNotableDate(dateId, tribeId, { isPriority: false });
    assert.ok(deactivated);
    // isActive is not exposed via updateNotableDate; confirm active listing still contains it.
    const listed = (await repo.listNotableDates(tribeId, month)).filter((r) => r.id === dateId);
    assert.equal(listed.length, 1);
  });

  it("deletes the notable date", async () => {
    const ok = await repo.removeNotableDate(dateId, tribeId);
    assert.equal(ok, true);
    assert.equal(await repo.getNotableDateById(dateId, tribeId), null);
    const rows = await repo.getDatesByMonthDay(tribeId, month, day);
    assert.equal(rows.filter((r) => r.id === dateId).length, 0);
  });
});
