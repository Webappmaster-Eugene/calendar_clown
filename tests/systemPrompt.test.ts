import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeSystemPrompt } from "../src/chat/client.js";

/**
 * The base rules teach the model to use the injected web-search / link blocks, so a
 * per-dialog role must be composed ON TOP of them: replacing them would leave the
 * model claiming it has no internet access while the blocks sit in its context.
 */

describe("composeSystemPrompt", () => {
  it("always states the current date and the search/link rules", () => {
    const prompt = composeSystemPrompt();
    assert.match(prompt, /Текущая дата/);
    assert.match(prompt, /--- Результаты веб-поиска ---/);
    assert.match(prompt, /--- Содержимое ссылок ---/);
    assert.match(prompt, /\[название\]\(url\)/);
  });

  it("appends the persona instead of replacing the base rules", () => {
    const base = composeSystemPrompt();
    const withPersona = composeSystemPrompt({ persona: "Ты пират, говори как пират" });

    assert.match(withPersona, /Ты пират, говори как пират/);
    assert.match(withPersona, /--- Результаты веб-поиска ---/, "base rules must survive");
    assert.match(withPersona, /--- Дополнительные инструкции от пользователя ---/);
    assert.ok(withPersona.length > base.length);
  });

  it("treats an empty or whitespace persona as none", () => {
    const base = composeSystemPrompt();
    assert.equal(composeSystemPrompt({ persona: "" }), base);
    assert.equal(composeSystemPrompt({ persona: "   \n " }), base);
    assert.equal(composeSystemPrompt({ persona: null }), base);
  });

  it("keeps the search/link rules in the uncensored variant, with and without a persona", () => {
    const uncensored = composeSystemPrompt({ uncensored: true });
    assert.match(uncensored, /без ограничений/i);
    assert.match(uncensored, /--- Содержимое ссылок ---/);

    const both = composeSystemPrompt({ uncensored: true, persona: "мой промпт" });
    assert.match(both, /без ограничений/i, "a persona must not disable the jailbreak base");
    assert.match(both, /мой промпт/);
  });

  it("changes only the wording when web search is off", () => {
    const off = composeSystemPrompt({ webSearch: "off" });
    assert.match(off, /Веб-поиск сейчас недоступен/);
    assert.match(off, /--- Содержимое ссылок ---/, "link reading works without a search backend");

    const offUncensored = composeSystemPrompt({ uncensored: true, webSearch: "off" });
    assert.match(offUncensored, /Веб-поиск недоступен/);
    assert.match(offUncensored, /--- Содержимое ссылок ---/);
  });

  it("tells the model to use its own search on the native strategy", () => {
    const native = composeSystemPrompt({ webSearch: "native" });
    assert.match(native, /встроенный веб-поиск/);
    assert.match(native, /--- Содержимое ссылок ---/, "links are still read by us");

    const nativeUncensored = composeSystemPrompt({ uncensored: true, webSearch: "native" });
    assert.match(nativeUncensored, /встроенный веб-поиск/);
  });
});
