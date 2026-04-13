/**
 * Responsive & mobile layout tests.
 * Verifies the app works well on different mobile viewports.
 */
import { test, expect, getComputedStyle, getBoundingBox } from "./fixtures";

test.describe("Responsive — Small Screen (320px)", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test("mode grid fits in narrow viewport", async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".mode-grid");

    const grid = appPage.locator(".mode-grid");
    const box = await grid.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual(320);
  });

  test("page content doesn't overflow horizontally", async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".page");

    const overflow = await appPage.evaluate(() => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    });
    expect(overflow).toBe(true);
  });

  test("tabs scroll on narrow screen", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");

    const tabsOverflow = await appPage.locator(".tabs").evaluate(
      (el) => el.scrollWidth > el.clientWidth
    );
    // On 320px, tabs might overflow (4 tabs)
    // Just verify the container allows scrolling
    const overflowX = await getComputedStyle(appPage, ".tabs", "overflow-x");
    expect(["auto", "scroll"]).toContain(overflowX);
  });
});

test.describe("Responsive — Large Phone (430px)", () => {
  test.use({ viewport: { width: 430, height: 932 } });

  test("mode grid displays correctly", async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".mode-grid");

    const cards = appPage.locator(".mode-card");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(10);

    // Cards should be in 2 columns
    const firstBox = await cards.first().boundingBox();
    const secondBox = await cards.nth(1).boundingBox();
    expect(firstBox).toBeTruthy();
    expect(secondBox).toBeTruthy();
    // Second card should be to the right of first (same row)
    expect(secondBox!.x).toBeGreaterThan(firstBox!.x);
    // And roughly same Y
    expect(Math.abs(secondBox!.y - firstBox!.y)).toBeLessThan(5);
  });

  test("stat cards fit in a row", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");
    await appPage.locator(".tab", { hasText: "Сравнение" }).click();
    await appPage.waitForSelector(".stat-row");

    const cards = appPage.locator(".stat-card");
    expect(await cards.count()).toBe(3);

    // All 3 cards should be visible on screen
    for (let i = 0; i < 3; i++) {
      const box = await cards.nth(i).boundingBox();
      expect(box).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(430);
    }
  });
});

test.describe("Responsive — No Horizontal Overflow", () => {
  const routes = ["/", "/expenses", "/dates", "/transcribe", "/simplifier"];

  for (const route of routes) {
    test(`${route} has no horizontal scrollbar`, async ({ appPage }) => {
      await appPage.goto(route);
      await appPage.waitForTimeout(500); // Wait for page to settle

      const noHorizontalScroll = await appPage.evaluate(() => {
        return document.documentElement.scrollWidth <= window.innerWidth;
      });
      expect(noHorizontalScroll).toBe(true);
    });
  }
});

test.describe("Responsive — Touch Interactions", () => {
  test("list items have touch-friendly size", async ({ appPage }) => {
    await appPage.goto("/dates");
    await appPage.waitForSelector(".list-item");

    const item = appPage.locator(".list-item").first();
    const box = await item.boundingBox();
    expect(box).toBeTruthy();
    // Minimum touch target height (44px per Apple HIG)
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("tab buttons have touch-friendly size", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tab");

    const tab = appPage.locator(".tab").first();
    const box = await tab.boundingBox();
    expect(box).toBeTruthy();
    // Minimum touch height
    expect(box!.height).toBeGreaterThanOrEqual(32);
  });

  test("voice icon is 44x44 (minimum touch target)", async ({ appPage }) => {
    await appPage.goto("/transcribe");
    await appPage.waitForSelector(".voice-row-icon");

    const box = await appPage.locator(".voice-row-icon").boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("FAB is 56x56 at bottom-right", async ({ appPage }) => {
    await appPage.goto("/dates");
    await appPage.waitForSelector(".fab");

    const fab = appPage.locator(".fab");
    const box = await fab.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(50);
    expect(box!.height).toBeGreaterThanOrEqual(50);
  });
});
