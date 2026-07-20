import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for the Action Registry pilot (reminders + tasks) against a
 * real DB. Drives actions through the real guard/dispatch (executeAction) exactly
 * as the `/do` router and MCP server will, asserting id-bearing results and that
 * access/arg guards fire.
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/actions.integration.test.ts
 */

const TG = 999000100;
let userId: number;
let tribeId: number;

type Guard = typeof import("../src/actions/guard.js");
type Registry = typeof import("../src/actions/registry.js");
type Ctx = import("../src/actions/types.js").ActionCtx;

let guard: Guard;
let registry: Registry;
let ctx: Ctx;

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();

  const { ensureUser } = await import("../src/expenses/repository.js");
  const user = await ensureUser(TG, "actiontest", "Action", "Tester", false);
  userId = user.id;
  tribeId = user.tribeId;

  guard = await import("../src/actions/guard.js");
  registry = await import("../src/actions/registry.js");
  ctx = { telegramId: TG, menu: { role: "user", status: "approved", hasTribe: true, tribeId, tribeName: null } };
});

after(async () => {
  const { db } = await import("../src/db/drizzle.js");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM task_works WHERE user_id = ${userId}`);
  await db.execute(sql`DELETE FROM reminders WHERE user_id = ${userId}`);
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

/** Run a registered action by name through the real guard, on the given ctx. */
async function run(name: string, args: unknown, on: Ctx = ctx): Promise<{ data: any }> {
  const action = registry.getAction(name);
  assert.ok(action, `action ${name} is registered`);
  return guard.executeAction(action!, on, args) as Promise<{ data: any }>;
}

describe("actions: reminders CRUD via dispatch", () => {
  let reminderId: number;

  it("creates a reminder and returns an id", async () => {
    const { data } = await run("reminders.create", {
      text: "Пить воду",
      schedule: { times: ["10:00"], weekdays: [1, 2, 3, 4, 5] },
    });
    assert.ok(data.id > 0);
    assert.equal(data.text, "Пить воду");
    assert.equal(data.isActive, true);
    reminderId = data.id;
  });

  it("lists reminders including the created one", async () => {
    const { data } = await run("reminders.list", {});
    assert.ok(Array.isArray(data));
    assert.ok(data.some((r: { id: number }) => r.id === reminderId));
  });

  it("toggles active state", async () => {
    const { data } = await run("reminders.toggle", { id: reminderId });
    assert.equal(data.isActive, false);
  });

  it("edits the text", async () => {
    const { data } = await run("reminders.edit", { id: reminderId, text: "Пить чай" });
    assert.equal(data.updated, true);
    const list = await run("reminders.list", {});
    assert.equal(list.data.find((r: { id: number }) => r.id === reminderId).text, "Пить чай");
  });

  it("deletes the reminder", async () => {
    const { data } = await run("reminders.delete", { id: reminderId });
    assert.equal(data.deleted, true);
    const list = await run("reminders.list", {});
    assert.equal(list.data.some((r: { id: number }) => r.id === reminderId), false);
  });
});

describe("actions: tasks CRUD via dispatch", () => {
  let workId: number;
  let itemId: number;

  it("creates a project", async () => {
    const { data } = await run("tasks.project.create", { name: "Ремонт", emoji: "🔧" });
    assert.ok(data.id > 0);
    workId = data.id;
  });

  it("adds a task item with a deadline", async () => {
    const { data } = await run("tasks.item.add", {
      workId,
      text: "Купить краску",
      deadline: "2026-08-01T18:00:00+03:00",
    });
    assert.ok(data.id > 0);
    assert.equal(data.isCompleted, false);
    itemId = data.id;
  });

  it("project.get shows the item", async () => {
    const { data } = await run("tasks.project.get", { id: workId });
    assert.equal(data.work.id, workId);
    assert.ok(data.tasks.some((t: { id: number }) => t.id === itemId));
  });

  it("toggles the item complete", async () => {
    const { data } = await run("tasks.item.toggle", { itemId });
    assert.equal(data.isCompleted, true);
  });

  it("edits the item text", async () => {
    const { data } = await run("tasks.item.setText", { itemId, text: "Купить эмаль" });
    assert.equal(data.text, "Купить эмаль");
  });

  it("deletes the item and the project", async () => {
    assert.equal((await run("tasks.item.delete", { itemId })).data.deleted, true);
    assert.equal((await run("tasks.project.delete", { id: workId })).data.deleted, true);
  });
});

describe("actions: guards", () => {
  it("denies a tribe-mode action when the user has no tribe", async () => {
    const noTribe: Ctx = { telegramId: TG, menu: { role: "user", status: "approved", hasTribe: false, tribeId: null, tribeName: null } };
    await assert.rejects(
      () => run("tasks.projects.list", {}, noTribe),
      (e: Error) => (e as { code?: string }).code === "ACCESS_DENIED",
    );
  });

  it("rejects invalid args with INVALID_ARGS", async () => {
    await assert.rejects(
      () => run("reminders.toggle", {}),
      (e: Error) => (e as { code?: string }).code === "INVALID_ARGS",
    );
  });

  it("registry filters actions by access (tasks hidden without tribe)", async () => {
    const withTribe = registry.getActions(ctx.menu).map((a) => a.name);
    assert.ok(withTribe.includes("reminders.create"));
    assert.ok(withTribe.includes("tasks.item.add"));

    const noTribeMenu = { role: "user" as const, status: "approved", hasTribe: false, tribeId: null, tribeName: null };
    const noTribe = registry.getActions(noTribeMenu).map((a) => a.name);
    assert.ok(noTribe.includes("reminders.create"));
    assert.ok(!noTribe.includes("tasks.item.add"));
  });
});
