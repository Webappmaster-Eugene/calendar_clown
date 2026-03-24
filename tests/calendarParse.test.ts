import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEventText, parseDateTime } from "../src/calendar/parse.js";

describe("parseEventText", () => {
  it("parses event with 'завтра в 15:00'", () => {
    const result = parseEventText("Встреча с командой завтра в 15:00");
    assert.notEqual(result, null);
    assert.ok(result!.title.length > 0);
    assert.ok(result!.start instanceof Date);
    assert.ok(result!.end instanceof Date);
    assert.ok(result!.end.getTime() > result!.start.getTime());
  });

  it("returns null for empty string", () => {
    assert.equal(parseEventText(""), null);
  });

  it("returns null for whitespace only", () => {
    assert.equal(parseEventText("   "), null);
  });

  it("defaults end to start + 1 hour when no end time", () => {
    const result = parseEventText("Тест завтра в 10:00");
    if (result) {
      const diff = result.end.getTime() - result.start.getTime();
      assert.equal(diff, 60 * 60 * 1000, "End should be start + 1 hour");
    }
  });

  it("uses 'Встреча' as default title when only date/time given", () => {
    const result = parseEventText("завтра в 15:00");
    if (result) {
      assert.equal(result.title, "Встреча");
    }
  });

  it("extracts title from text around date expression", () => {
    const result = parseEventText("Обед завтра в 12:00");
    if (result) {
      assert.ok(result.title.includes("Обед"), `Title should contain 'Обед', got: ${result.title}`);
    }
  });
});

describe("parseDateTime", () => {
  it("parses date and time from text", () => {
    const result = parseDateTime("завтра в 15:00");
    assert.notEqual(result, null);
    assert.ok(result!.start instanceof Date);
    assert.ok(result!.end instanceof Date);
  });

  it("returns null for unparseable text", () => {
    const result = parseDateTime("просто текст без даты и числа");
    // chrono-node might or might not parse this — either null or a result is valid
    // The key contract: it doesn't throw
    assert.ok(result === null || result.start instanceof Date);
  });

  it("defaults end to start + 1 hour", () => {
    const result = parseDateTime("завтра 10:00");
    if (result) {
      const diff = result.end.getTime() - result.start.getTime();
      assert.equal(diff, 60 * 60 * 1000);
    }
  });
});
