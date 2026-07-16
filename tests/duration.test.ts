import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRussianDuration } from "../src/calendar/duration.js";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe("parseRussianDuration", () => {
  const cases: Array<[string, number]> = [
    ["на полчаса", 30 * MIN],
    ["на пол часа", 30 * MIN],
    ["полчаса", 30 * MIN],
    ["на час", HOUR],
    ["на полтора часа", 90 * MIN],
    ["на 2 часа", 2 * HOUR],
    ["на два часа", 2 * HOUR],
    ["на 5 часов", 5 * HOUR],
    ["на 15 минут", 15 * MIN],
    ["на 20 мин", 20 * MIN],
    ["на 45 минуты", 45 * MIN],
    ["1 час 30 минут", 90 * MIN],
    ["2 часа 15 мин", 2 * HOUR + 15 * MIN],
  ];

  for (const [text, expected] of cases) {
    it(`parses "${text}" → ${expected / MIN} min`, () => {
      const result = parseRussianDuration(text);
      assert.notEqual(result, null, `expected a match for "${text}"`);
      assert.equal(result!.durationMs, expected);
    });
  }

  it("returns null when no duration is present", () => {
    assert.equal(parseRussianDuration("Скрининг бэкенда"), null);
    assert.equal(parseRussianDuration("встреча в 15"), null);
  });

  it("does not misfire on words containing 'час'/'мин'", () => {
    assert.equal(parseRussianDuration("часовой пояс"), null);
    assert.equal(parseRussianDuration("минуточку подожди"), null);
  });

  it("matched substring can be stripped from the title", () => {
    const text = "Скрининг бэкенд @BrOks_141 на полчаса";
    const result = parseRussianDuration(text);
    assert.notEqual(result, null);
    const title = text.replace(result!.matched, "").replace(/\s{2,}/g, " ").trim();
    assert.equal(title, "Скрининг бэкенд @BrOks_141");
  });
});
