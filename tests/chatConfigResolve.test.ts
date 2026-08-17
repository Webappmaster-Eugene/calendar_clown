import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePositiveInt,
  CHAT_MESSAGE_LIMIT,
  DEEPSEEK_MODEL,
  DEEPSEEK_FREE_MODEL,
  NEURO_UNCENSORED_MODEL,
} from "../src/constants.js";
import {
  resolveDialogAiConfig,
  resolveProviderDefaults,
  formatEffectiveConfig,
  CHAT_LIMIT_REACHED_MSG,
  type DialogAiOverrides,
} from "../src/chat/config.js";

/**
 * Unit tests for the neuro-chat config shared by the bot and the Mini App:
 *  - resolvePositiveInt: env parsing for the limits (message / max-dialogs).
 *  - resolveDialogAiConfig: per-dialog model/persona winning over the provider default.
 *  - formatEffectiveConfig: the one rendering used by the banner and the settings panel.
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

function dlg(over: Partial<DialogAiOverrides> = {}): DialogAiOverrides {
  return { model: null, systemPrompt: null, ...over };
}

describe("resolveProviderDefaults", () => {
  it("maps each provider to its configured model", () => {
    assert.deepEqual(resolveProviderDefaults("free"), { model: DEEPSEEK_FREE_MODEL, uncensored: false });
    assert.deepEqual(resolveProviderDefaults("paid"), { model: DEEPSEEK_MODEL, uncensored: false });
    assert.deepEqual(resolveProviderDefaults("uncensored"), { model: NEURO_UNCENSORED_MODEL, uncensored: true });
  });
});

describe("resolveDialogAiConfig", () => {
  it("uses the per-dialog model when set, else the provider default", () => {
    assert.equal(resolveDialogAiConfig(dlg({ model: "x/custom-model" }), "free").model, "x/custom-model");
    assert.equal(resolveDialogAiConfig(dlg(), "free").model, DEEPSEEK_FREE_MODEL);
    assert.equal(resolveDialogAiConfig(dlg(), "paid").model, DEEPSEEK_MODEL);
  });

  it("passes the per-dialog prompt through as a persona, not as a replacement", () => {
    assert.equal(resolveDialogAiConfig(dlg({ systemPrompt: "Ты пират" }), "free").persona, "Ты пират");
    assert.equal(resolveDialogAiConfig(dlg(), "free").persona, null);
  });

  it("keeps the uncensored flag independent of the persona", () => {
    assert.equal(resolveDialogAiConfig(dlg(), "uncensored").uncensored, true);
    // A custom prompt must not turn the uncensored base prompt off.
    const withPersona = resolveDialogAiConfig(dlg({ systemPrompt: "мой" }), "uncensored");
    assert.equal(withPersona.uncensored, true);
    assert.equal(withPersona.persona, "мой");
    assert.equal(resolveDialogAiConfig(dlg(), "free").uncensored, false);
  });
});

describe("CHAT_LIMIT_REACHED_MSG", () => {
  it("names the configured limit (single source for bot + Mini App)", () => {
    assert.match(CHAT_LIMIT_REACHED_MSG, new RegExp(String(CHAT_MESSAGE_LIMIT)));
  });
});

describe("formatEffectiveConfig", () => {
  it("marks provider defaults vs per-dialog overrides", () => {
    const asDefault = formatEffectiveConfig(dlg(), "free");
    assert.match(asDefault, new RegExp(DEEPSEEK_FREE_MODEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(asDefault, /по умолчанию/);
    assert.match(asDefault, /Промпт: базовый/);

    const overridden = formatEffectiveConfig(dlg({ model: "x/y", systemPrompt: "роль" }), "free");
    assert.match(overridden, /задана для диалога/);
    assert.match(overridden, /Промпт: свой \(4 симв\.\)/);
  });

  it("shows the message counter only when it is known", () => {
    assert.match(formatEffectiveConfig(dlg(), "paid", 12), new RegExp(`12 из ${CHAT_MESSAGE_LIMIT}`));
    assert.doesNotMatch(formatEffectiveConfig(dlg(), "paid"), /Сообщений/);
  });

  it("handles a user with no dialog yet", () => {
    const none = formatEffectiveConfig(null, "free");
    assert.match(none, /Диалог ещё не начат/);
  });
});
