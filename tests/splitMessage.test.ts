import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitMessage, TELEGRAM_MAX_MESSAGE_LENGTH } from "../src/utils/telegram.js";

describe("splitMessage", () => {
  it("returns single chunk for short text", () => {
    const result = splitMessage("Hello world");
    assert.deepEqual(result, ["Hello world"]);
  });

  it("returns single chunk for text exactly at max length", () => {
    const text = "A".repeat(100);
    const result = splitMessage(text, 100);
    assert.equal(result.length, 1);
    assert.equal(result[0], text);
  });

  it("splits at paragraph boundary (double newline)", () => {
    const p1 = "A".repeat(40);
    const p2 = "B".repeat(40);
    const text = `${p1}\n\n${p2}`;
    const result = splitMessage(text, 50);
    assert.equal(result.length, 2);
    assert.equal(result[0], p1);
    assert.equal(result[1], p2);
  });

  it("splits at single newline when no paragraph boundary", () => {
    const line1 = "A".repeat(40);
    const line2 = "B".repeat(40);
    const text = `${line1}\n${line2}`;
    const result = splitMessage(text, 50);
    assert.equal(result.length, 2);
    assert.equal(result[0], line1);
    assert.equal(result[1], line2);
  });

  it("splits at sentence boundary when no newlines", () => {
    const s1 = "A".repeat(38) + ". ";
    const s2 = "B".repeat(30);
    const text = s1 + s2;
    const result = splitMessage(text, 50);
    assert.equal(result.length, 2);
    assert.ok(result[0].endsWith("."));
  });

  it("hard splits when no boundaries found", () => {
    const text = "A".repeat(150);
    const result = splitMessage(text, 50);
    assert.equal(result.length, 3);
    assert.equal(result[0].length, 50);
    assert.equal(result[1].length, 50);
    assert.equal(result[2].length, 50);
  });

  it("handles empty string", () => {
    const result = splitMessage("");
    assert.deepEqual(result, [""]);
  });

  it("uses default max length of 4096", () => {
    assert.equal(TELEGRAM_MAX_MESSAGE_LENGTH, 4096);
    const text = "A".repeat(4096);
    const result = splitMessage(text);
    assert.equal(result.length, 1);
  });

  it("handles text with multiple paragraphs", () => {
    const paragraphs = Array.from({ length: 5 }, (_, i) => `Paragraph ${i + 1}: ${"x".repeat(30)}`);
    const text = paragraphs.join("\n\n");
    const result = splitMessage(text, 100);
    assert.ok(result.length >= 2);
    // Each chunk should be <= 100
    for (const chunk of result) {
      assert.ok(chunk.length <= 100, `Chunk too long: ${chunk.length}`);
    }
  });
});
