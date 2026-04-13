/**
 * Navigation & AppShell tests.
 * Verifies routing, mode indicator breadcrumb, and page transitions.
 */
import { test, expect } from "./fixtures";

test.describe("Navigation — Mode Selector", () => {
  test("home page loads with greeting and mode grid", async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".page-title");

    await expect(appPage.locator(".page-title")).toContainText("Привет");
    await expect(appPage.locator(".page-subtitle")).toContainText("Выберите режим");
    await expect(appPage.locator(".mode-grid")).toBeVisible();
  });

  test("clicking a mode card navigates to the mode page", async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".mode-grid");

    // Click "Расходы" mode card
    await appPage.locator(".mode-card", { hasText: "Расходы" }).click();
    await appPage.waitForURL("**/expenses");

    await expect(appPage.locator(".page-title")).toContainText("Расходы");
  });
});

test.describe("Navigation — AppShell & Mode Indicator", () => {
  test("mode indicator shows on non-root pages", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".mode-indicator");

    const indicator = appPage.locator(".mode-indicator");
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText("Расходы");
  });

  test("mode indicator is absent on root page", async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".page");

    await expect(appPage.locator(".mode-indicator")).toHaveCount(0);
  });

  test("clicking mode indicator navigates back to home", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".mode-indicator");

    await appPage.locator(".mode-indicator").click();
    await appPage.waitForURL("**/");

    await expect(appPage.locator(".mode-grid")).toBeVisible();
  });
});

test.describe("Navigation — All Routes Load", () => {
  const routes = [
    { path: "/expenses", title: "Расходы" },
    { path: "/dates", title: "Памятные даты" },
    { path: "/transcribe", title: "Транскрипции" },
    { path: "/simplifier", title: "Упрощатель" },
    { path: "/goals", title: "Цели" },
    { path: "/tasks", title: "Трекер задач" },
    { path: "/neuro", title: "" },
  ];

  for (const { path, title } of routes) {
    test(`${path} loads without errors`, async ({ appPage }) => {
      await appPage.goto(path);

      // Wait for page to load (no skeleton)
      await appPage.waitForSelector(".page, .page-title, .chat-messages", { timeout: 5000 });

      // No error messages
      const errors = appPage.locator(".error-msg");
      expect(await errors.count()).toBe(0);

      // Title present if applicable
      if (title) {
        const titleEl = appPage.locator(".page-title");
        if (await titleEl.count() > 0) {
          await expect(titleEl).toContainText(title);
        }
      }
    });
  }
});

test.describe("Navigation — Page Enter Animation", () => {
  test("page has enter animation", async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".page");

    const animation = await appPage.locator(".page").evaluate(
      (el) => window.getComputedStyle(el).animationName
    );
    expect(animation).toBe("page-enter");
  });
});
