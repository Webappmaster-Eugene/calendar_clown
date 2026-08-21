import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTinkoffPush, stripTransferNoise } from "../src/expenses/bankPush/parseTinkoffPush.js";

/**
 * Unit tests for the T-Bank push parser.
 * Pure string logic — no DB required.
 * Run with: npx tsx --test tests/parseTinkoffPush.test.ts
 */

describe("parseTinkoffPush — expenses", () => {
  it("parses a simple purchase with balance", () => {
    const r = parseTinkoffPush("Т-Банк", "Покупка 540 ₽, Пятёрочка. Баланс 12 000 ₽");
    assert.equal(r.kind, "expense");
    assert.equal(r.amount, 540);
    assert.equal(r.currency, "RUB");
    assert.match(r.merchant ?? "", /Пятёрочка/);
  });

  it("parses decimal amount with nbsp thousands separator", () => {
    const r = parseTinkoffPush("Оплата", "Оплата 1 234,56 ₽. WILDBERRIES. Доступно: 5 000 ₽");
    assert.equal(r.kind, "expense");
    assert.equal(r.amount, 1234.56);
    assert.match(r.merchant ?? "", /WILDBERRIES/);
  });

  it("does NOT pick up the balance as the amount", () => {
    const r = parseTinkoffPush("Т-Банк", "Покупка 300 ₽. Кафе. Баланс 99 999 ₽");
    assert.equal(r.amount, 300);
  });

  it("strips card mask from merchant", () => {
    const r = parseTinkoffPush("Т-Банк", "Покупка. Карта *1234. OZON 750 ₽");
    assert.equal(r.kind, "expense");
    assert.equal(r.amount, 750);
    assert.match(r.merchant ?? "", /OZON/);
    assert.doesNotMatch(r.merchant ?? "", /1234/);
  });

  it("handles cash withdrawal as a spend", () => {
    const r = parseTinkoffPush("Т-Банк", "Снятие наличных 3 000 ₽. Банкомат");
    assert.equal(r.kind, "expense");
    assert.equal(r.amount, 3000);
  });

  it("accepts руб. suffix", () => {
    const r = parseTinkoffPush("Т-Банк", "Оплата 89 руб. Самокат");
    assert.equal(r.kind, "expense");
    assert.equal(r.amount, 89);
  });

  it("parses real Yota payment push (платеж + multi-line balance)", () => {
    // Actual prod sample: amount must be the payment, not the balance below it.
    const r = parseTinkoffPush("Yota", "Платеж на 10 ₽, счет RUB\nБаланс 5 521,51 ₽");
    assert.equal(r.kind, "expense");
    assert.equal(r.amount, 10);
  });
});

describe("parseTinkoffPush — non-expenses are skipped", () => {
  it("skips top-up (пополнение)", () => {
    const r = parseTinkoffPush("Т-Банк", "Пополнение 5 000 ₽. Баланс 17 000 ₽");
    assert.equal(r.kind, "income");
  });

  it("skips refund (возврат)", () => {
    const r = parseTinkoffPush("Т-Банк", "Возврат 300 ₽ от WILDBERRIES");
    assert.equal(r.kind, "income");
  });

  it("skips incoming transfer (перевод от)", () => {
    const r = parseTinkoffPush("Т-Банк", "Перевод от Иван И. 1 000 ₽");
    assert.equal(r.kind, "income");
  });

  it("skips declined operation", () => {
    const r = parseTinkoffPush("Т-Банк", "Покупка отклонена: недостаточно средств. 540 ₽");
    assert.equal(r.kind, "ignore");
  });

  it("skips confirmation-code push", () => {
    const r = parseTinkoffPush("Т-Банк", "Код для подтверждения: 1234");
    assert.equal(r.kind, "ignore");
  });

  it("skips foreign currency purchase", () => {
    const r = parseTinkoffPush("Т-Банк", "Покупка 20 $ AWS");
    assert.equal(r.kind, "ignore");
  });

  it("ignores an unrecognised format instead of guessing", () => {
    const r = parseTinkoffPush("Т-Банк", "Ваш кэшбэк за месяц готов");
    assert.equal(r.kind, "income"); // matched by кэшбэк keyword
  });

  it("ignores a spend keyword with no parseable amount", () => {
    const r = parseTinkoffPush("Т-Банк", "Покупка совершена успешно");
    assert.equal(r.kind, "ignore");
    assert.equal(r.amount, null);
  });

  it("keeps raw text for debugging", () => {
    const r = parseTinkoffPush("Т-Банк", "какой-то новый формат");
    assert.equal(r.kind, "ignore");
    assert.match(r.raw, /новый формат/);
  });
});

describe("parseTinkoffPush — merchant is cleaned of transfer boilerplate", () => {
  // Prod samples: before the cleanup every SBP payment was stored as
  // "<merchant> через СБП на счет RUB", which drowned the category matcher.
  it("strips 'через СБП на счет RUB'", () => {
    const r = parseTinkoffPush("Т-Банк", "Оплата 2 461 ₽ Timeweb через СБП на счет RUB");
    assert.equal(r.kind, "expense");
    assert.equal(r.amount, 2461);
    assert.equal(r.merchant, "Timeweb");
  });

  it("strips 'на счет RUB' without СБП", () => {
    const r = parseTinkoffPush("Т-Банк", "Оплата 416,78 ₽ iBank ZhKH на счет RUB");
    assert.equal(r.merchant, "iBank ZhKH");
  });

  it("strips 'на накоп счет'", () => {
    const r = parseTinkoffPush("Т-Банк", "Оплата 750 ₽ МТС на накоп счет");
    assert.equal(r.merchant, "МТС");
  });

  it("leaves a plain merchant untouched", () => {
    const r = parseTinkoffPush("Т-Банк", "Покупка 540 ₽, Пятёрочка. Баланс 12 000 ₽");
    assert.equal(r.merchant, "Пятёрочка");
  });
});

describe("stripTransferNoise — pinned against real stored merchants", () => {
  // These are the exact values drizzle/0019 rewrites in production. The SQL there
  // reimplements the same rules, so this table is the contract both sides must meet;
  // change it only together with the migration.
  const CASES: Array<[string, string]> = [
    ["Yota на счет RUB", "Yota"],
    ["ypdomylandsbp через СБП на счет RUB", "ypdomylandsbp"],
    ["LKK Orlovskiy energosb через СБП на счет RUB", "LKK Orlovskiy energosb"],
    ["iBank ZhKH на счет RUB", "iBank ZhKH"],
    ["Федеральная Налоговая Служба на счет RUB", "Федеральная Налоговая Служба"],
    ["МТС на накоп счет", "МТС"],
    ["32links ru через СБП на счет RUB", "32links ru"],
    ["https beta proxy promo через СБП на счет RUB", "https beta proxy promo"],
    ["РЖД через СБП на счет RUB", "РЖД"],
  ];

  for (const [input, expected] of CASES) {
    it(`cleans "${input}"`, () => {
      assert.equal(stripTransferNoise(input), expected);
    });
  }

  it("leaves a merchant without boilerplate alone", () => {
    assert.equal(stripTransferNoise("Пятёрочка"), "Пятёрочка");
  });

  it("is idempotent — re-running changes nothing", () => {
    for (const [input] of CASES) {
      const once = stripTransferNoise(input);
      assert.equal(stripTransferNoise(once), once);
    }
  });

  it("collapses to an empty string when the value is only boilerplate", () => {
    // The migration's NULLIF guard relies on this: such a row keeps its original text.
    assert.equal(stripTransferNoise("через СБП на счет RUB"), "");
  });
});
