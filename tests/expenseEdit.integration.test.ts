import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for editing an already-saved expense — the "move to another
 * category" capability surfaced in the bot (🔀 in "Последние") and the Mini App
 * (MoveCategoryRow), plus the general edit contract. Hits a live PostgreSQL.
 *
 * What is locked in here:
 *   - editExpense changes category_id and returns fresh categoryName/emoji;
 *   - editing amount / subcategory / createdAt works and stamps updated_at;
 *   - ownership is enforced (another user, or an unknown id, returns null);
 *   - an empty update is a no-op (null), not an accidental write;
 *   - the category-filtered drilldown reflects a move (gone from the old category,
 *     present in the new one);
 *   - getCategoryDtos exposes the current reference set — which also guards that
 *     migrations 0006–0009 actually applied (new categories, descriptions, and the
 *     Domyland brand aliases that route bank pushes to ЖКХ).
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/expenseEdit.integration.test.ts
 */

const TG = 999_000_090; // owner
const TG_OTHER = 999_000_091; // a different user, for the ownership check

// Far-future window so drilldown queries never collide with real/other test data.
const YEAR = 2099;
const MONTH = 7; // 1-based; July
const IN_WINDOW = new Date(Date.UTC(YEAR, MONTH - 1, 15));

let svc: typeof import("../src/services/expenseService.js");
let repo: typeof import("../src/expenses/repository.js");
let db: typeof import("../src/db/drizzle.js").db;
let schema: typeof import("../src/db/schema.js");
let query: typeof import("../src/db/connection.js").query;

let userId: number;
let tribeId: number;
let otherUserId: number;
let catByName: Map<string, { id: number; emoji: string }>;

async function clearExpenses() {
  await query("DELETE FROM expenses WHERE user_id IN ($1, $2)", [userId, otherUserId]);
}

before(async () => {
  (await import("dotenv")).config(); // base .env only — never load prod .env.local

  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb(); // applies ALL migrations, incl. 0006–0009 (new cats, descriptions, brand aliases)
  await seedFixtures();

  svc = await import("../src/services/expenseService.js");
  repo = await import("../src/expenses/repository.js");
  db = (await import("../src/db/drizzle.js")).db;
  schema = await import("../src/db/schema.js");
  query = (await import("../src/db/connection.js")).query;

  const owner = await repo.ensureUser(TG, "editowner", "Edit", "Owner", false);
  userId = owner.id;
  tribeId = owner.tribeId!;
  const other = await repo.ensureUser(TG_OTHER, "editother", "Edit", "Other", false);
  otherUserId = other.id;
  await query("UPDATE users SET status = 'approved' WHERE id IN ($1, $2)", [userId, otherUserId]);

  const cats = await repo.getCategories();
  catByName = new Map(cats.map((c) => [c.name, { id: c.id, emoji: c.emoji }]));
});

beforeEach(async () => {
  await clearExpenses();
});

after(async () => {
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await clearExpenses();
  await cleanupTestUser(TG);
  await cleanupTestUser(TG_OTHER);
  await closeTestDb();
});

/** Insert an owned expense in the test window and return its id. */
async function addOwned(categoryName: string, amount: number, subcategory: string | null): Promise<number> {
  const cat = catByName.get(categoryName);
  assert.ok(cat, `missing category ${categoryName}`);
  const row = await repo.addExpense(userId, tribeId, cat!.id, amount, subcategory, "text", IN_WINDOW);
  return row.id;
}

describe("editExpense — move category", () => {
  it("moves an expense to another category and returns the fresh category name/emoji", async () => {
    const id = await addOwned("Продукты", 500, "по ошибке сюда");
    const target = catByName.get("Кафе, доставка, фастфуд")!;

    const res = await svc.editExpense(TG, id, { categoryId: target.id });

    assert.ok(res, "editExpense must return the updated DTO");
    assert.equal(res!.categoryId, target.id);
    assert.equal(res!.categoryName, "Кафе, доставка, фастфуд");
    assert.equal(res!.categoryEmoji, target.emoji);
    // The subcategory/amount are untouched by a pure category move.
    assert.equal(res!.subcategory, "по ошибке сюда");
    assert.equal(res!.amount, 500);

    // The persisted row really changed category and got an updated_at stamp.
    const { eq } = await import("drizzle-orm");
    const [dbRow] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, id));
    assert.equal(dbRow.categoryId, target.id);
    assert.ok(dbRow.updatedAt instanceof Date, "updated_at must be stamped on edit");
  });

  it("edits amount and subcategory together", async () => {
    const id = await addOwned("Продукты", 100, "старое");
    const res = await svc.editExpense(TG, id, { amount: 250.5, subcategory: "новое" });
    assert.ok(res);
    assert.equal(res!.amount, 250.5);
    assert.equal(res!.subcategory, "новое");
    assert.equal(res!.categoryName, "Продукты"); // category unchanged
  });

  it("clears the subcategory when set to null", async () => {
    const id = await addOwned("Продукты", 100, "было описание");
    const res = await svc.editExpense(TG, id, { subcategory: null });
    assert.ok(res);
    assert.equal(res!.subcategory, null);
  });

  it("backdates an expense via createdAt", async () => {
    const id = await addOwned("Продукты", 100, "x");
    const newDate = new Date(Date.UTC(YEAR, MONTH - 2, 3, 9, 0, 0)); // previous month
    const res = await svc.editExpense(TG, id, { createdAt: newDate });
    assert.ok(res);
    assert.equal(new Date(res!.createdAt).toISOString(), newDate.toISOString());
  });

  it("returns null for an empty update (no accidental write)", async () => {
    const id = await addOwned("Продукты", 100, "x");
    const res = await svc.editExpense(TG, id, {});
    assert.equal(res, null);
  });

  it("returns null for an unknown expense id", async () => {
    const res = await svc.editExpense(TG, 2_147_483_600, { amount: 10 });
    assert.equal(res, null);
  });

  it("refuses to edit another user's expense (ownership)", async () => {
    const id = await addOwned("Продукты", 100, "чужое");
    const target = catByName.get("Такси")!;

    // TG_OTHER is not the owner → must be rejected, and the row must stay put.
    const res = await svc.editExpense(TG_OTHER, id, { categoryId: target.id });
    assert.equal(res, null);

    const { eq } = await import("drizzle-orm");
    const [dbRow] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, id));
    assert.equal(dbRow.categoryId, catByName.get("Продукты")!.id, "row must not have moved");
  });
});

describe("category-filtered drilldown reflects a move", () => {
  it("the moved expense leaves the old category and appears in the new one", async () => {
    const from = catByName.get("Продукты")!;
    const to = catByName.get("Такси")!;
    const id = await addOwned("Продукты", 777, "маркер перемещения");

    // Present in the source category before the move.
    const before = await svc.getCategoryDrilldown(TG, from.id, YEAR, MONTH, 50, 0);
    assert.ok(before.expenses.some((e) => e.id === id), "expense should start in Продукты");

    await svc.editExpense(TG, id, { categoryId: to.id });

    const oldAfter = await svc.getCategoryDrilldown(TG, from.id, YEAR, MONTH, 50, 0);
    const newAfter = await svc.getCategoryDrilldown(TG, to.id, YEAR, MONTH, 50, 0);
    assert.ok(!oldAfter.expenses.some((e) => e.id === id), "must be gone from Продукты");
    assert.ok(newAfter.expenses.some((e) => e.id === id), "must show up in Такси");
    assert.equal(newAfter.categoryName, "Такси");
  });
});

describe("getCategoryDtos — reference set (guards migrations 0006–0009)", () => {
  it("includes the new categories with non-empty descriptions", async () => {
    const dtos = await svc.getCategoryDtos();
    const byName = new Map(dtos.map((d) => [d.name, d]));
    for (const name of ["Одежда и обувь", "Товары для красоты", "Помощь родителям", "Дача"]) {
      const d = byName.get(name);
      assert.ok(d, `new category "${name}" must exist (migrations 0006/0007)`);
      assert.ok(d!.description && d!.description.trim().length > 0, `"${name}" must have a description (0008)`);
    }
    // "Массаж" was folded into Услуги and removed by 0007.
    assert.ok(!byName.has("Массаж"), "Массаж must be gone (0007)");
  });

  it("marks built-in categories as non-deletable", async () => {
    const dtos = await svc.getCategoryDtos();
    const produkty = dtos.find((d) => d.name === "Продукты");
    assert.ok(produkty);
    assert.equal(produkty!.canDelete, false, "seeded built-ins have createdByUserId=null → not deletable");
  });

  it("carries the Domyland brand aliases on ЖКХ (routes bank pushes there — 0009)", async () => {
    const dtos = await svc.getCategoryDtos();
    const zhkh = dtos.find((d) => d.name === "ЖКХ");
    assert.ok(zhkh);
    for (const alias of ["domyland", "ypdomylandsbp"]) {
      assert.ok(zhkh!.aliases.includes(alias), `ЖКХ must carry the "${alias}" alias`);
    }
  });
});
