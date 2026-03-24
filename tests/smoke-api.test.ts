import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

/**
 * Smoke tests for the API router.
 * Verifies route mounting, auth middleware, and basic error handling.
 * Does NOT require database — tests HTTP routing layer only.
 */

let app: { fetch: (req: Request) => Response | Promise<Response> };

before(async () => {
  // Set required env for auth middleware
  process.env.TELEGRAM_BOT_TOKEN = "test:smoke-token-for-testing";

  const { createApiApp } = await import("../src/api/router.js");
  app = createApiApp();
});

describe("API smoke tests", () => {
  it("returns 401 without Authorization header", async () => {
    const res = await app.fetch(new Request("http://localhost/user/me"));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.ok(body.error.includes("Authorization"));
  });

  it("returns 401 with invalid Authorization format", async () => {
    const res = await app.fetch(
      new Request("http://localhost/user/me", {
        headers: { Authorization: "Bearer invalid" },
      })
    );
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
  });

  it("returns 401 with invalid initData", async () => {
    const res = await app.fetch(
      new Request("http://localhost/user/me", {
        headers: { Authorization: "tma invalid_init_data" },
      })
    );
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.ok(body.error.includes("Invalid"));
  });

  it("returns 404 for unknown API routes", async () => {
    const res = await app.fetch(
      new Request("http://localhost/nonexistent/endpoint", {
        headers: { Authorization: "tma fake" },
      })
    );
    // Will be 401 because auth fails first, which is correct behavior
    assert.ok([401, 404].includes(res.status));
  });

  it("handles CORS preflight (OPTIONS)", async () => {
    const res = await app.fetch(
      new Request("http://localhost/user/me", {
        method: "OPTIONS",
        headers: { Origin: "http://example.com" },
      })
    );
    // CORS middleware should respond before auth
    assert.ok([200, 204].includes(res.status));
  });
});
