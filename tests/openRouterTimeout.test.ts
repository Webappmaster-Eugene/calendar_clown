import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOpenRouterTimeoutMs } from "../src/utils/openRouterClient.js";

/**
 * Guards the OpenRouter per-call timeout resolution. Default is 60s (raised from
 * 30s because long-form generation like blogger posts overran the old bound);
 * garbage/non-positive env values must fall back to the default, never 0/NaN.
 */

test("unset → 60s default", () => {
  assert.equal(resolveOpenRouterTimeoutMs(undefined), 60_000);
});

test("empty or whitespace → 60s default", () => {
  assert.equal(resolveOpenRouterTimeoutMs(""), 60_000);
  assert.equal(resolveOpenRouterTimeoutMs("   "), 60_000);
});

test("valid positive integer is honored", () => {
  assert.equal(resolveOpenRouterTimeoutMs("45000"), 45_000);
  assert.equal(resolveOpenRouterTimeoutMs("  90000  "), 90_000);
});

test("non-numeric → 60s default", () => {
  assert.equal(resolveOpenRouterTimeoutMs("abc"), 60_000);
});

test("zero and negative → 60s default (never disables the timeout)", () => {
  assert.equal(resolveOpenRouterTimeoutMs("0"), 60_000);
  assert.equal(resolveOpenRouterTimeoutMs("-5"), 60_000);
});
