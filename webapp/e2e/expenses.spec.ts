/**
 * Expenses page tests.
 * Tabs, report view, comparison (partial-month), drilldown, stats.
 */
import { test, expect, getComputedStyle, getComputedStyles } from "./fixtures";
import { MOCK_EXPENSE_REPORT, MOCK_COMPARISON_DRILLDOWN } from "./mock-data";

// The month header is derived from the current date in the app (defaults to the
// current calendar month), so compute the expected labels here instead of
// hardcoding a specific month — otherwise these tests rot every month.
const RU_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const RU_MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const NOW = new Date();
const CUR_M = NOW.getMonth();
const CUR_Y = NOW.getFullYear();
const PREV = new Date(CUR_Y, CUR_M - 1, 1);
const PREV_M = PREV.getMonth();
const PREV_Y = PREV.getFullYear();
const CUR_MONTH_LABEL = `${RU_MONTHS[CUR_M]} ${CUR_Y}`;
const PREV_MONTH_LABEL = `${RU_MONTHS[PREV_M]} ${PREV_Y}`;
const COMPARISON_DAY = MOCK_EXPENSE_REPORT.comparisonDay ?? 13;
const PARTIAL_LABEL = `1–${COMPARISON_DAY} ${RU_MONTHS_GENITIVE[CUR_M]} vs 1–${COMPARISON_DAY} ${RU_MONTHS_GENITIVE[PREV_M]}`;

test.describe("Expenses — Tab Navigation", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");
  });

  test("all tabs are visible", async ({ appPage }) => {
    const tabs = appPage.locator(".tab");
    const texts = await tabs.allTextContents();
    expect(texts).toEqual(
      expect.arrayContaining(["Отчёт", "Сравнение", "Статистика", "За год"])
    );
  });

  test("first tab (Отчёт) is active by default", async ({ appPage }) => {
    const firstTab = appPage.locator(".tab").first();
    await expect(firstTab).toHaveClass(/active/);
    await expect(firstTab).toContainText("Отчёт");
  });

  test("clicking tab switches view", async ({ appPage }) => {
    await appPage.locator(".tab", { hasText: "Сравнение" }).click();
    const compTab = appPage.locator(".tab", { hasText: "Сравнение" });
    await expect(compTab).toHaveClass(/active/);

    // Stat row should appear (comparison view)
    await expect(appPage.locator(".stat-row")).toBeVisible();
  });

  test("tabs have scroll CSS for overflow", async ({ appPage }) => {
    const styles = await getComputedStyles(appPage, ".tabs", [
      "overflow-x", "display", "gap",
    ]);
    // Should allow scrolling
    expect(["auto", "scroll"]).toContain(styles["overflow-x"]);
    expect(styles["display"]).toBe("flex");
  });
});

test.describe("Expenses — Report View", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".list");
  });

  test("shows category list with emoji and totals", async ({ appPage }) => {
    const headers = appPage.locator(".expense-cat-header");
    expect(await headers.count()).toBeGreaterThan(0);

    // First category (Продукты)
    const first = headers.first();
    await expect(first.locator(".list-item-emoji")).toContainText("🛒");
    await expect(first.locator(".list-item-title")).toContainText("Продукты");
  });

  test("category rows are clickable for drilldown", async ({ appPage }) => {
    const firstHeader = appPage.locator(".expense-cat-header").first();
    const cursor = await firstHeader.evaluate((el) => window.getComputedStyle(el).cursor);
    expect(cursor).toBe("pointer");
  });

  test("month navigation arrows work", async ({ appPage }) => {
    // Current month display (derived from the current date).
    const monthDisplay = appPage.locator(`text=${CUR_MONTH_LABEL}`);
    await expect(monthDisplay).toBeVisible();

    // Click left arrow
    const leftArrow = appPage.locator("button", { hasText: "◀" });
    await leftArrow.click();

    // Should show the previous month
    await expect(appPage.locator(`text=${PREV_MONTH_LABEL}`)).toBeVisible();
  });
});

test.describe("Expenses — Comparison View", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");
    await appPage.locator(".tab", { hasText: "Сравнение" }).click();
    await appPage.waitForSelector(".stat-row");
  });

  test("shows 3 stat cards: prev, current, diff", async ({ appPage }) => {
    const cards = appPage.locator(".stat-card");
    expect(await cards.count()).toBe(3);

    const hints = await appPage.locator(".stat-card .card-hint").allTextContents();
    expect(hints).toEqual(["Пред. месяц", "Текущий", "Разница"]);
  });

  test("shows partial-month label when comparisonDay is present", async ({ appPage }) => {
    // MOCK_EXPENSE_REPORT has comparisonDay: 13; the month names track the current date.
    const label = appPage.locator(`text=${PARTIAL_LABEL}`);
    await expect(label).toBeVisible();
  });

  test("comparison categories are clickable", async ({ appPage }) => {
    const items = appPage.locator(".list-item");
    expect(await items.count()).toBeGreaterThan(0);

    const cursor = await items.first().evaluate((el) => window.getComputedStyle(el).cursor);
    expect(cursor).toBe("pointer");
  });

  test("diff colors: red for increase, green for decrease", async ({ appPage }) => {
    // Маркетплейсы has positive diff (+2000) => red
    const marketRow = appPage.locator(".list-item", { hasText: "Маркетплейсы" });
    const diffEl = marketRow.locator("div[style]").last();
    const color = await diffEl.evaluate((el) => window.getComputedStyle(el).color);
    // rgb(229, 57, 53) = #e53935
    expect(color).toContain("229");

    // Продукты has negative diff (-5380) => green
    const groceryRow = appPage.locator(".list-item", { hasText: "Продукты" });
    const groceryDiff = groceryRow.locator("div[style]").last();
    const groceryColor = await groceryDiff.evaluate((el) => window.getComputedStyle(el).color);
    // rgb(67, 160, 71) = #43a047
    expect(groceryColor).toContain("67");
  });

  test("shows percentage change for categories", async ({ appPage }) => {
    // Продукты: 8680 → 3300, diff = -5380, pct = -62%
    const groceryRow = appPage.locator(".list-item", { hasText: "Продукты" });
    await expect(groceryRow).toContainText("-62%");
  });
});

test.describe("Expenses — Comparison Drilldown", () => {
  test("clicking comparison category opens drilldown", async ({ appPage, mockApi }) => {
    await mockApi({
      "GET /api/expenses/comparison-drilldown*": {
        body: { ok: true, data: MOCK_COMPARISON_DRILLDOWN },
      },
    });

    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");
    await appPage.locator(".tab", { hasText: "Сравнение" }).click();
    await appPage.waitForSelector(".list-item");

    // Click first category
    await appPage.locator(".list-item").first().click();

    // Should show drilldown with both months
    await expect(appPage.locator(`text=${CUR_MONTH_LABEL}`)).toBeVisible();
    await expect(appPage.locator(`text=${PREV_MONTH_LABEL}`)).toBeVisible();

    // Should show the comparison day label
    await expect(appPage.locator("text=/1–13/")).toBeVisible();

    // Back button
    await expect(appPage.locator("button", { hasText: "Назад" })).toBeVisible();
  });

  test("drilldown shows individual expenses", async ({ appPage, mockApi }) => {
    await mockApi({
      "GET /api/expenses/comparison-drilldown*": {
        body: { ok: true, data: MOCK_COMPARISON_DRILLDOWN },
      },
    });

    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");
    await appPage.locator(".tab", { hasText: "Сравнение" }).click();
    await appPage.waitForSelector(".list-item");
    await appPage.locator(".list-item").first().click();

    // Check expense items exist (may appear in both months)
    await expect(appPage.locator("text=Молоко").first()).toBeVisible();
    await expect(appPage.locator("text=Яйца").first()).toBeVisible();
  });

  test("back button returns to comparison view", async ({ appPage, mockApi }) => {
    await mockApi({
      "GET /api/expenses/comparison-drilldown*": {
        body: { ok: true, data: MOCK_COMPARISON_DRILLDOWN },
      },
    });

    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");
    await appPage.locator(".tab", { hasText: "Сравнение" }).click();
    await appPage.waitForSelector(".list-item");
    await appPage.locator(".list-item").first().click();

    await appPage.waitForSelector("button:has-text('Назад')");
    await appPage.locator("button", { hasText: "Назад" }).click();

    // Should be back to comparison
    await expect(appPage.locator(".stat-row")).toBeVisible();
  });
});

test.describe("Expenses — Full Month Comparison (past month)", () => {
  test("past month shows full comparison without partial label", async ({ appPage, mockApi }) => {
    const fullMonthReport = {
      ...MOCK_EXPENSE_REPORT,
      month: "2026-03",
      comparisonDay: undefined,
    };
    await mockApi({
      "GET /api/expenses/report*": {
        body: { ok: true, data: fullMonthReport },
      },
    });

    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");

    // Navigate to previous month
    await appPage.locator("button", { hasText: "◀" }).click();
    await appPage.locator(".tab", { hasText: "Сравнение" }).click();
    await appPage.waitForSelector(".stat-row");

    // No partial-month label
    const partialLabel = appPage.locator("text=/1–\\d+ .* vs 1–\\d+ /");
    expect(await partialLabel.count()).toBe(0);
  });
});
