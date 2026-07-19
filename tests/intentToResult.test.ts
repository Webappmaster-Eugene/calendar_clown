import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { intentToResult } from "../src/services/voiceService.js";
import type { VoiceIntent } from "../src/voice/extractVoiceIntent.js";

/**
 * Unit tests for intentToResult — the pure mapping from the LLM VoiceIntent to the
 * API DTO returned by /api/voice/extract-intent. Pure logic, no DB / network.
 * The list_range case previously dropped from/days/label; these lock the shape.
 */

describe("intentToResult", () => {
  it("maps list_range with from (ISO) / days / label", () => {
    const from = new Date("2026-07-20T00:00:00.000Z");
    const r = intentToResult({ type: "list_range", from, days: 7, label: "Неделя" } as VoiceIntent);
    assert.equal(r.type, "list_range");
    assert.equal(r.listFrom, "2026-07-20T00:00:00.000Z");
    assert.equal(r.listDays, 7);
    assert.equal(r.listLabel, "Неделя");
  });

  it("maps a calendar event (title + ISO start/end + recurrence)", () => {
    const start = new Date("2026-07-20T12:00:00.000Z");
    const end = new Date("2026-07-20T13:00:00.000Z");
    const r = intentToResult({
      type: "calendar",
      events: [{ title: "Встреча", start, end, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"] }],
    } as VoiceIntent);
    assert.equal(r.type, "calendar");
    assert.equal(r.events?.length, 1);
    assert.equal(r.events?.[0].title, "Встреча");
    assert.equal(r.events?.[0].startISO, "2026-07-20T12:00:00.000Z");
    assert.deepEqual(r.events?.[0].recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=TU"]);
  });

  it("maps cancel_event with query + date; null date stays null", () => {
    const withDate = intentToResult({ type: "cancel_event", query: "встреча", date: new Date("2026-07-24T00:00:00.000Z") } as VoiceIntent);
    assert.equal(withDate.type, "cancel_event");
    assert.equal(withDate.cancelQuery, "встреча");
    assert.equal(withDate.cancelDate, "2026-07-24T00:00:00.000Z");

    const noDate = intentToResult({ type: "cancel_event", query: "созвон", date: null } as VoiceIntent);
    assert.equal(noDate.cancelDate, null);
  });

  it("maps unknown to just the type", () => {
    const r = intentToResult({ type: "unknown" } as VoiceIntent);
    assert.equal(r.type, "unknown");
    assert.equal(r.events, undefined);
    assert.equal(r.listFrom, undefined);
  });
});
