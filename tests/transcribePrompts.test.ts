import { test } from "node:test";
import assert from "node:assert/strict";
import { getTranscribePromptForContext, type TranscribeContext } from "../src/voice/transcribe.js";

/**
 * Guards the STT anti-hallucination fix. The model was fabricating calendar
 * events on unclear/foreign audio because the context prompts "led" it too hard
 * ("пользователь диктует встречи"). These assertions lock in the fix:
 *   - every prompt hard-forbids inventing content and allows an empty result;
 *   - domain prompts frame the topic as a hint, not an assumption.
 */

const ALL: TranscribeContext[] = ["calendar", "general", "expense", "tasks"];
const DOMAIN: TranscribeContext[] = ["calendar", "expense", "tasks"];

test("every context prompt hard-forbids hallucination and allows an empty result", () => {
  for (const ctx of ALL) {
    const prompt = getTranscribePromptForContext(ctx);
    assert.match(prompt, /верни ПУСТУЮ строку/, `${ctx}: must allow empty output`);
    assert.match(prompt, /[Нн]икогда не выдумывай/, `${ctx}: must forbid inventing content`);
  }
});

test("domain prompts use soft framing, not a leading assertion", () => {
  for (const ctx of DOMAIN) {
    const prompt = getTranscribePromptForContext(ctx);
    assert.match(prompt, /Вероятная тема/, `${ctx}: topic must be a hint`);
    assert.doesNotMatch(prompt, /пользователь диктует/, `${ctx}: must not re-introduce the leading framing`);
  }
});

test("each context resolves to a distinct non-empty prompt", () => {
  const prompts = ALL.map(getTranscribePromptForContext);
  for (const p of prompts) assert.ok(p.length > 0);
  assert.equal(new Set(prompts).size, ALL.length);
});

test("every context prompt transcribes speech instead of obeying it", () => {
  // Speech like "расскажи про X, ответь коротко" is content, not an instruction:
  // without this guard the STT model answers the question instead of writing it down.
  for (const ctx of ALL) {
    const prompt = getTranscribePromptForContext(ctx);
    assert.match(prompt, /строго то, что реально произнесено/, `${ctx}: must transcribe verbatim`);
  }
});

test("the STT payload restates the transcribe-only rule after the audio", async () => {
  const { buildSttMessages, STT_TRAILING_REMINDER } = await import("../src/voice/sttClient.js");
  const parts = buildSttMessages("PROMPT", "audio/ogg", "BASE64")[0].content;

  assert.equal(parts.length, 3, "prompt, audio, reminder");
  assert.equal(parts[0].text, "PROMPT");
  assert.equal((parts[1].image_url as { url: string }).url, "data:audio/ogg;base64,BASE64");
  assert.equal(parts[2].text, STT_TRAILING_REMINDER, "the reminder must come after the audio");
});
