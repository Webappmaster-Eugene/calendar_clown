/**
 * Notable Dates page tests.
 * Tab scrolling, filter switching, list display.
 */
import { test, expect, isScrollable, getComputedStyles } from "./fixtures";

test.describe("Notable Dates — Tab Scrolling", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.goto("/dates");
    await appPage.waitForSelector(".tabs");
  });

  test("tabs container has scroll-enabled CSS", async ({ appPage }) => {
    const styles = await getComputedStyles(appPage, ".tabs", [
      "overflow-x", "display",
    ]);
    expect(["auto", "scroll"]).toContain(styles["overflow-x"]);
    expect(styles["display"]).toBe("flex");
  });

  test("tabs with --scroll modifier have flex-shrink 0", async ({ appPage }) => {
    // .tabs--scroll .tab should have flex: 0 0 auto
    const tab = appPage.locator(".tabs--scroll .tab").first();
    const flex = await tab.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        flexGrow: cs.flexGrow,
        flexShrink: cs.flexShrink,
        flexBasis: cs.flexBasis,
      };
    });
    expect(flex.flexGrow).toBe("0");
    expect(flex.flexShrink).toBe("0");
    expect(flex.flexBasis).toBe("auto");
  });

  test("scrollbar is hidden", async ({ appPage }) => {
    const scrollbarWidth = await getComputedStyles(appPage, ".tabs", ["scrollbar-width"]);
    expect(scrollbarWidth["scrollbar-width"]).toBe("none");
  });

  test("all 4 tabs are present", async ({ appPage }) => {
    const tabs = appPage.locator(".tab");
    const texts = await tabs.allTextContents();
    expect(texts).toEqual(["Ближайшие", "На неделе", "За месяц", "Все даты"]);
  });

  test("last tab text is not truncated", async ({ appPage }) => {
    const lastTab = appPage.locator(".tab").last();
    const text = await lastTab.textContent();
    expect(text).toBe("Все даты");

    // Tab should have white-space: nowrap
    const ws = await lastTab.evaluate((el) => window.getComputedStyle(el).whiteSpace);
    expect(ws).toBe("nowrap");
  });
});

test.describe("Notable Dates — Filter Tabs", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.goto("/dates");
    await appPage.waitForSelector(".tabs");
  });

  test("first tab is active by default", async ({ appPage }) => {
    const first = appPage.locator(".tab").first();
    await expect(first).toHaveClass(/active/);
  });

  test("switching tab changes active state", async ({ appPage }) => {
    const weekTab = appPage.locator(".tab", { hasText: "На неделе" });
    await weekTab.click();
    await expect(weekTab).toHaveClass(/active/);

    // First tab should no longer be active
    const firstTab = appPage.locator(".tab").first();
    await expect(firstTab).not.toHaveClass(/active/);
  });

  test("active tab has distinct background", async ({ appPage }) => {
    const activeTab = appPage.locator(".tab.active");
    const inactiveTab = appPage.locator(".tab:not(.active)").first();

    const activeBg = await activeTab.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    const inactiveBg = await inactiveTab.evaluate((el) => window.getComputedStyle(el).backgroundColor);

    expect(activeBg).not.toBe(inactiveBg);
  });
});

test.describe("Notable Dates — List Display", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.goto("/dates");
    await appPage.waitForSelector(".list");
  });

  test("shows date items with names", async ({ appPage }) => {
    const items = appPage.locator(".list-item");
    expect(await items.count()).toBeGreaterThan(0);

    // Check first item
    await expect(items.first()).toContainText("Данильченко Диман");
  });

  test("shows date info in list items", async ({ appPage }) => {
    // Items should have a hint with date or type info
    const hint = appPage.locator(".list-item .list-item-hint").first();
    await expect(hint).toBeVisible();
    const text = await hint.textContent();
    expect(text!.length).toBeGreaterThan(0);
  });

  test("FAB button for adding dates is visible", async ({ appPage }) => {
    const fab = appPage.locator(".fab");
    await expect(fab).toBeVisible();

    const styles = await fab.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { position: cs.position, borderRadius: cs.borderRadius };
    });
    expect(styles.position).toBe("fixed");
    expect(styles.borderRadius).toBe("50%");
  });
});
