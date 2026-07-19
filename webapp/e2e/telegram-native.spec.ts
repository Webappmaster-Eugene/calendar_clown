/**
 * Native Telegram integration (MainButton + haptics) verified at the bridge
 * level. The headless browser can't render the native button or vibrate, but by
 * mocking a valid Telegram launch environment we capture the exact bridge events
 * the real client acts on: `web_app_setup_main_button` and
 * `web_app_trigger_haptic_feedback`. This proves the app *requests* those native
 * behaviours with correct parameters.
 *
 * Note: the SDK requires the newer signed-initData `signature` field, or `init()`
 * throws LaunchParamsRetrieveError and all SDK features go unavailable — hence the
 * `signature` key below (a dummy value; nothing here validates it cryptographically).
 */
import { test, expect } from "./fixtures";

const INIT_DATA = new URLSearchParams({
  user: JSON.stringify({ id: 714820789, first_name: "E2E" }),
  auth_date: "1784000000",
  signature: "e2e_signature",
  hash: "0".repeat(64),
}).toString();
const TG_HASH = new URLSearchParams({
  tgWebAppData: INIT_DATA,
  tgWebAppVersion: "7.10",
  tgWebAppPlatform: "android",
  tgWebAppThemeParams: JSON.stringify({ bg_color: "#ffffff", button_color: "#2481cc", button_text_color: "#ffffff" }),
}).toString();

/* eslint-disable @typescript-eslint/no-explicit-any */
function recordBridgeEvents() {
  (window as any).__tg = [];
  (window as any).TelegramWebviewProxy = {
    postEvent: (eventType: string, eventData: string) => {
      (window as any).__tg.push({ eventType, eventData: JSON.parse(eventData || "null") });
    },
  };
}
function events(page: any, type: string) {
  return page.evaluate((t: string) => (window as any).__tg.filter((e: any) => e.eventType === t).map((e: any) => e.eventData), type);
}

test.describe("Native Telegram integration", () => {
  test("MainButton: CreateEventPage drives the native button (text + enabled state)", async ({ appPage }) => {
    await appPage.addInitScript(recordBridgeEvents);
    await appPage.goto(`/calendar/new#${TG_HASH}`);
    await appPage.waitForSelector("textarea");
    await appPage.waitForTimeout(600);

    // The in-content submit button yields to the native MainButton.
    await expect(appPage.locator("button", { hasText: "Создать событие" })).toHaveCount(0);

    const setups = await events(appPage, "web_app_setup_main_button");
    expect(setups.length).toBeGreaterThan(0);
    const last = setups[setups.length - 1];
    expect(last.text).toBe("Создать событие");
    expect(last.is_visible).toBe(true);
    expect(last.is_active).toBe(false); // disabled until the user types

    // Typing enables the native button.
    await appPage.locator("textarea").fill("Встреча завтра в 15:00");
    await appPage.waitForTimeout(300);
    const after = (await events(appPage, "web_app_setup_main_button")).pop();
    expect(after.is_active).toBe(true);
  });

  test("Haptics: toggling a goal emits a selection haptic (and no success buzz)", async ({ appPage, mockApi }) => {
    await appPage.addInitScript(recordBridgeEvents);
    await mockApi({
      "GET /api/goals": { body: { ok: true, data: [
        { id: 1, name: "Набор", emoji: "🎯", period: "year", visibility: "private", completedCount: 0, totalCount: 1, deadline: null, createdAt: "2026-01-01T00:00:00Z" },
      ] } },
      "GET /api/goals/1": { body: { ok: true, data: {
        goalSet: { id: 1, name: "Набор", emoji: "🎯", period: "year", visibility: "private", completedCount: 0, totalCount: 1, deadline: null, createdAt: "2026-01-01T00:00:00Z" },
        goals: [{ id: 10, goalSetId: 1, text: "Цель", isCompleted: false, completedAt: null, createdAt: "2026-01-01T00:00:00Z" }],
      } } },
    });

    await appPage.goto(`/goals#${TG_HASH}`);
    await appPage.locator(".list-item-content", { hasText: "Набор" }).click();
    await appPage.waitForSelector(".toggle");
    await appPage.locator(".toggle").first().click();
    await appPage.waitForTimeout(500);

    const haptics = await events(appPage, "web_app_trigger_haptic_feedback");
    expect(haptics.some((h: any) => h.type === "selection_change")).toBe(true);
    // Toggles opt out of the success buzz (meta.skipHapticSuccess).
    expect(haptics.some((h: any) => h.type === "notification")).toBe(false);
  });

  test("Haptics: a create mutation emits a success notification haptic", async ({ appPage }) => {
    await appPage.addInitScript(recordBridgeEvents);
    await appPage.goto(`/goals#${TG_HASH}`);
    await appPage.locator(".fab").click();
    await appPage.locator(".input").first().fill("Новый набор");
    await appPage.locator("button", { hasText: "Создать" }).click();
    await appPage.waitForTimeout(600);

    const haptics = await events(appPage, "web_app_trigger_haptic_feedback");
    expect(haptics.some((h: any) => h.type === "notification" && h.notification_type === "success")).toBe(true);
  });
});
