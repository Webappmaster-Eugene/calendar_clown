/**
 * Shared test fixtures: Telegram SDK mock, API route mocking, CSS helpers.
 */
import { test as base, expect, type Page, type Route } from "@playwright/test";
import { MOCK_USER_PROFILE, MOCK_EXPENSE_REPORT, MOCK_NOTABLE_DATES, MOCK_TRANSCRIPTIONS, MOCK_SIMPLIFICATIONS, MOCK_CATEGORIES } from "./mock-data";

// ─── Types ──────────────────────────────────────────────────

type ApiMockMap = Record<string, { status?: number; body: unknown }>;

interface Fixtures {
  /** Page with Telegram SDK mocked + default API routes. */
  appPage: Page;
  /** Mock specific API routes. Merges with defaults. */
  mockApi: (overrides?: ApiMockMap) => Promise<void>;
}

// ─── Default API responses ──────────────────────────────────

const DEFAULT_API_MOCKS: ApiMockMap = {
  "GET /api/user/me": {
    body: { ok: true, data: MOCK_USER_PROFILE },
  },
  "GET /api/expenses/report*": {
    body: { ok: true, data: MOCK_EXPENSE_REPORT },
  },
  "GET /api/expenses/categories": {
    body: { ok: true, data: MOCK_CATEGORIES },
  },
  "GET /api/expenses/year*": {
    body: { ok: true, data: [] },
  },
  "GET /api/expenses/recent*": {
    body: { ok: true, data: [] },
  },
  "GET /api/notable-dates/upcoming*": {
    body: { ok: true, data: MOCK_NOTABLE_DATES },
  },
  "GET /api/notable-dates/week*": {
    body: { ok: true, data: MOCK_NOTABLE_DATES.slice(0, 2) },
  },
  "GET /api/notable-dates/month*": {
    body: { ok: true, data: MOCK_NOTABLE_DATES },
  },
  "GET /api/notable-dates/all*": {
    body: { ok: true, data: MOCK_NOTABLE_DATES },
  },
  "GET /api/transcribe/history*": {
    body: { ok: true, data: MOCK_TRANSCRIPTIONS },
  },
  "GET /api/simplifier/history*": {
    body: { ok: true, data: MOCK_SIMPLIFICATIONS },
  },
  "GET /api/calendar/today*": {
    body: { ok: true, data: [] },
  },
  "GET /api/calendar/week*": {
    body: { ok: true, data: [] },
  },
  "GET /api/gandalf/categories": {
    body: { ok: true, data: [] },
  },
  "GET /api/gandalf/stats": {
    body: { ok: true, data: { totalEntries: 0, totalCategories: 0 } },
  },
  "GET /api/goals": {
    body: { ok: true, data: [] },
  },
  "GET /api/reminders": {
    body: { ok: true, data: [] },
  },
  "GET /api/reminders/tribe": {
    body: { ok: true, data: [] },
  },
  "GET /api/reminders/sounds": {
    body: { ok: true, data: [] },
  },
  "GET /api/wishlist": {
    body: { ok: true, data: { own: [], tribe: [] } },
  },
  "GET /api/chat/dialogs": {
    body: { ok: true, data: [] },
  },
  "GET /api/chat/provider": {
    body: { ok: true, data: { provider: "free" } },
  },
  "GET /api/digest/rubrics": {
    body: { ok: true, data: [] },
  },
  "GET /api/tasks": {
    body: { ok: true, data: [] },
  },
};

// ─── Route matching helper ──────────────────────────────────

function matchRoute(pattern: string, method: string, url: string): boolean {
  const [patMethod, patPath] = pattern.split(" ");
  if (patMethod !== method) return false;
  const urlPath = new URL(url).pathname + new URL(url).search;
  if (patPath.endsWith("*")) {
    return urlPath.startsWith(patPath.slice(0, -1));
  }
  return urlPath === patPath;
}

// ─── Fixtures ───────────────────────────────────────────────

// ─── Telegram SDK mock script (injected before page load) ───

// Minimal Telegram mock — the app gracefully degrades without SDK.
// We just need TelegramWebviewProxy so init() doesn't throw hard errors.
const TELEGRAM_MOCK_SCRIPT = `
  window.TelegramWebviewProxy = { postEvent() {} };
`;

export const test = base.extend<Fixtures>({
  appPage: async ({ page }, use) => {
    // Inject Telegram SDK mock BEFORE any page scripts run
    await page.addInitScript(TELEGRAM_MOCK_SCRIPT);
    // Intercept all /api/* with defaults
    await setupApiMocks(page, DEFAULT_API_MOCKS);
    await use(page);
  },

  mockApi: async ({ page }, use) => {
    const fn = async (overrides: ApiMockMap = {}) => {
      const merged = { ...DEFAULT_API_MOCKS, ...overrides };
      await setupApiMocks(page, merged);
    };
    await use(fn);
  },
});

async function setupApiMocks(page: Page, mocks: ApiMockMap): Promise<void> {
  await page.route("**/api/**", async (route: Route) => {
    const method = route.request().method();
    const url = route.request().url();

    for (const [pattern, response] of Object.entries(mocks)) {
      if (matchRoute(pattern, method, url)) {
        await route.fulfill({
          status: response.status ?? 200,
          contentType: "application/json",
          body: JSON.stringify(response.body),
        });
        return;
      }
    }

    // Fallback: return empty success for unmatched API routes
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: null }),
    });
  });
}

// ─── CSS assertion helpers ──────────────────────────────────

export async function getComputedStyle(page: Page, selector: string, property: string): Promise<string> {
  return page.locator(selector).first().evaluate(
    (el, prop) => window.getComputedStyle(el).getPropertyValue(prop),
    property
  );
}

export async function getComputedStyles(page: Page, selector: string, properties: string[]): Promise<Record<string, string>> {
  return page.locator(selector).first().evaluate(
    (el, props) => {
      const cs = window.getComputedStyle(el);
      const result: Record<string, string> = {};
      for (const p of props) {
        result[p] = cs.getPropertyValue(p);
      }
      return result;
    },
    properties
  );
}

export async function isScrollable(page: Page, selector: string, direction: "x" | "y" = "x"): Promise<boolean> {
  return page.locator(selector).first().evaluate(
    (el, dir) => dir === "x"
      ? el.scrollWidth > el.clientWidth
      : el.scrollHeight > el.clientHeight,
    direction
  );
}

export async function getBoundingBox(page: Page, selector: string) {
  return page.locator(selector).first().boundingBox();
}

export { expect };
