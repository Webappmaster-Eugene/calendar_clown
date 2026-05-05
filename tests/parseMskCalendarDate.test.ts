/**
 * Unit tests for `parseMskCalendarDate` — the date validator used by the Mini App
 * when adding/editing expenses with an explicit calendar date.
 *
 * Pure-logic test; no DB needed. Locks in the boundary rules so future changes
 * to the validator can't silently widen or narrow the accepted range.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMskCalendarDate } from "../src/utils/date.js";

describe("parseMskCalendarDate", () => {
  it("accepts a recent valid date and stores it at 09:00 UTC = 12:00 MSK", () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const y = yesterday.getUTCFullYear();
    const m = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
    const d = String(yesterday.getUTCDate()).padStart(2, "0");
    const result = parseMskCalendarDate(`${y}-${m}-${d}`);
    assert.equal(result.getUTCHours(), 9);
    assert.equal(result.getUTCMinutes(), 0);
  });

  it("rejects a malformed string", () => {
    assert.throws(() => parseMskCalendarDate("not-a-date"), /Некорректная дата/);
    assert.throws(() => parseMskCalendarDate("2026/04/15"), /Некорректная дата/);
    assert.throws(() => parseMskCalendarDate(""), /Некорректная дата/);
  });

  it("rejects a non-existent calendar date", () => {
    assert.throws(() => parseMskCalendarDate("2026-02-30"), /Несуществующая дата/);
    assert.throws(() => parseMskCalendarDate("2026-13-01"), /Несуществующая дата/);
    assert.throws(() => parseMskCalendarDate("2026-04-31"), /Несуществующая дата/);
  });

  it("rejects dates more than 5 years in the past", () => {
    const sixYearsAgo = new Date(Date.now() - 6 * 365 * 24 * 60 * 60 * 1000);
    const y = sixYearsAgo.getUTCFullYear();
    assert.throws(
      () => parseMskCalendarDate(`${y}-01-01`),
      /слишком давняя/
    );
  });

  it("rejects dates more than 1 day in the future", () => {
    const farFuture = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const y = farFuture.getUTCFullYear();
    const m = String(farFuture.getUTCMonth() + 1).padStart(2, "0");
    const d = String(farFuture.getUTCDate()).padStart(2, "0");
    assert.throws(
      () => parseMskCalendarDate(`${y}-${m}-${d}`),
      /не может быть в будущем/
    );
  });

  it("accepts today's date in any major timezone", () => {
    // The parser stores at 09:00 UTC = 12:00 MSK. Today, expressed as the user's
    // local YYYY-MM-DD, falls within the [-5y, +1d] window for any reasonable TZ.
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, "0");
    const d = String(today.getUTCDate()).padStart(2, "0");
    const result = parseMskCalendarDate(`${y}-${m}-${d}`);
    assert.equal(result.getUTCFullYear(), y);
    assert.equal(result.getUTCMonth(), today.getUTCMonth());
  });
});
