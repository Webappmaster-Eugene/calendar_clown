/**
 * MainButton fallback (P2 UX).
 * `useMainButton` drives the native Telegram MainButton, but every SDK call is
 * guarded by `isAvailable()`. Outside a real Telegram client (as in these tests,
 * and in any browser), it must degrade to the in-content submit button so the
 * primary action is never lost. This locks in that no-regression guarantee.
 */
import { test, expect } from "./fixtures";

test.describe("MainButton fallback", () => {
  test("CreateEventPage renders the in-content submit button when MainButton is unavailable", async ({ appPage }) => {
    await appPage.goto("/calendar/new");
    await appPage.waitForSelector(".page-title");

    const submit = appPage.locator("button", { hasText: "Создать событие" });
    await expect(submit).toBeVisible();
    // Disabled until the user enters a description — proves the enable/disable path works.
    await expect(submit).toBeDisabled();

    await appPage.locator("textarea").fill("Встреча завтра в 15:00");
    await expect(submit).toBeEnabled();
  });
});
