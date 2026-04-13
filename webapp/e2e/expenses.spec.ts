/**
 * Expenses page tests.
 * Tabs, report view, comparison (partial-month), drilldown, stats.
 */
import { test, expect, getComputedStyle, getComputedStyles } from "./fixtures";
import { MOCK_EXPENSE_REPORT, MOCK_COMPARISON_DRILLDOWN } from "./mock-data";

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
    const items = appPage.locator(".list-item");
    expect(await items.count()).toBeGreaterThan(0);

    // First category (Продукты)
    const first = items.first();
    await expect(first.locator(".list-item-emoji")).toContainText("🛒");
    await expect(first.locator(".list-item-title")).toContainText("Продукты");
  });

  test("category rows are clickable for drilldown", async ({ appPage }) => {
    const firstItem = appPage.locator(".list-item").first();
    const cursor = await firstItem.evaluate((el) => window.getComputedStyle(el).cursor);
    expect(cursor).toBe("pointer");
  });

  test("month navigation arrows work", async ({ appPage }) => {
    // Find month display
    const monthDisplay = appPage.locator("text=Апрель 2026");
    await expect(monthDisplay).toBeVisible();

    // Click left arrow
    const leftArrow = appPage.locator("button", { hasText: "◀" });
    await leftArrow.click();

    // Should show March
    await expect(appPage.locator("text=Март 2026")).toBeVisible();
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
    // MOCK_EXPENSE_REPORT has comparisonDay: 13
    const label = appPage.locator("text=/1–13 апреля vs 1–13 марта/");
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
    await expect(appPage.locator("text=Апрель 2026")).toBeVisible();
    await expect(appPage.locator("text=Март 2026")).toBeVisible();

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
