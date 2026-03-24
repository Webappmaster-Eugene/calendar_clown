import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { validateInitData } from "../src/api/authMiddleware.js";

const BOT_TOKEN = "1234567890:ABCdefGhIJKlmnOPQrstUVWxyz";

/** Generate valid initData with proper HMAC signature. */
function makeInitData(
  overrides: Record<string, string> = {},
  token: string = BOT_TOKEN
): string {
  const authDate = overrides.auth_date ?? String(Math.floor(Date.now() / 1000));
  const user = overrides.user ?? JSON.stringify({
    id: 123456789,
    first_name: "Test",
    username: "testuser",
  });

  const params: Record<string, string> = {
    auth_date: authDate,
    user,
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    ...overrides,
  };

  // Remove hash if present (we'll compute it)
  delete params.hash;

  // Build data-check-string
  const dataCheckString = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  // HMAC-SHA256
  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  params.hash = hash;
  return new URLSearchParams(params).toString();
}

describe("validateInitData", () => {
  it("validates correct initData", () => {
    const initData = makeInitData();
    const result = validateInitData(initData, BOT_TOKEN);
    assert.notEqual(result, null);
    assert.equal(result!.user.id, 123456789);
    assert.equal(result!.user.first_name, "Test");
    assert.equal(result!.user.username, "testuser");
    assert.equal(typeof result!.authDate, "number");
    assert.equal(typeof result!.hash, "string");
  });

  it("returns null for invalid hash", () => {
    const initData = makeInitData();
    const tampered = initData.replace(/hash=[^&]+/, "hash=invalidhash");
    assert.equal(validateInitData(tampered, BOT_TOKEN), null);
  });

  it("returns null for wrong bot token", () => {
    const initData = makeInitData();
    assert.equal(validateInitData(initData, "wrong:token"), null);
  });

  it("returns null when hash is missing", () => {
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 1, first_name: "X" }),
    });
    assert.equal(validateInitData(params.toString(), BOT_TOKEN), null);
  });

  it("returns null when user is missing", () => {
    const authDate = String(Math.floor(Date.now() / 1000));
    const dataCheckString = `auth_date=${authDate}`;
    const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    const params = new URLSearchParams({ auth_date: authDate, hash });
    assert.equal(validateInitData(params.toString(), BOT_TOKEN), null);
  });

  it("returns null when auth_date is missing", () => {
    const user = JSON.stringify({ id: 1, first_name: "X" });
    const dataCheckString = `user=${user}`;
    const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    const params = new URLSearchParams({ user, hash });
    assert.equal(validateInitData(params.toString(), BOT_TOKEN), null);
  });

  it("returns null for expired initData", () => {
    const oldDate = String(Math.floor(Date.now() / 1000) - 200000); // ~2 days ago
    const initData = makeInitData({ auth_date: oldDate });
    assert.equal(validateInitData(initData, BOT_TOKEN), null);
  });

  it("returns null for invalid JSON in user field", () => {
    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = makeInitData({ user: "not-json", auth_date: authDate });
    assert.equal(validateInitData(initData, BOT_TOKEN), null);
  });

  it("returns null for user without id", () => {
    const initData = makeInitData({
      user: JSON.stringify({ first_name: "NoId" }),
    });
    assert.equal(validateInitData(initData, BOT_TOKEN), null);
  });

  it("preserves queryId when present", () => {
    const initData = makeInitData({ query_id: "test_query_123" });
    const result = validateInitData(initData, BOT_TOKEN);
    assert.notEqual(result, null);
    assert.equal(result!.queryId, "test_query_123");
  });
});
