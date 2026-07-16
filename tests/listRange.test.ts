import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeListRange } from "../src/calendar/listRange.js";

const TODAY = "2026-07-16"; // Thursday

function mskDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
}

describe("normalizeListRange", () => {
  it("keeps a valid single-day range", () => {
    const r = normalizeListRange({ from: "2026-07-17", days: 1, label: "Завтра" }, TODAY);
    assert.equal(mskDateStr(r.from), "2026-07-17");
    assert.equal(r.days, 1);
    assert.equal(r.label, "Завтра");
  });

  it("keeps a multi-day range", () => {
    const r = normalizeListRange({ from: TODAY, days: 2, label: "Ближайшие 2 дня" }, TODAY);
    assert.equal(r.days, 2);
    assert.equal(r.label, "Ближайшие 2 дня");
  });

  it("falls back to today when 'from' is missing or malformed", () => {
    for (const from of [undefined, "", "not-a-date", "16.07.2026", 20260716]) {
      const r = normalizeListRange({ from, days: 1, label: "X" }, TODAY);
      assert.equal(mskDateStr(r.from), TODAY, `from=${JSON.stringify(from)}`);
    }
  });

  it("clamps days into [1, 31]", () => {
    assert.equal(normalizeListRange({ from: TODAY, days: 0, label: "X" }, TODAY).days, 1);
    assert.equal(normalizeListRange({ from: TODAY, days: -5, label: "X" }, TODAY).days, 1);
    assert.equal(normalizeListRange({ from: TODAY, days: 999, label: "X" }, TODAY).days, 31);
    assert.equal(normalizeListRange({ from: TODAY, days: 3.9, label: "X" }, TODAY).days, 3);
  });

  it("defaults days by legacy type when missing", () => {
    assert.equal(normalizeListRange({ from: TODAY }, TODAY, "list_week").days, 7);
    assert.equal(normalizeListRange({ from: TODAY }, TODAY, "list_today").days, 1);
    assert.equal(normalizeListRange({ from: TODAY }, TODAY).days, 1);
  });

  it("derives a label when the model omits one", () => {
    assert.equal(normalizeListRange({ from: TODAY, days: 7 }, TODAY, "list_week").label, "Неделя");
    assert.equal(normalizeListRange({ from: TODAY, days: 3 }, TODAY).label, "Ближайшие 3 дн.");
    assert.equal(normalizeListRange({ from: TODAY, days: 1 }, TODAY).label, "События");
  });

  it("truncates an overlong label", () => {
    const long = "a".repeat(100);
    assert.ok(normalizeListRange({ from: TODAY, days: 1, label: long }, TODAY).label.length <= 40);
  });
});
