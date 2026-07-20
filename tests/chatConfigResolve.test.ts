import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePositiveInt } from "../src/constants.js";
import { resolveDialogAiConfig } from "../src/services/chatService.js";
import type { ChatDialog } from "../src/chat/repository.js";

/**
 * Unit tests for two pure pieces of the neuro-chat config:
 *  - resolvePositiveInt: env parsing for the limits (message / max-dialogs).
 *  - resolveDialogAiConfig: per-dialog model/prompt/temp/max overrides winning over
 *    the user's global provider default.
 */

describe("resolvePositiveInt", () => {
  it("parses a valid positive integer", () => {
    assert.equal(resolvePositiveInt("100", 50), 100);
    assert.equal(resolvePositiveInt("  7 ", 50), 7);
  });
  it("falls back on missing / empty / invalid / non-positive", () => {
    assert.equal(resolvePositiveInt(undefined, 50), 50);
    assert.equal(resolvePositiveInt("", 50), 50);
    assert.equal(resolvePositiveInt("abc", 50), 50);
    assert.equal(resolvePositiveInt("0", 50), 50);
    assert.equal(resolvePositiveInt("-3", 50), 50);
  });
});

function dlg(over: Partial<ChatDialog> = {}): ChatDialog {
  return {
    id: 1, userId: 1, title: "t",
    model: null, systemPrompt: null, temperature: null, maxTokens: null, theme: null,
    isActive: true, createdAt: new Date(0), updatedAt: new Date(0),
    ...over,
  };
}

describe("resolveDialogAiConfig", () => {
  it("uses the per-dialog model when set, else the provider default", () => {
    assert.equal(resolveDialogAiConfig(dlg({ model: "x/custom-model" }), "free").model, "x/custom-model");
    const base = resolveDialogAiConfig(dlg(), "free").model;
    assert.ok(base && base !== "x/custom-model", "no override → provider default model");
  });

  it("per-dialog system prompt wins; else the provider's (uncensored has one, free none)", () => {
    assert.equal(resolveDialogAiConfig(dlg({ systemPrompt: "Ты пират" }), "free").systemPrompt, "Ты пират");
    assert.equal(resolveDialogAiConfig(dlg(), "free").systemPrompt, undefined);
    assert.ok((resolveDialogAiConfig(dlg(), "uncensored").systemPrompt ?? "").length > 0);
    // A dialog prompt overrides even the uncensored provider prompt.
    assert.equal(resolveDialogAiConfig(dlg({ systemPrompt: "мой" }), "uncensored").systemPrompt, "мой");
  });

  it("temperature / maxTokens come from the dialog (null → undefined)", () => {
    const c = resolveDialogAiConfig(dlg({ temperature: 0.3, maxTokens: 2048 }), "paid");
    assert.equal(c.temperature, 0.3);
    assert.equal(c.maxTokens, 2048);
    const d = resolveDialogAiConfig(dlg(), "paid");
    assert.equal(d.temperature, undefined);
    assert.equal(d.maxTokens, undefined);
  });
});
