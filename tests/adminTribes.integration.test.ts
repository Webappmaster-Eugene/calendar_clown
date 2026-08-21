import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for admin tribe listing (real DB).
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/adminTribes.integration.test.ts
 *
 * Guards the member counter: a correlated subquery inside a Drizzle select field
 * renders columns without a table prefix, so `${tribes.id}` collapsed to "id" and
 * resolved against the subquery's own table — every tribe reported the same count.
 */

const ADMIN_TG = 999000110;
const MEMBER_TGS = [999000111, 999000112, 999000113];
const TRIBE_NAME = "Тест-Трайб-Счётчик";
const EMPTY_TRIBE_NAME = "Тест-Трайб-Пустой";

let adminService: typeof import("../src/services/adminService.js");
let tribeId: number;
let emptyTribeId: number;

async function dropTribesByName(names: string[]): Promise<void> {
  const { db } = await import("../src/db/drizzle.js");
  const { tribes } = await import("../src/db/schema.js");
  const { inArray } = await import("drizzle-orm");
  await db.delete(tribes).where(inArray(tribes.name, names));
}

before(async () => {
  (await import("dotenv")).config();
  // isBootstrapAdmin() reads the env on every call, so set it after dotenv.
  process.env.ADMIN_TELEGRAM_ID = String(ADMIN_TG);

  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();

  const { cleanupTestUser } = await import("./helpers/testDb.js");
  for (const tg of MEMBER_TGS) await cleanupTestUser(tg);
  await dropTribesByName([TRIBE_NAME, EMPTY_TRIBE_NAME]);

  adminService = await import("../src/services/adminService.js");
  tribeId = (await adminService.createNewTribe(ADMIN_TG, TRIBE_NAME)).id;
  emptyTribeId = (await adminService.createNewTribe(ADMIN_TG, EMPTY_TRIBE_NAME)).id;

  const { ensureUser } = await import("../src/expenses/repository.js");
  const { grantTestUserAccess } = await import("./helpers/testDb.js");
  for (const tg of MEMBER_TGS) {
    await ensureUser(tg, `tribe_${tg}`, "Tribe", "Member", false);
    await grantTestUserAccess(tg, tribeId);
  }
});

after(async () => {
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  for (const tg of MEMBER_TGS) await cleanupTestUser(tg);
  await dropTribesByName([TRIBE_NAME, EMPTY_TRIBE_NAME]);
  await closeTestDb();
});

describe("getTribes member count", () => {
  it("counts every member assigned to the tribe", async () => {
    const list = await adminService.getTribes(ADMIN_TG);
    const tribe = list.find((t) => t.id === tribeId);
    assert.ok(tribe, "созданный трайб отсутствует в выдаче");
    assert.equal(tribe.memberCount, MEMBER_TGS.length);
  });

  it("reports zero for a tribe without members", async () => {
    const list = await adminService.getTribes(ADMIN_TG);
    const tribe = list.find((t) => t.id === emptyTribeId);
    assert.ok(tribe, "пустой трайб отсутствует в выдаче");
    assert.equal(tribe.memberCount, 0);
  });

  it("keeps counts per-tribe rather than emitting one constant", async () => {
    const list = await adminService.getTribes(ADMIN_TG);
    const counts = list.map((t) => t.memberCount);
    assert.ok(list.length >= 2, "нужно минимум два трайба для проверки");
    assert.ok(new Set(counts).size > 1, `все трайбы отдали одинаковый счётчик: ${counts.join(", ")}`);
  });

  it("newly created tribe starts empty", async () => {
    const created = await adminService.createNewTribe(ADMIN_TG, `${TRIBE_NAME}-tmp`);
    try {
      assert.equal(created.memberCount, 0);
    } finally {
      await adminService.removeTribe(ADMIN_TG, created.id);
    }
  });

  it("rejects non-admin callers", async () => {
    await assert.rejects(() => adminService.getTribes(MEMBER_TGS[0]), /Доступ запрещён/);
  });
});
