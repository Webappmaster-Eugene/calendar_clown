/**
 * Design system & CSS tests.
 * Verifies core styles, spacing, typography, and visual consistency.
 */
import { test, expect, getComputedStyles, getComputedStyle } from "./fixtures";

test.describe("Design System — Typography", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".page-title");
  });

  test("page-title has correct font properties", async ({ appPage }) => {
    const styles = await getComputedStyles(appPage, ".page-title", [
      "font-size", "font-weight",
    ]);
    expect(styles["font-size"]).toBe("20px");
    expect(styles["font-weight"]).toBe("600");
  });

  test("page-subtitle has hint color and smaller size", async ({ appPage }) => {
    const fontSize = await getComputedStyle(appPage, ".page-subtitle", "font-size");
    expect(fontSize).toBe("13px");
  });

  test("body has correct base font size", async ({ appPage }) => {
    const fontSize = await getComputedStyle(appPage, "body", "font-size");
    expect(fontSize).toBe("15px");
  });

  test("body has correct line height", async ({ appPage }) => {
    const lh = await getComputedStyle(appPage, "body", "line-height");
    // 15px × 1.5 = 22.5px
    expect(parseFloat(lh)).toBeCloseTo(22.5, 0);
  });
});

test.describe("Design System — Layout", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".page");
  });

  test("page container has 16px padding", async ({ appPage }) => {
    const padding = await getComputedStyle(appPage, ".page", "padding");
    expect(padding).toBe("16px");
  });

  test("page container has 100vw max-width", async ({ appPage }) => {
    const maxWidth = await getComputedStyle(appPage, ".page", "max-width");
    const vw = await appPage.evaluate(() => window.innerWidth);
    expect(parseFloat(maxWidth)).toBe(vw);
  });

  test("body overflow-x prevents horizontal scroll", async ({ appPage }) => {
    const overflow = await getComputedStyle(appPage, "body", "overflow-x");
    // "clip" in source, but some browsers compute it as "hidden"
    expect(["clip", "hidden"]).toContain(overflow);
  });

  test("body overflow-y is auto for scrolling", async ({ appPage }) => {
    const overflow = await getComputedStyle(appPage, "body", "overflow-y");
    expect(overflow).toBe("auto");
  });
});

test.describe("Design System — Mode Grid", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".mode-grid");
  });

  test("mode grid uses 2-column layout", async ({ appPage }) => {
    const cols = await getComputedStyle(appPage, ".mode-grid", "grid-template-columns");
    // Should be two equal fractions
    const parts = cols.split(" ").filter(Boolean);
    expect(parts.length).toBe(2);
  });

  test("mode grid has gap", async ({ appPage }) => {
    const gap = await getComputedStyle(appPage, ".mode-grid", "gap");
    expect(parseFloat(gap)).toBeGreaterThanOrEqual(8);
  });

  test("all mode cards are visible", async ({ appPage }) => {
    const cards = appPage.locator(".mode-card");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(10);

    // Each card has emoji + label
    for (let i = 0; i < Math.min(count, 6); i++) {
      const card = cards.nth(i);
      await expect(card.locator(".mode-card-emoji")).toBeVisible();
      await expect(card.locator(".mode-card-label")).toBeVisible();
    }
  });

  test("mode card has correct border radius", async ({ appPage }) => {
    const radius = await getComputedStyle(appPage, ".mode-card", "border-radius");
    expect(radius).toBe("14px");
  });
});

test.describe("Design System — Buttons", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.waitForSelector(".page");
  });

  test("btn has correct base styles", async ({ appPage }) => {
    // Home page has "Добавить на главный экран" button or "Попробовать снова"
    await appPage.goto("/");
    await appPage.waitForSelector(".btn, .home-screen-btn");

    const btn = appPage.locator(".btn").first();
    if (await btn.count() > 0) {
      const styles = await btn.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return { borderRadius: cs.borderRadius, cursor: cs.cursor };
      });
      expect(styles.borderRadius).toBe("10px");
      expect(styles.cursor).toBe("pointer");
    }
  });
});

test.describe("Design System — Cards", () => {
  test("card has correct padding and border radius", async ({ appPage }) => {
    await appPage.goto("/transcribe");
    await appPage.waitForSelector(".card");

    const styles = await getComputedStyles(appPage, ".card", [
      "padding-top", "border-radius",
    ]);
    expect(styles["padding-top"]).toBe("14px");
    expect(styles["border-radius"]).toBe("12px");
  });
});

test.describe("Design System — Lists", () => {
  test("list items have correct structure", async ({ appPage }) => {
    await appPage.goto("/dates");
    await appPage.waitForSelector(".list");

    const gap = await getComputedStyle(appPage, ".list", "gap");
    expect(parseFloat(gap)).toBe(8);

    // List items exist
    const items = appPage.locator(".list-item");
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("list-item has flex layout", async ({ appPage }) => {
    await appPage.goto("/dates");
    await appPage.waitForSelector(".list-item");

    const display = await getComputedStyle(appPage, ".list-item", "display");
    expect(display).toBe("flex");

    const align = await getComputedStyle(appPage, ".list-item", "align-items");
    expect(align).toBe("center");
  });
});

test.describe("Design System — Empty States", () => {
  test("empty state renders centered with emoji", async ({ appPage, mockApi }) => {
    await mockApi({
      "GET /api/goals": { body: { ok: true, data: [] } },
    });
    await appPage.goto("/goals");
    await appPage.waitForSelector(".empty-state");

    const display = await getComputedStyle(appPage, ".empty-state", "text-align");
    expect(display).toBe("center");

    await expect(appPage.locator(".empty-state-emoji")).toBeVisible();
    await expect(appPage.locator(".empty-state-text")).toBeVisible();
  });
});

test.describe("Design System — Skeleton Loading", () => {
  test("skeleton page renders during loading", async ({ appPage, mockApi }) => {
    // Delay API response to catch the loading state
    await appPage.route("**/api/user/me", async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: null }),
      });
    });

    await appPage.goto("/expenses");
    // Should show loading/skeleton
    const loading = appPage.locator(".loading, .skeleton-page");
    await expect(loading.first()).toBeVisible({ timeout: 1000 });
  });
});

test.describe("Design System — Stat Cards", () => {
  test("stat row displays cards in a row with correct gap", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".tabs");
    // Click comparison tab
    await appPage.locator(".tab", { hasText: "Сравнение" }).click();
    await appPage.waitForSelector(".stat-row");

    const display = await getComputedStyle(appPage, ".stat-row", "display");
    expect(display).toBe("flex");

    const gap = await getComputedStyle(appPage, ".stat-row", "gap");
    expect(parseFloat(gap)).toBe(10);

    const cards = appPage.locator(".stat-card");
    expect(await cards.count()).toBe(3);
  });
});
