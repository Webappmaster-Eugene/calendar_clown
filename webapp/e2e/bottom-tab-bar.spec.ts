/**
 * Bottom quick-switch bar (P2 UX).
 * Verifies the bar shows recent modes for fast switching, is hidden on the
 * root grid, and is suppressed on the chat route (which owns the bottom edge).
 */
import { test, expect } from "./fixtures";

test.describe("Bottom quick-switch bar", () => {
  test("is absent on the root mode grid", async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".mode-grid");
    await expect(appPage.locator(".bottom-tab-bar")).toHaveCount(0);
  });

  test("appears on a mode page with a Режимы shortcut", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".bottom-tab-bar");
    await expect(appPage.locator(".bottom-tab", { hasText: "Режимы" })).toBeVisible();
  });

  test("Режимы shortcut returns to the root grid", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".bottom-tab-bar");
    await appPage.locator(".bottom-tab", { hasText: "Режимы" }).click();
    await appPage.waitForURL(/\/$/);
    await expect(appPage.locator(".mode-grid")).toBeVisible();
  });

  test("is suppressed on the chat (neuro) route", async ({ appPage }) => {
    await appPage.goto("/neuro");
    await appPage.waitForSelector(".mode-indicator");
    await expect(appPage.locator(".bottom-tab-bar")).toHaveCount(0);
  });

  test("recently visited modes become quick-switch tabs", async ({ appPage }) => {
    // Record "goals" as recent, then land on expenses.
    await appPage.goto("/goals");
    await appPage.waitForSelector(".bottom-tab-bar");
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".bottom-tab-bar");

    // The current mode (expenses) is excluded; goals shows as a recent tab.
    const goalsTab = appPage.locator(".bottom-tab", { hasText: "Цели" });
    await expect(goalsTab).toBeVisible();
    await goalsTab.click();
    await appPage.waitForURL("**/goals");
    await expect(appPage.locator(".page-title")).toContainText("Цели");
  });
});

test.describe("List skeleton", () => {
  test("skeleton placeholder renders while a list page is loading", async ({ page }) => {
    // Delay the goals response so the skeleton is observable.
    await page.addInitScript(`window.TelegramWebviewProxy = { postEvent() {} };`);
    await page.route("**/api/user/me", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { telegramId: 1, firstName: "Test", mode: "goals", availableModes: ["goals"] } }) }),
    );
    await page.route("**/api/goals", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) });
    });

    await page.goto("/goals");
    // The shimmer skeleton should be visible before the (delayed) data resolves.
    await expect(page.locator(".skeleton").first()).toBeVisible();
  });
});
