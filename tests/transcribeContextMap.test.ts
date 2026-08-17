import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTranscribeContext } from "../src/voice/transcribeContext.js";

/**
 * Locks the mode → STT-prompt mapping shared by /api/voice/transcribe and the bot's
 * voice handler: a topic-specific prompt biases unrelated dictation, so only the
 * three topic modes may resolve to a topic prompt.
 */

describe("resolveTranscribeContext", () => {
  it("maps the topic-specific modes", () => {
    assert.equal(resolveTranscribeContext("calendar"), "calendar");
    assert.equal(resolveTranscribeContext("expenses"), "expense");
    assert.equal(resolveTranscribeContext("expense"), "expense");
    assert.equal(resolveTranscribeContext("tasks"), "tasks");
  });

  it("sends the neuro chat to the neutral prompt", () => {
    assert.equal(resolveTranscribeContext("neuro"), "general");
  });

  it("falls back to 'general' for every other mode the webapp sends", () => {
    for (const mode of [
      "osint", "gandalf", "goals", "summarizer", "simplifier", "transcribe",
      "digest", "wishlist", "notable_dates", "blogger", "broadcast", "nutritionist", "admin",
    ]) {
      assert.equal(resolveTranscribeContext(mode), "general", mode);
    }
  });

  it("falls back to 'general' for missing or unknown values", () => {
    assert.equal(resolveTranscribeContext(undefined), "general");
    assert.equal(resolveTranscribeContext(null), "general");
    assert.equal(resolveTranscribeContext(""), "general");
    assert.equal(resolveTranscribeContext("   "), "general");
    assert.equal(resolveTranscribeContext("garbage-mode"), "general");
  });

  it("ignores case and padding", () => {
    assert.equal(resolveTranscribeContext(" Calendar "), "calendar");
    assert.equal(resolveTranscribeContext("EXPENSES"), "expense");
  });
});
