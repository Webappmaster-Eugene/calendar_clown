import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for the expense repository.
 * Run with: npx tsx --test tests/repository.test.ts
 *
 * Requires DATABASE_URL pointing to a PostgreSQL instance.
 */

let ensureUser: typeof import("../src/expenses/repository.js").ensureUser;
let addExpense: typeof import("../src/expenses/repository.js").addExpense;
let deleteExpense: typeof import("../src/expenses/repository.js").deleteExpense;
let getLastExpense: typeof import("../src/expenses/repository.js").getLastExpense;
let getMonthTotal: typeof import("../src/expenses/repository.js").getMonthTotal;
let getCategoryTotals: typeof import("../src/expenses/repository.js").getCategoryTotals;
let getCategories: typeof import("../src/expenses/repository.js").getCategories;
let isUserInDb: typeof import("../src/expenses/repository.js").isUserInDb;
let getUserMode: typeof import("../src/expenses/repository.js").getUserMode;
let setUserMode: typeof import("../src/expenses/repository.js").setUserMode;

const TEST_TELEGRAM_ID = 999999999;

before(async () => {
  const dotenv = await import("dotenv");
  dotenv.config();
  dotenv.config({ path: ".env.local", override: true });

  const { runMigrations } = await import("../src/db/migrate.js");
  await runMigrations();

  const repo = await import("../src/expenses/repository.js");
  ensureUser = repo.ensureUser;
  addExpense = repo.addExpense;
  deleteExpense = repo.deleteExpense;
  getLastExpense = repo.getLastExpense;
  getMonthTotal = repo.getMonthTotal;
  getCategoryTotals = repo.getCategoryTotals;
  getCategories = repo.getCategories;
  isUserInDb = repo.isUserInDb;
  getUserMode = repo.getUserMode;
  setUserMode = repo.setUserMode;
});

after(async () => {
  // Cleanup test user and their expenses
  const { query } = await import("../src/db/connection.js");
  await query("DELETE FROM expenses WHERE user_id IN (SELECT id FROM users WHERE telegram_id = $1)", [TEST_TELEGRAM_ID]);
  await query("DELETE FROM users WHERE telegram_id = $1", [TEST_TELEGRAM_ID]);

  const { closePool } = await import("../src/db/connection.js");
  await closePool();
});

describe("ensureUser", () => {
  it("creates a new user", async () => {
    const user = await ensureUser(TEST_TELEGRAM_ID, "testuser", "Test", "User", false);
    assert.equal(user.telegramId, TEST_TELEGRAM_ID);
    assert.equal(user.firstName, "Test");
    assert.equal(user.role, "user");
    assert.ok(user.id > 0);
    assert.ok(user.tribeId > 0);
  });

  it("returns existing user on second call", async () => {
    const user = await ensureUser(TEST_TELEGRAM_ID, "testuser2", "Test2", null, false);
    assert.equal(user.telegramId, TEST_TELEGRAM_ID);
    assert.equal(user.firstName, "Test2"); // Updated
  });
});

describe("isUserInDb", () => {
  it("returns true for existing user", async () => {
    assert.equal(await isUserInDb(TEST_TELEGRAM_ID), true);
  });

  it("returns false for non-existing user", async () => {
    assert.equal(await isUserInDb(111111111), false);
  });
});

describe("user mode", () => {
  it("defaults to calendar", async () => {
    const mode = await getUserMode(TEST_TELEGRAM_ID);
    assert.equal(mode, "calendar");
  });

  it("can be set to expenses", async () => {
    await setUserMode(TEST_TELEGRAM_ID, "expenses");
    const mode = await getUserMode(TEST_TELEGRAM_ID);
    assert.equal(mode, "expenses");
  });

  it("can be set back to calendar", async () => {
    await setUserMode(TEST_TELEGRAM_ID, "calendar");
    const mode = await getUserMode(TEST_TELEGRAM_ID);
    assert.equal(mode, "calendar");
  });
});

describe("addExpense", () => {
  it("inserts an expense with correct parameter order", async () => {
    const user = await ensureUser(TEST_TELEGRAM_ID, "testuser", "Test", null, false);
    const categories = await getCategories();
    const cat = categories[0];

    const expense = await addExpense(user.id, user.tribeId, cat.id, 1500, "Тестовая подкатегория", "text");
    assert.ok(expense.id > 0);
    assert.equal(expense.amount, 1500);
    assert.equal(expense.subcategory, "Тестовая подкатегория");
    assert.equal(expense.inputMethod, "text");
  });

  it("inserts expense with null subcategory", async () => {
    const user = await ensureUser(TEST_TELEGRAM_ID, "testuser", "Test", null, false);
    const categories = await getCategories();
    const cat = categories[0];

    const expense = await addExpense(user.id, user.tribeId, cat.id, 500, null, "text");
    assert.equal(expense.subcategory, null);
    assert.equal(expense.amount, 500);
  });

  it("rejects amount below minimum", async () => {
    const user = await ensureUser(TEST_TELEGRAM_ID, "testuser", "Test", null, false);
    const categories = await getCategories();
    const cat = categories[0];

    await assert.rejects(
      () => addExpense(user.id, user.tribeId, cat.id, 0, null, "text"),
      { message: /Сумма должна быть от/ }
    );
  });

  it("rejects amount above maximum", async () => {
    const user = await ensureUser(TEST_TELEGRAM_ID, "testuser", "Test", null, false);
    const categories = await getCategories();
    const cat = categories[0];

    await assert.rejects(
      () => addExpense(user.id, user.tribeId, cat.id, 99_999_999, null, "text"),
      { message: /Сумма должна быть от/ }
    );
  });

  it("truncates long subcategory", async () => {
    const user = await ensureUser(TEST_TELEGRAM_ID, "testuser", "Test", null, false);
    const categories = await getCategories();
    const cat = categories[0];

    const longSub = "A".repeat(300);
    const expense = await addExpense(user.id, user.tribeId, cat.id, 100, longSub, "text");
    assert.ok(expense.subcategory!.length <= 200);
  });
});

describe("deleteExpense", () => {
  it("deletes own expense", async () => {
    const user = await ensureUser(TEST_TELEGRAM_ID, "testuser", "Test", null, false);
    const categories = await getCategories();
    const expense = await addExpense(user.id, user.tribeId, categories[0].id, 200, null, "text");

    const deleted = await deleteExpense(expense.id, user.id);
    assert.equal(deleted, true);
  });

  it("refuses to delete non-existent expense", async () => {
    const user = await ensureUser(TEST_TELEGRAM_ID, "testuser", "Test", null, false);
    const deleted = await deleteExpense(999999, user.id);
    assert.equal(deleted, false);
  });
});

describe("getLastExpense", () => {
  it("returns the most recent expense", async () => {
    const user = await ensureUser(TEST_TELEGRAM_ID, "testuser", "Test", null, false);
    const categories = await getCategories();
    await addExpense(user.id, user.tribeId, categories[0].id, 300, "Первая", "text");
    await addExpense(user.id, user.tribeId, categories[0].id, 700, "Вторая", "text");

    const last = await getLastExpense(user.id);
    assert.notEqual(last, null);
    assert.equal(last!.amount, 700);
    assert.equal(last!.subcategory, "Вторая");
  });
});

describe("getMonthTotal", () => {
  it("returns total for current month", async () => {
    const user = await ensureUser(TEST_TELEGRAM_ID, "testuser", "Test", null, false);
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const total = await getMonthTotal(user.tribeId, year, month);
    assert.ok(total >= 0);
    assert.equal(typeof total, "number");
  });
});
