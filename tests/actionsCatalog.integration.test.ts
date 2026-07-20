import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration smoke for the Ф4 catalog rollout (goals, gandalf, wishlist,
 * notable_dates, expenses) via the real guard/dispatch against Postgres. Calendar
 * needs live Google OAuth, so it's only checked for registration, not called.
 */

const TG = 999000102;
let userId: number;
let tribeId: number;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ctx = import("../src/actions/types.js").ActionCtx;
let guard: typeof import("../src/actions/guard.js");
let registry: typeof import("../src/actions/registry.js");
let ctx: Ctx;

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();
  const { ensureUser } = await import("../src/expenses/repository.js");
  const user = await ensureUser(TG, "catalogtest", "Catalog", "Tester", false);
  userId = user.id;
  tribeId = user.tribeId;
  guard = await import("../src/actions/guard.js");
  registry = await import("../src/actions/registry.js");
  ctx = { telegramId: TG, menu: { role: "user", status: "approved", hasTribe: true, tribeId, tribeName: null } };
});

after(async () => {
  const { db } = await import("../src/db/drizzle.js");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM expenses WHERE user_id = ${userId}`);
  await db.execute(sql`DELETE FROM notable_dates WHERE created_by_user_id = ${userId}`);
  await db.execute(sql`DELETE FROM wishlists WHERE user_id = ${userId}`);
  await db.execute(sql`DELETE FROM gandalf_entries WHERE created_by_user_id = ${userId}`);
  await db.execute(sql`DELETE FROM gandalf_categories WHERE created_by_user_id = ${userId}`);
  await db.execute(sql`DELETE FROM goal_sets WHERE user_id = ${userId}`);
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

async function run(name: string, args: unknown): Promise<any> {
  const action = registry.getAction(name);
  assert.ok(action, `action ${name} registered`);
  return guard.executeAction(action!, ctx, args);
}

describe("catalog: goals", () => {
  it("create set → add goal → toggle → delete", async () => {
    const set = (await run("goals.set.create", { name: "2026", period: "year" })).data;
    assert.ok(set.id > 0);
    const goal = (await run("goals.goal.add", { goalSetId: set.id, text: "выучить X" })).data;
    assert.ok(goal.id > 0);
    const toggled = (await run("goals.goal.toggle", { goalId: goal.id })).data;
    assert.equal(toggled.isCompleted, true);
    const sets = (await run("goals.sets.list", {})).data;
    assert.ok(sets.some((s: any) => s.id === set.id));
    assert.equal((await run("goals.set.delete", { id: set.id })).data.deleted, true);
  });
});

describe("catalog: gandalf", () => {
  it("create category → create entry → list → delete", async () => {
    const cat = (await run("gandalf.category.create", { name: "Техника" })).data;
    assert.ok(cat.id > 0);
    const entry = (await run("gandalf.entry.create", { categoryId: cat.id, title: "Дрель", price: 5000 })).data;
    assert.ok(entry.id > 0);
    const list = (await run("gandalf.entries.list", {})).data;
    assert.ok(list.entries.some((e: any) => e.id === entry.id));
    assert.equal((await run("gandalf.entry.delete", { id: entry.id })).data.deleted, true);
    assert.equal((await run("gandalf.category.delete", { id: cat.id })).data.deleted, true);
  });
});

describe("catalog: wishlist", () => {
  it("create → add item → list items → delete", async () => {
    const wl = (await run("wishlist.create", { name: "Подарки" })).data;
    assert.ok(wl.id > 0);
    const item = (await run("wishlist.item.add", { wishlistId: wl.id, title: "Наушники", priority: 1 })).data;
    assert.ok(item.id > 0);
    const items = (await run("wishlist.items.list", { id: wl.id })).data;
    assert.ok(items.items.some((i: any) => i.id === item.id));
    assert.equal((await run("wishlist.delete", { id: wl.id })).data.deleted, true);
  });
});

describe("catalog: notable_dates", () => {
  it("create → upcoming/list → toggle → delete", async () => {
    const d = (await run("dates.create", { name: "День X", dateMonth: 3, dateDay: 15, isPriority: false })).data;
    assert.ok(d.id > 0);
    const list = (await run("dates.list", { limit: 50 })).data;
    assert.ok(list.dates.some((x: any) => x.id === d.id));
    await run("dates.togglePriority", { id: d.id });
    assert.equal((await run("dates.delete", { id: d.id })).data.deleted, true);
  });
});

describe("catalog: expenses", () => {
  it("add from text → recent → delete; report + categories work", async () => {
    const cats = (await run("expenses.categories", {})).data;
    assert.ok(Array.isArray(cats) && cats.length > 0);
    const catName = cats[0].name;

    const added = (await run("expenses.add", { text: `${catName} 500` })).data;
    assert.ok(added.expense.id > 0);
    assert.equal(added.expense.amount, 500);

    const recent = (await run("expenses.recent", { limit: 20 })).data;
    assert.ok(recent.items.some((e: any) => e.id === added.expense.id));

    const report = (await run("expenses.report", {})).data;
    assert.ok(report.month === undefined || typeof report === "object");

    assert.equal((await run("expenses.delete", { id: added.expense.id })).data.deleted, true);
  });
});

describe("catalog: registration", () => {
  it("calendar actions are registered (individual mode, not DB-tested here)", () => {
    const names = registry.getActions(ctx.menu).map((a) => a.name);
    for (const n of ["calendar.today", "calendar.event.create", "calendar.event.cancel"]) {
      assert.ok(names.includes(n), `${n} registered`);
    }
  });

  it("has a substantial number of actions across modes", () => {
    const total = registry.getAllActions().length;
    assert.ok(total >= 55, `expected >=55 actions, got ${total}`);
  });
});
