import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseBankWebhookBody } from "../src/expenses/bankPush/parseWebhookBody.js";

/**
 * Unit tests for the bank-push webhook body parser.
 * Pure — no DB. Run with: npx tsx --test tests/parseWebhookBody.test.ts
 */

describe("parseBankWebhookBody", () => {
  it("parses clean JSON", () => {
    const r = parseBankWebhookBody('{"title":"Т-Банк","text":"Покупка 540 ₽ Пятёрочка"}');
    assert.equal(r.title, "Т-Банк");
    assert.equal(r.text, "Покупка 540 ₽ Пятёрочка");
  });

  it("tolerates a raw newline inside the JSON (MacroDroid does not escape) — real Yota sample", () => {
    const body = '{"title":"Yota","text":"Платеж на 10 ₽, счет RUB\nБаланс 5 521,51 ₽"}';
    const r = parseBankWebhookBody(body);
    assert.equal(r.title, "Yota");
    assert.equal(r.text, "Платеж на 10 ₽, счет RUB\nБаланс 5 521,51 ₽");
  });

  it("tolerates a raw double-quote inside the value", () => {
    const body = '{"title":"Т-Банк","text":"Покупка 300 ₽ КАФЕ "УЮТ""}';
    const r = parseBankWebhookBody(body);
    assert.equal(r.title, "Т-Банк");
    assert.match(r.text, /КАФЕ .*УЮТ/);
  });

  it("falls back to plain text: first line = title, rest = text", () => {
    const r = parseBankWebhookBody("Yota\nПлатеж на 10 ₽\nБаланс 5 521 ₽");
    assert.equal(r.title, "Yota");
    assert.equal(r.text, "Платеж на 10 ₽\nБаланс 5 521 ₽");
  });

  it("single-line non-JSON body → all text, empty title", () => {
    const r = parseBankWebhookBody("Покупка 540 ₽ Пятёрочка");
    assert.equal(r.title, "");
    assert.equal(r.text, "Покупка 540 ₽ Пятёрочка");
  });
});
