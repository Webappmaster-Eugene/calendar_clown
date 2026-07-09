import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeMarkdown, escapeMarkdownV2 } from "../src/utils/markdown.js";

describe("escapeMarkdown", () => {
  it("returns plain text unchanged", () => {
    assert.equal(escapeMarkdown("Hello world"), "Hello world");
  });

  it("escapes asterisks", () => {
    assert.equal(escapeMarkdown("*bold*"), "\\*bold\\*");
  });

  it("escapes underscores", () => {
    assert.equal(escapeMarkdown("_italic_"), "\\_italic\\_");
  });

  it("escapes backticks", () => {
    assert.equal(escapeMarkdown("`code`"), "\\`code\\`");
  });

  it("escapes square brackets", () => {
    assert.equal(escapeMarkdown("[link](url)"), "\\[link\\](url)");
  });

  it("escapes all special chars in one string", () => {
    assert.equal(escapeMarkdown("*_`[]"), "\\*\\_\\`\\[\\]");
  });

  it("handles empty string", () => {
    assert.equal(escapeMarkdown(""), "");
  });
});

describe("escapeMarkdownV2", () => {
  it("returns plain text unchanged", () => {
    assert.equal(escapeMarkdownV2("Hello"), "Hello");
  });

  it("escapes all MarkdownV2 special characters", () => {
    const specials = "_*[]()~`>#+\\-=|{}.!\\";
    const result = escapeMarkdownV2(specials);
    // Each char should be preceded by backslash
    for (const ch of specials) {
      assert.ok(result.includes(`\\${ch}`), `Missing escape for: ${ch}`);
    }
  });

  it("handles empty string", () => {
    assert.equal(escapeMarkdownV2(""), "");
  });
});
