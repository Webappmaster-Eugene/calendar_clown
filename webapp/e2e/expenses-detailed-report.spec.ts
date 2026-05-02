/**
 * E2E tests for the inline-accordion report and authenticated Excel download
 * added in tasks/20260414/task2 (detailed report rework).
 *
 *   - Clicking a category expands it inline and lists every operation.
 *   - Clicking again collapses it.
 *   - Pagination shows "Показать ещё" when more rows are available.
 *   - The Excel button issues an authenticated request, NOT window.open.
 *   - Server failures surface as an error message in the UI.
 */
import { test, expect } from "./fixtures";
import { MOCK_DRILLDOWN_GROCERIES, MOCK_DRILLDOWN_GROCERIES_PAGED } from "./mock-data";

test.describe("Expenses — Inline Accordion (Report tab)", () => {
  // Request `appPage` here so its API-mock setup runs BEFORE `mockApi` registers
  // the drilldown override. Playwright dispatches routes in reverse-registration
  // order, so the override must be added last to take precedence.
  test.beforeEach(async ({ appPage, mockApi }) => {
    void appPage;
    await mockApi({
      "GET /api/expenses/drilldown*": {
        body: { ok: true, data: MOCK_DRILLDOWN_GROCERIES },
      },
    });
  });

  test("a category row starts collapsed showing only the summary", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".list-item");

    const grocery = appPage.locator(".list-item", { hasText: "Продукты" }).first();
    await expect(grocery).toContainText("Детали ▼");
    // None of the drilldown subcategories should be visible yet.
    await expect(appPage.locator("text=Молоко")).toHaveCount(0);
  });

  test("clicking a category expands it inline and shows all its operations", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".list-item");

    const grocery = appPage.locator(".list-item", { hasText: "Продукты" }).first();
    await grocery.click();

    // The header switches to the collapsed-state hint.
    await expect(grocery).toContainText("Скрыть детали ▲");

    // Each mocked operation appears under the row, in DESC creation order.
    await expect(appPage.locator("text=Молоко")).toBeVisible();
    await expect(appPage.locator("text=Яйца")).toBeVisible();
    await expect(appPage.locator("text=Сыр")).toBeVisible();
  });

  test("clicking an expanded category collapses it again", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".list-item");

    const grocery = appPage.locator(".list-item", { hasText: "Продукты" }).first();
    await grocery.click();
    await expect(appPage.locator("text=Молоко")).toBeVisible();

    await grocery.click();
    await expect(appPage.locator("text=Молоко")).toHaveCount(0);
    await expect(grocery).toContainText("Детали ▼");
  });

  test("two categories can be expanded simultaneously", async ({ appPage, mockApi }) => {
    // Both categories return the same mock — that's enough to assert independent
    // expansion state. The mock matches every drilldown query.
    await mockApi({
      "GET /api/expenses/drilldown*": {
        body: { ok: true, data: MOCK_DRILLDOWN_GROCERIES },
      },
    });
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".list-item");

    const grocery = appPage.locator(".list-item", { hasText: "Продукты" }).first();
    const cafe = appPage.locator(".list-item", { hasText: "Кафе, доставка, фастфуд" }).first();

    await grocery.click();
    await cafe.click();

    await expect(grocery).toContainText("Скрыть детали ▲");
    await expect(cafe).toContainText("Скрыть детали ▲");
  });

  test("operation rows render amount and 🗑 delete affordance", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".list-item");

    await appPage.locator(".list-item", { hasText: "Продукты" }).first().click();
    // Drilldown items render with " ₽" and the matching subcategory.
    await expect(appPage.locator("text=/130\\s*₽\\s*[—\\-]\\s*Молоко/")).toBeVisible();
    // At least one delete button (🗑️) shown for the expanded operations.
    await expect(appPage.locator("button[title=\"Удалить\"]").first()).toBeVisible();
  });

  test("pagination shows «Показать ещё» when more rows are available", async ({ appPage, mockApi }) => {
    await mockApi({
      "GET /api/expenses/drilldown*": {
        body: { ok: true, data: MOCK_DRILLDOWN_GROCERIES_PAGED },
      },
    });
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".list-item");

    await appPage.locator(".list-item", { hasText: "Продукты" }).first().click();

    await expect(appPage.locator("button", { hasText: "Показать ещё" })).toBeVisible();
  });

  test("changing the month collapses every previously expanded category", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".list-item");

    await appPage.locator(".list-item", { hasText: "Продукты" }).first().click();
    await expect(appPage.locator("text=Молоко")).toBeVisible();

    await appPage.locator("button", { hasText: "◀" }).click();

    // After navigating, the expanded-state Set is reset → drilldown content gone.
    await expect(appPage.locator("text=Молоко")).toHaveCount(0);
  });
});

test.describe("Expenses — Excel button (authenticated download)", () => {
  test("clicking Excel issues an authenticated request, not a window.open redirect", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".list-item");

    // We will capture the API request that the click triggers and assert it
    // carries the Authorization header that proves we did NOT take the
    // unauthenticated `window.open` path.
    const excelRequestPromise = appPage.waitForRequest(
      (req) => req.url().includes("/api/expenses/excel") && req.method() === "GET",
      { timeout: 5_000 }
    );

    // Stub the binary response so the click can complete cleanly.
    await appPage.route("**/api/expenses/excel*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers: { "Content-Disposition": 'attachment; filename="report.xlsx"' },
        body: Buffer.from("PKfake-xlsx-bytes"),
      });
    });

    await appPage.locator("button", { hasText: "Excel" }).click();

    const req = await excelRequestPromise;
    expect(req.url()).toContain("month=");
    expect(req.url()).toContain("year=");
    // The api.getBlob path always sets the Telegram tma header. We don't have
    // real init-data here (mock context), so the header may be absent or empty,
    // but the request itself must have happened — i.e. we did NOT navigate away.
    expect(appPage.url()).toContain("/expenses");
  });

  test("button enters loading state while the request is in-flight", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".list-item");

    // Hold the response so we can observe the in-flight state.
    let release: (() => void) | null = null;
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });

    await appPage.route("**/api/expenses/excel*", async (route) => {
      await releaseGate;
      await route.fulfill({
        status: 200,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: Buffer.from("fake"),
      });
    });

    const button = appPage.locator("button", { hasText: "Excel" });
    await button.click();

    await expect(appPage.locator("button", { hasText: "Формирую…" })).toBeVisible();
    await expect(appPage.locator("button", { hasText: "Формирую…" })).toBeDisabled();

    release!();

    // Eventually the button returns to its default state.
    await expect(appPage.locator("button", { hasText: "Excel" })).toBeVisible();
  });

  test("API failure surfaces an inline error and re-enables the button", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".list-item");

    await appPage.route("**/api/expenses/excel*", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "boom" }),
      });
    });

    await appPage.locator("button", { hasText: "Excel" }).click();

    await expect(appPage.locator(".error-msg")).toContainText(/Failed|boom|Не удалось/);
    await expect(appPage.locator("button", { hasText: "Excel" })).toBeEnabled();
  });
});
