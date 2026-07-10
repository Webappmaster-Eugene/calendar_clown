/**
 * Integration tests for the detailed monthly report path:
 *   - repository.getAllExpensesForReport
 *   - service.getMonthReport(..., includeDetails: true)
 *
 * Hits a live PostgreSQL — DATABASE_URL must be set, same convention as
 * tests/repository.test.ts. Test data is isolated under TEST_TELEGRAM_ID
 * and torn down in `after`.
 *
 * Run with:  npx tsx --test tests/expenseDetailedReport.integration.test.ts
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

let ensureUser: typeof import("../src/expenses/repository.js").ensureUser;
let addExpense: typeof import("../src/expenses/repository.js").addExpense;
let getCategories: typeof import("../src/expenses/repository.js").getCategories;
let getAllExpensesForReport: typeof import("../src/expenses/repository.js").getAllExpensesForReport;
let getMonthReport: typeof import("../src/services/expenseService.js").getMonthReport;
let query: typeof import("../src/db/connection.js").query;
let closePool: typeof import("../src/db/connection.js").closePool;

const TEST_TELEGRAM_ID = 999_999_991;

// Test month is intentionally far in the future to avoid colliding with real
// data while still being reachable through the service layer's date math.
const TEST_YEAR = 2099;
const TEST_MONTH = 6;
// addExpense defaults created_at to NOW(); tests query the TEST_YEAR/MONTH window,
// so expenses must be stamped inside it (a far-future month avoids colliding with real data).
const IN_WINDOW = new Date(Date.UTC(TEST_YEAR, TEST_MONTH - 1, 15));

let userId: number;
let tribeId: number;
let category1Id: number;
let category2Id: number;
let category1SortOrder: number;
let category2SortOrder: number;

async function clearTestExpenses() {
  await query("DELETE FROM expenses WHERE user_id = $1", [userId]);
}

before(async () => {
  (await import("dotenv")).config(); // base .env only — never load prod .env.local into integration tests

  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();

  const repo = await import("../src/expenses/repository.js");
  ensureUser = repo.ensureUser;
  addExpense = repo.addExpense;
  getCategories = repo.getCategories;
  getAllExpensesForReport = repo.getAllExpensesForReport;

  const svc = await import("../src/services/expenseService.js");
  getMonthReport = svc.getMonthReport;

  const conn = await import("../src/db/connection.js");
  query = conn.query;
  closePool = conn.closePool;

  // Seed a user and capture two categories ordered by sortOrder.
  const user = await ensureUser(TEST_TELEGRAM_ID, "detail-test", "Детально", null, false);
  userId = user.id;
  tribeId = user.tribeId!;
  // Approve so that getMonthReport's user-status checks (if any in the future) pass.
  await query("UPDATE users SET status = 'approved' WHERE id = $1", [userId]);

  const cats = await getCategories();
  // Pick the two categories with the smallest sortOrder for deterministic
  // expectations (the seed order from the production schema is stable).
  const sorted = [...cats].sort((a, b) => a.sortOrder - b.sortOrder);
  category1Id = sorted[0].id;
  category1SortOrder = sorted[0].sortOrder;
  category2Id = sorted[1].id;
  category2SortOrder = sorted[1].sortOrder;
});

beforeEach(async () => {
  await clearTestExpenses();
});

after(async () => {
  await clearTestExpenses();
  await query("DELETE FROM users WHERE telegram_id = $1", [TEST_TELEGRAM_ID]);
  await closePool();
});

// ─── repository.getAllExpensesForReport ───────────────────────────────

describe("getAllExpensesForReport", () => {
  it("returns expenses across the period sorted by category sortOrder, then createdAt DESC", async () => {
    const dateFrom = new Date(Date.UTC(TEST_YEAR, TEST_MONTH - 1, 1));
    const dateTo = new Date(Date.UTC(TEST_YEAR, TEST_MONTH, 1));

    // Insert into both categories to verify cross-category ordering.
    await addExpense(userId, tribeId, category2Id, 200, "вторая категория, ранее", "text", IN_WINDOW);
    await addExpense(userId, tribeId, category1Id, 100, "первая категория, ранее", "text", IN_WINDOW);
    await addExpense(userId, tribeId, category1Id, 150, "первая категория, позже", "text", IN_WINDOW);
    await addExpense(userId, tribeId, category2Id, 250, "вторая категория, позже", "text", IN_WINDOW);

    // Backdate two of them inside the test month so the createdAt ordering is observable.
    await query(
      "UPDATE expenses SET created_at = $1 WHERE user_id = $2 AND subcategory = $3",
      [new Date(Date.UTC(TEST_YEAR, TEST_MONTH - 1, 5, 10, 0, 0)).toISOString(), userId, "первая категория, ранее"]
    );
    await query(
      "UPDATE expenses SET created_at = $1 WHERE user_id = $2 AND subcategory = $3",
      [new Date(Date.UTC(TEST_YEAR, TEST_MONTH - 1, 20, 10, 0, 0)).toISOString(), userId, "первая категория, позже"]
    );
    await query(
      "UPDATE expenses SET created_at = $1 WHERE user_id = $2 AND subcategory = $3",
      [new Date(Date.UTC(TEST_YEAR, TEST_MONTH - 1, 7, 10, 0, 0)).toISOString(), userId, "вторая категория, ранее"]
    );
    await query(
      "UPDATE expenses SET created_at = $1 WHERE user_id = $2 AND subcategory = $3",
      [new Date(Date.UTC(TEST_YEAR, TEST_MONTH - 1, 25, 10, 0, 0)).toISOString(), userId, "вторая категория, позже"]
    );

    const rows = await getAllExpensesForReport(tribeId, dateFrom, dateTo);

    // Category 1 has lower sortOrder, so its rows should appear first.
    // Within a category, newer first.
    const cat1Rows = rows.filter((r) => r.categoryId === category1Id);
    const cat2Rows = rows.filter((r) => r.categoryId === category2Id);

    assert.equal(cat1Rows.length, 2);
    assert.equal(cat2Rows.length, 2);

    assert.equal(cat1Rows[0].subcategory, "первая категория, позже");
    assert.equal(cat1Rows[1].subcategory, "первая категория, ранее");
    assert.equal(cat2Rows[0].subcategory, "вторая категория, позже");
    assert.equal(cat2Rows[1].subcategory, "вторая категория, ранее");

    // Verify cross-category ordering: all of category-1 rows precede category-2 rows
    // (because category1SortOrder < category2SortOrder).
    if (category1SortOrder < category2SortOrder) {
      const lastCat1Index = rows.lastIndexOf(cat1Rows[cat1Rows.length - 1]);
      const firstCat2Index = rows.indexOf(cat2Rows[0]);
      assert.ok(lastCat1Index < firstCat2Index, "category 1 rows must precede category 2 rows");
    }
  });

  it("excludes expenses outside the requested date range", async () => {
    const dateFrom = new Date(Date.UTC(TEST_YEAR, TEST_MONTH - 1, 1));
    const dateTo = new Date(Date.UTC(TEST_YEAR, TEST_MONTH, 1));

    // Inside the window
    await addExpense(userId, tribeId, category1Id, 100, "in-range", "text", IN_WINDOW);
    // Force one of them to before the window
    await addExpense(userId, tribeId, category1Id, 200, "out-of-range", "text", IN_WINDOW);
    await query(
      "UPDATE expenses SET created_at = $1 WHERE user_id = $2 AND subcategory = $3",
      [new Date(Date.UTC(TEST_YEAR - 1, 0, 1)).toISOString(), userId, "out-of-range"]
    );

    const rows = await getAllExpensesForReport(tribeId, dateFrom, dateTo);
    const subs = rows.map((r) => r.subcategory);
    assert.ok(subs.includes("in-range"));
    assert.ok(!subs.includes("out-of-range"));
  });

  it("returns an empty array for an empty period", async () => {
    const dateFrom = new Date(Date.UTC(TEST_YEAR, TEST_MONTH - 1, 1));
    const dateTo = new Date(Date.UTC(TEST_YEAR, TEST_MONTH, 1));

    const rows = await getAllExpensesForReport(tribeId, dateFrom, dateTo);
    assert.deepEqual(rows, []);
  });

  it("parses amount as a number and includes firstName from the JOIN", async () => {
    const dateFrom = new Date(Date.UTC(TEST_YEAR, TEST_MONTH - 1, 1));
    const dateTo = new Date(Date.UTC(TEST_YEAR, TEST_MONTH, 1));

    await addExpense(userId, tribeId, category1Id, 1234.56, "money", "text", IN_WINDOW);
    const rows = await getAllExpensesForReport(tribeId, dateFrom, dateTo);

    assert.equal(rows.length, 1);
    assert.equal(typeof rows[0].amount, "number");
    assert.equal(rows[0].amount, 1234.56);
    assert.equal(rows[0].firstName, "Детально");
    assert.ok(rows[0].createdAt instanceof Date);
  });
});

// ─── service.getMonthReport(..., includeDetails) ──────────────────────

describe("getMonthReport — includeDetails contract", () => {
  it("does NOT populate byCategoryDetailed when includeDetails is false (default)", async () => {
    await addExpense(userId, tribeId, category1Id, 500, "x", "text", IN_WINDOW);

    const report = await getMonthReport(TEST_TELEGRAM_ID, TEST_YEAR, TEST_MONTH);
    assert.equal(report.byCategoryDetailed, undefined);
    // The summary fields must still be present.
    assert.ok(report.byCategory.length >= 1);
    assert.equal(report.total, 500);
  });

  it("populates byCategoryDetailed only for categories that have expenses, in the same order as byCategory", async () => {
    // Two expenses in cat1, one in cat2.
    await addExpense(userId, tribeId, category1Id, 100, "cat1-a", "text", IN_WINDOW);
    await addExpense(userId, tribeId, category1Id, 200, "cat1-b", "text", IN_WINDOW);
    await addExpense(userId, tribeId, category2Id, 300, "cat2", "text", IN_WINDOW);

    const report = await getMonthReport(TEST_TELEGRAM_ID, TEST_YEAR, TEST_MONTH, true);

    assert.ok(report.byCategoryDetailed, "byCategoryDetailed should be defined");
    // byCategory only lists categories with > 0 total, so the lengths must match.
    assert.equal(report.byCategoryDetailed!.length, report.byCategory.length);

    // Order must match byCategory (sortOrder ASC).
    for (let i = 0; i < report.byCategory.length; i++) {
      assert.equal(
        report.byCategoryDetailed![i].categoryId,
        report.byCategory[i].categoryId,
        `byCategoryDetailed[${i}] and byCategory[${i}] must reference the same categoryId`
      );
    }

    const cat1Detail = report.byCategoryDetailed!.find((d) => d.categoryId === category1Id);
    const cat2Detail = report.byCategoryDetailed!.find((d) => d.categoryId === category2Id);

    assert.ok(cat1Detail);
    assert.ok(cat2Detail);
    assert.equal(cat1Detail!.expenses.length, 2);
    assert.equal(cat2Detail!.expenses.length, 1);

    // ExpenseDetailItemDto shape: createdAt is ISO string (not Date) so the DTO
    // can cross the API boundary cleanly.
    for (const e of [...cat1Detail!.expenses, ...cat2Detail!.expenses]) {
      assert.equal(typeof e.id, "number");
      assert.equal(typeof e.amount, "number");
      assert.equal(typeof e.firstName, "string");
      assert.equal(typeof e.createdAt, "string");
      assert.match(e.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("returns empty byCategoryDetailed when the month has no expenses", async () => {
    const report = await getMonthReport(TEST_TELEGRAM_ID, TEST_YEAR, TEST_MONTH, true);
    assert.deepEqual(report.byCategoryDetailed, []);
    assert.equal(report.byCategory.length, 0);
    assert.equal(report.total, 0);
  });

  it("passing includeDetails=true does not change summary fields vs default call", async () => {
    await addExpense(userId, tribeId, category1Id, 700, "consistency", "text", IN_WINDOW);

    const [reportPlain, reportDetailed] = await Promise.all([
      getMonthReport(TEST_TELEGRAM_ID, TEST_YEAR, TEST_MONTH, false),
      getMonthReport(TEST_TELEGRAM_ID, TEST_YEAR, TEST_MONTH, true),
    ]);

    assert.equal(reportPlain.total, reportDetailed.total);
    assert.equal(reportPlain.byCategory.length, reportDetailed.byCategory.length);
    for (let i = 0; i < reportPlain.byCategory.length; i++) {
      assert.deepEqual(reportPlain.byCategory[i], reportDetailed.byCategory[i]);
    }
    // Only difference: detailed run carries byCategoryDetailed.
    assert.equal(reportPlain.byCategoryDetailed, undefined);
    assert.ok(reportDetailed.byCategoryDetailed);
  });
});
