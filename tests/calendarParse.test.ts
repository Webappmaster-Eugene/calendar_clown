import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEventText } from "../src/calendar/parse.js";

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

  it("honours an explicit 'на полчаса' duration and strips it from the title", () => {
    const result = parseEventText("Скрининг бэкенд @BrOks_141 в 15 на полчаса");
    assert.notEqual(result, null);
    const diff = result!.end.getTime() - result!.start.getTime();
    assert.equal(diff, 30 * 60 * 1000, "End should be start + 30 minutes");
    assert.ok(
      !/полчаса/i.test(result!.title),
      `Duration phrase should be stripped from title, got: ${result!.title}`,
    );
    assert.ok(result!.title.includes("Скрининг"), `Title should keep the subject, got: ${result!.title}`);
  });

  it("honours an explicit 'на 2 часа' duration", () => {
    const result = parseEventText("Тренировка завтра в 10 на 2 часа");
    assert.notEqual(result, null);
    const diff = result!.end.getTime() - result!.start.getTime();
    assert.equal(diff, 2 * 60 * 60 * 1000, "End should be start + 2 hours");
  });

  it("honours a 'с 15 до 16' time range", () => {
    const result = parseEventText("Созвон с 15 до 16");
    assert.notEqual(result, null);
    const diff = result!.end.getTime() - result!.start.getTime();
    assert.equal(diff, 60 * 60 * 1000, "Range should span exactly 1 hour");
    assert.ok(result!.title.includes("Созвон"), `Title should keep the subject, got: ${result!.title}`);
  });

  it("honours a 'с 10 до 11:30' half-hour-precision range", () => {
    const result = parseEventText("Встреча с 10 до 11:30");
    assert.notEqual(result, null);
    const diff = result!.end.getTime() - result!.start.getTime();
    assert.equal(diff, 90 * 60 * 1000, "Range should span 90 minutes");
  });
});
