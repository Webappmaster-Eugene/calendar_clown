import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for the access-request audit trail (real DB).
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/accessRequests.integration.test.ts
 */

const TG = 999000018;
const ADMIN_TG = 999000019;

let repo: typeof import("../src/access/repository.js");
let users: typeof import("../src/expenses/repository.js");

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb } = await import("./helpers/testDb.js");
  await setupTestDb();

  repo = await import("../src/access/repository.js");
  users = await import("../src/expenses/repository.js");
});

after(async () => {
  const { db } = await import("../src/db/drizzle.js");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM access_requests WHERE telegram_id IN (${TG}, ${ADMIN_TG})`);
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

async function requestsFor(telegramId: number) {
  const all = await repo.listAccessRequests("all", 200);
  return all.filter((r) => r.telegramId === telegramId);
}

describe("access request audit trail", () => {
  it("opens a pending request when a user applies", async () => {
    await users.createPendingUser(TG, "applicant", "Заявитель", null);

    const mine = await requestsFor(TG);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, "pending");
    assert.equal(mine[0].username, "applicant");
    assert.equal(mine[0].decidedAt, null);
    assert.equal(mine[0].decidedBy, null);
  });

  it("closes the request as approved and records who decided", async () => {
    const approved = await users.approveUser(TG, ADMIN_TG);
    assert.equal(approved, true);

    const mine = await requestsFor(TG);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, "approved");
    assert.equal(mine[0].decidedBy, ADMIN_TG);
    assert.ok(mine[0].decidedAt);
  });

  it("filters by status", async () => {
    const pending = await repo.listAccessRequests("pending", 200);
    assert.equal(pending.some((r) => r.telegramId === TG), false);

    const approvedList = await repo.listAccessRequests("approved", 200);
    assert.equal(approvedList.some((r) => r.telegramId === TG), true);
  });

  it("keeps the history after a rejection deletes the user row", async () => {
    // Re-applying after approval is a second row — one per attempt.
    await users.removeUserByTelegramId(TG);
    await users.createPendingUser(TG, "applicant", "Заявитель", null);

    const rejected = await users.rejectUser(TG, ADMIN_TG);
    assert.equal(rejected, true);

    // The user row is gone, but both attempts survive with their outcomes.
    assert.equal(await users.isUserInDb(TG), false);
    const mine = await requestsFor(TG);
    assert.equal(mine.length, 2);
    assert.deepEqual(mine.map((r) => r.status).sort(), ["approved", "rejected"]);
  });
});
