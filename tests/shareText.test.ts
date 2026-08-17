import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildShareMessageText, TELEGRAM_SHARE_MAX_LENGTH } from "../src/chat/shareText.js";

/**
 * savePreparedInlineMessage validates the message text at save time, so an AI answer
 * longer than Telegram's 4096-character limit has to be cut before it is offered for
 * sharing — and cut at a boundary that keeps the text readable.
 */

describe("buildShareMessageText", () => {
  it("leaves a short answer untouched", () => {
    const { text, truncated } = buildShareMessageText("Короткий ответ");
    assert.equal(text, "Короткий ответ");
    assert.equal(truncated, false);
  });

  it("trims surrounding whitespace", () => {
    assert.equal(buildShareMessageText("  ответ \n").text, "ответ");
  });

  it("cuts long answers within the Telegram limit and flags it", () => {
    const long = "а".repeat(TELEGRAM_SHARE_MAX_LENGTH + 2_000);
    const { text, truncated } = buildShareMessageText(long);

    assert.equal(truncated, true);
    assert.ok(text.length <= TELEGRAM_SHARE_MAX_LENGTH, `length ${text.length}`);
    assert.match(text, /Текст сокращён/);
  });

  it("prefers a paragraph boundary when one is close enough to the budget", () => {
    const head = "Первый абзац.".repeat(200);
    const tail = "Второй абзац.".repeat(500);
    const { text } = buildShareMessageText(`${head}\n\n${tail}`);
    assert.ok(text.startsWith("Первый абзац."));
    assert.ok(!text.includes("Второй абзац."), "should cut at the paragraph break");
  });

  it("keeps most of the budget when a single paragraph has no usable boundary", () => {
    const { text } = buildShareMessageText("б".repeat(10_000));
    assert.ok(text.length > TELEGRAM_SHARE_MAX_LENGTH * 0.9, `too aggressive: ${text.length}`);
  });

  it("never splits a surrogate pair", () => {
    // Emoji are surrogate pairs: cutting between the halves yields a broken char.
    const emoji = "😀";
    const { text } = buildShareMessageText(emoji.repeat(4_000));
    assert.equal(text.length <= TELEGRAM_SHARE_MAX_LENGTH, true);
    const body = text.slice(0, text.indexOf("\n\n…"));
    assert.equal(body.length % 2, 0, "an odd length would mean a lone surrogate");
    assert.doesNotMatch(body, /[\uD800-\uDBFF]$/);
  });

  it("handles CRLF content and a custom limit", () => {
    const content = Array.from({ length: 500 }, (_, i) => `строка ${i}`).join("\r\n");
    const { text, truncated } = buildShareMessageText(content, { maxLength: 500 });
    assert.equal(truncated, true);
    assert.ok(text.length <= 500);
  });

  it("degenerates safely when the limit is smaller than the notice", () => {
    const { text, truncated } = buildShareMessageText("в".repeat(100), { maxLength: 10 });
    assert.equal(truncated, true);
    assert.equal(text.length, 10);
  });
});
