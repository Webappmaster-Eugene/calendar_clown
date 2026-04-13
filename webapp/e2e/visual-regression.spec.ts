/**
 * Visual regression / screenshot tests.
 * Captures page screenshots for comparison after UI changes.
 * Run `npx playwright test --update-snapshots` to regenerate baselines.
 */
import { test, expect } from "./fixtures";

test.describe("Visual — Page Screenshots", () => {
  // Use consistent viewport for snapshot stability
  test.use({ viewport: { width: 390, height: 844 } });

  test("home page", async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".mode-grid");
    await appPage.waitForTimeout(300); // Wait for animations

    await expect(appPage).toHaveScreenshot("home.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("expenses - report tab", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".list");
    await appPage.waitForTimeout(300);

    await expect(appPage).toHaveScreenshot("expenses-report.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("expenses - comparison tab", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");
    await appPage.locator(".tab", { hasText: "Сравнение" }).click();
    await appPage.waitForSelector(".stat-row");
    await appPage.waitForTimeout(300);

    await expect(appPage).toHaveScreenshot("expenses-comparison.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("notable dates page", async ({ appPage }) => {
    await appPage.goto("/dates");
    await appPage.waitForSelector(".list");
    await appPage.waitForTimeout(300);

    await expect(appPage).toHaveScreenshot("notable-dates.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("transcribe page - idle state", async ({ appPage }) => {
    await appPage.goto("/transcribe");
    await appPage.waitForSelector(".voice-row");
    await appPage.waitForTimeout(300);

    await expect(appPage).toHaveScreenshot("transcribe-idle.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("simplifier page - idle state", async ({ appPage }) => {
    await appPage.goto("/simplifier");
    await appPage.waitForSelector(".voice-row");
    await appPage.waitForTimeout(300);

    await expect(appPage).toHaveScreenshot("simplifier-idle.png", {
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe("Visual — Component Screenshots", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("stat cards row", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");
    await appPage.locator(".tab", { hasText: "Сравнение" }).click();
    await appPage.waitForSelector(".stat-row");

    await expect(appPage.locator(".stat-row")).toHaveScreenshot("stat-row.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("voice row idle", async ({ appPage }) => {
    await appPage.goto("/transcribe");
    await appPage.waitForSelector(".voice-row");

    await expect(appPage.locator(".voice-row")).toHaveScreenshot("voice-row-idle.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("mode grid", async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".mode-grid");
    await appPage.waitForTimeout(300);

    await expect(appPage.locator(".mode-grid")).toHaveScreenshot("mode-grid.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("tabs bar", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");

    await expect(appPage.locator(".tabs")).toHaveScreenshot("tabs-expenses.png", {
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe("Visual — Dark/Light Theme", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("pages render with dark Telegram theme vars", async ({ appPage }) => {
    // Inject Telegram dark theme CSS variables
    await appPage.addStyleTag({
      content: `
        :root {
          --tg-theme-bg-color: #1c1c1e;
          --tg-theme-text-color: #ffffff;
          --tg-theme-hint-color: #8e8e93;
          --tg-theme-link-color: #0a84ff;
          --tg-theme-button-color: #0a84ff;
          --tg-theme-button-text-color: #ffffff;
          --tg-theme-secondary-bg-color: #2c2c2e;
          --tg-theme-destructive-text-color: #ff453a;
        }
      `,
    });

    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");
    await appPage.locator(".tab", { hasText: "Сравнение" }).click();
    await appPage.waitForSelector(".stat-row");
    await appPage.waitForTimeout(300);

    await expect(appPage).toHaveScreenshot("expenses-comparison-dark.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});
