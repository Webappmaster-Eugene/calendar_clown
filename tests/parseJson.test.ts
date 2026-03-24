import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tryParseJson } from "../src/utils/parseJson.js";

describe("tryParseJson", () => {
  it("parses valid JSON object", () => {
    const result = tryParseJson('{"key": "value", "num": 42}');
    assert.deepEqual(result, { key: "value", num: 42 });
  });

  it("parses JSON wrapped in code fences", () => {
    const result = tryParseJson('```json\n{"title": "test"}\n```');
    assert.deepEqual(result, { title: "test" });
  });

  it("parses JSON with extra whitespace", () => {
    const result = tryParseJson('  \n  {"a": 1}  \n  ');
    assert.deepEqual(result, { a: 1 });
  });

  it("returns null for invalid JSON", () => {
    assert.equal(tryParseJson("{invalid json}"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(tryParseJson(""), null);
  });

  it("parses JSON array", () => {
    const result = tryParseJson('[1, 2, 3]');
    // Arrays are valid JSON but not Record<string, unknown>
    assert.notEqual(result, null);
  });

  it("handles nested objects", () => {
    const input = '{"events": [{"title": "Test", "start": "2025-01-01"}]}';
    const result = tryParseJson(input);
    assert.notEqual(result, null);
    assert.ok(Array.isArray((result as Record<string, unknown>).events));
  });

  it("strips code fences case-insensitively", () => {
    const result = tryParseJson('```JSON\n{"ok": true}\n```');
    assert.deepEqual(result, { ok: true });
  });
});
