/**
 * Unit tests for the Reminders schedule evaluators `shouldFireNow` and
 * `isExpired`. Pure logic — no DB/API. All comparisons happen in
 * Europe/Moscow (UTC+3, no DST), so tests anchor `now` in UTC and reason
 * about the MSK wall-clock time it maps to.
 *
 *   2026-07-13 is a Monday (ISO weekday 1)
 *   2026-07-18 is a Saturday (ISO weekday 6)
 *   2026-07-19 is a Sunday (ISO weekday 7)
 *   UTC 07:30 == MSK 10:30
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldFireNow, isExpired } from "../src/reminders/service.js";
import type { ReminderSchedule } from "../src/reminders/types.js";

/** 2026-07-13 (Mon) 07:30 UTC == 10:30 MSK. */
const MON_1030_MSK = new Date("2026-07-13T07:30:00Z");

function schedule(overrides: Partial<ReminderSchedule> = {}): ReminderSchedule {
  return {
    times: ["10:30"],
    weekdays: [1, 2, 3, 4, 5],
    endDate: null,
    ...overrides,
  };
}

describe("shouldFireNow", () => {
  it("fires when weekday + time match and never fired before", () => {
    assert.equal(shouldFireNow(schedule(), MON_1030_MSK, null), true);
  });

  it("does not fire when the current minute is not in times[]", () => {
    // 07:31 UTC == 10:31 MSK, schedule only has 10:30.
    const now = new Date("2026-07-13T07:31:00Z");
    assert.equal(shouldFireNow(schedule(), now, null), false);
  });

  it("does not fire on a weekday not in weekdays[]", () => {
    // Saturday, but schedule is Mon-Fri.
    const sat = new Date("2026-07-18T07:30:00Z");
    assert.equal(shouldFireNow(schedule(), sat, null), false);
  });

  it("maps ISO Sunday to 7 (not 0)", () => {
    const sun = new Date("2026-07-19T07:30:00Z");
    // Sunday-only schedule should fire on Sunday.
    assert.equal(shouldFireNow(schedule({ weekdays: [7] }), sun, null), true);
    // Monday-only schedule should NOT fire on Sunday.
    assert.equal(shouldFireNow(schedule({ weekdays: [1] }), sun, null), false);
  });

  it("suppresses a duplicate fire within the same MSK minute", () => {
    // Already fired at the very same minute → skip.
    const firedSameMinute = new Date("2026-07-13T07:30:40Z");
    assert.equal(shouldFireNow(schedule(), MON_1030_MSK, firedSameMinute), false);
  });

  it("fires again when lastFiredAt is in a different minute", () => {
    // Fired an hour earlier → allowed to fire now.
    const firedEarlier = new Date("2026-07-13T06:30:00Z");
    assert.equal(shouldFireNow(schedule(), MON_1030_MSK, firedEarlier), true);
  });

  it("does not fire after endDate has passed (MSK date compare)", () => {
    // now is 2026-07-13 MSK, endDate 2026-07-12 is already in the past.
    assert.equal(
      shouldFireNow(schedule({ endDate: "2026-07-12" }), MON_1030_MSK, null),
      false,
    );
  });

  it("still fires on the endDate itself (inclusive)", () => {
    assert.equal(
      shouldFireNow(schedule({ endDate: "2026-07-13" }), MON_1030_MSK, null),
      true,
    );
  });

  it("matches when the time is one of several in times[]", () => {
    assert.equal(
      shouldFireNow(schedule({ times: ["08:00", "10:30", "22:00"] }), MON_1030_MSK, null),
      true,
    );
  });
});

describe("isExpired", () => {
  it("is never expired when endDate is null", () => {
    assert.equal(isExpired(schedule({ endDate: null }), MON_1030_MSK), false);
  });

  it("is expired when the MSK today is strictly after endDate", () => {
    assert.equal(isExpired(schedule({ endDate: "2026-07-12" }), MON_1030_MSK), true);
  });

  it("is not expired on the endDate itself", () => {
    assert.equal(isExpired(schedule({ endDate: "2026-07-13" }), MON_1030_MSK), false);
  });

  it("is not expired when endDate is in the future", () => {
    assert.equal(isExpired(schedule({ endDate: "2026-12-31" }), MON_1030_MSK), false);
  });
});
