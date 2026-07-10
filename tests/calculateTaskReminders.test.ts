/**
 * Unit tests for the Task Tracker reminder calculator `calculateTaskReminders`
 * and `isOverdue`. Pure logic — no DB/API. Both `deadline` and `now` are passed
 * explicitly so the tests never depend on the real clock.
 *
 * Reminder rules (MSK = UTC+3, no DST):
 *   - day_before: 09:00 MSK on (deadline's MSK date − 1 day) == 06:00 UTC
 *   - 4h_before:  deadline − 4h
 *   - 1h_before:  deadline − 1h
 * A reminder is only emitted when its remind_at is strictly in the future
 * relative to `now`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateTaskReminders,
  isOverdue,
  formatReminderType,
} from "../src/tasks/logic.js";

/** Deadline: 2026-07-20 (Mon) 18:00 MSK == 15:00 UTC. */
const DEADLINE = new Date("2026-07-20T15:00:00Z");

function types(
  reminders: Array<{ remindAt: Date; reminderType: string }>,
): string[] {
  return reminders.map((r) => r.reminderType);
}

describe("calculateTaskReminders", () => {
  it("emits all three reminders when the deadline is far in the future", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const result = calculateTaskReminders(DEADLINE, now);
    assert.deepEqual(types(result), ["day_before", "4h_before", "1h_before"]);
  });

  it("computes day_before at 09:00 MSK (06:00 UTC) on the previous MSK day", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const dayBefore = calculateTaskReminders(DEADLINE, now).find(
      (r) => r.reminderType === "day_before",
    );
    assert.ok(dayBefore);
    // Deadline MSK date is 2026-07-20 → previous day 2026-07-19 at 06:00 UTC.
    assert.equal(dayBefore.remindAt.toISOString(), "2026-07-19T06:00:00.000Z");
  });

  it("computes 4h_before and 1h_before as raw offsets from the deadline", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const result = calculateTaskReminders(DEADLINE, now);
    const fourH = result.find((r) => r.reminderType === "4h_before")!;
    const oneH = result.find((r) => r.reminderType === "1h_before")!;
    assert.equal(fourH.remindAt.toISOString(), "2026-07-20T11:00:00.000Z");
    assert.equal(oneH.remindAt.toISOString(), "2026-07-20T14:00:00.000Z");
  });

  it("drops day_before once its remind_at is already past", () => {
    // now is after 2026-07-19 06:00 UTC but before the 4h mark.
    const now = new Date("2026-07-20T00:00:00Z");
    const result = calculateTaskReminders(DEADLINE, now);
    assert.deepEqual(types(result), ["4h_before", "1h_before"]);
  });

  it("keeps only 1h_before when between the 4h and 1h marks", () => {
    // now == 12:00 UTC: past 11:00 (4h) but before 14:00 (1h).
    const now = new Date("2026-07-20T12:00:00Z");
    const result = calculateTaskReminders(DEADLINE, now);
    assert.deepEqual(types(result), ["1h_before"]);
  });

  it("returns an empty array when all reminder times are in the past", () => {
    // now is one minute before the deadline: 1h mark (14:00) is already past.
    const now = new Date("2026-07-20T14:59:00Z");
    const result = calculateTaskReminders(DEADLINE, now);
    assert.deepEqual(result, []);
  });

  it("treats a remind_at exactly equal to now as NOT in the future (strict)", () => {
    // now == the 1h mark exactly (14:00 UTC). 4h mark (11:00) is past,
    // day_before (07-19 06:00) is past → nothing strictly after now.
    const now = new Date("2026-07-20T14:00:00Z");
    const result = calculateTaskReminders(DEADLINE, now);
    assert.deepEqual(result, []);
  });

  it("returns an empty array for a deadline already in the past", () => {
    const now = new Date("2026-07-25T00:00:00Z");
    const result = calculateTaskReminders(DEADLINE, now);
    assert.deepEqual(result, []);
  });
});

describe("isOverdue", () => {
  it("is true when the deadline is before now", () => {
    assert.equal(isOverdue(DEADLINE, new Date("2026-07-21T00:00:00Z")), true);
  });

  it("is false when the deadline is after now", () => {
    assert.equal(isOverdue(DEADLINE, new Date("2026-07-19T00:00:00Z")), false);
  });

  it("is false when the deadline exactly equals now (strict <)", () => {
    assert.equal(isOverdue(DEADLINE, new Date(DEADLINE)), false);
  });
});

describe("formatReminderType", () => {
  it("maps each reminder type to Russian text", () => {
    assert.equal(formatReminderType("day_before"), "за 1 день");
    assert.equal(formatReminderType("4h_before"), "за 4 часа");
    assert.equal(formatReminderType("1h_before"), "за 1 час");
  });
});
