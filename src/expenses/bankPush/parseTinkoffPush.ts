/**
 * Only real outgoing purchases/debits become expenses; income, refunds, transfers,
 * declined operations and anything unrecognised are deliberately NOT recorded
 * (kind !== "expense"), because the `expenses` table is for spending only. Unknown
 * formats degrade to `kind: "ignore"` rather than guessing — a wrong expense is worse
 * than a missed one the user can add by hand.
 *
 * The keyword sets and regexes are tuned against representative samples; T-Bank push
 * wording drifts over time and across notification types, so revisit them against real
 * device output if the format changes.
 */

export type PushKind = "expense" | "income" | "ignore";

export interface ParsedPush {
  /** Only "expense" is written to the ledger. */
  kind: PushKind;
  amount: number | null;
  /** ISO 4217-ish currency code ("RUB" for ₽/руб). */
  currency: string;
  merchant: string | null;
  raw: string;
}

const EXPENSE_KEYWORDS = [
  "покупка",
  "оплата",
  "оплатили",
  "платеж",
  "платёж",
  "списание",
  "списали",
  "снятие",
  "потрачено",
];

const INCOME_KEYWORDS = [
  "пополнение",
  "пополнили",
  "возврат",
  "зачисление",
  "зачислен",
  "перевод от",
  "перевёл",
  "перевел",
  "начислен",
  "кэшбэк",
  "кешбэк",
  "внесение",
];

const IGNORE_KEYWORDS = [
  "отклон",
  "отказ",
  "недостаточно",
  "не хватает",
  "заблокир",
  "подтвердите",
  "код для",
];

/** Words after which the number is a balance, not the transaction amount. */
const BALANCE_MARKERS = /(баланс|доступно|остаток)/i;

/** Their presence means we skip: the ledger assumes RUB. */
const FOREIGN_CURRENCY = /(\$|€|£|usd|eur|gbp|доллар|евро)/i;

export function parseTinkoffPush(title: string, text: string): ParsedPush {
  const raw = [title, text].filter((s) => s && s.trim()).join(" — ").trim();
  const haystack = `${title} ${text}`.toLowerCase();

  const base: Omit<ParsedPush, "kind"> = {
    amount: null,
    currency: "RUB",
    merchant: null,
    raw,
  };

  // Failed/irrelevant events and income are checked before the spend test so an
  // ambiguous push (e.g. a refund that also mentions "оплата") is never recorded.
  if (IGNORE_KEYWORDS.some((k) => haystack.includes(k))) {
    return { ...base, kind: "ignore" };
  }

  if (INCOME_KEYWORDS.some((k) => haystack.includes(k))) {
    return { ...base, kind: "income" };
  }

  if (!EXPENSE_KEYWORDS.some((k) => haystack.includes(k))) {
    return { ...base, kind: "ignore" };
  }

  if (FOREIGN_CURRENCY.test(`${title} ${text}`)) {
    return { ...base, kind: "ignore" };
  }

  // Only look before any balance clause so we don't grab the balance as the amount.
  const beforeBalance = splitBeforeBalance(`${title}. ${text}`);

  const amountMatch = extractRubAmount(beforeBalance);
  if (amountMatch == null) {
    return { ...base, kind: "ignore" };
  }

  const merchant = extractMerchant(beforeBalance, amountMatch.matchedText);

  return {
    kind: "expense",
    amount: amountMatch.amount,
    currency: "RUB",
    merchant,
    raw,
  };
}

function splitBeforeBalance(text: string): string {
  const m = text.match(BALANCE_MARKERS);
  if (m && m.index !== undefined) {
    return text.slice(0, m.index);
  }
  return text;
}

interface AmountMatch {
  amount: number;
  /** The exact matched substring, used to cut the amount out for merchant extraction. */
  matchedText: string;
}

/**
 * Requires a ₽/руб marker so we never mistake a card mask, date or reference number
 * for the amount.
 */
function extractRubAmount(text: string): AmountMatch | null {
  const re = /(\d[\d\s  ]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|руб|р\.)/gi;
  const match = re.exec(text);
  if (!match) return null;

  const amount = normalizeNumber(match[1]);
  if (amount == null || amount <= 0) return null;

  return { amount, matchedText: match[0] };
}

/** "1 234,56" → 1234.56, "12 000" → 12000, "540" → 540. */
function normalizeNumber(raw: string): number | null {
  let s = raw.replace(/[\s  ]/g, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // RU convention: "." is thousands and "," is decimal (1.234,56 → 1234.56).
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function extractMerchant(text: string, amountText: string): string | null {
  let s = text;

  s = s.replace(amountText, " ");

  const allKeywords = [...EXPENSE_KEYWORDS];
  for (const k of allKeywords) {
    s = s.replace(new RegExp(k, "gi"), " ");
  }

  // Card masks like "Карта *1234", "*1234", "MIR-1234".
  s = s.replace(/карт[аы]?\s*\*?\d{2,4}/gi, " ");
  s = s.replace(/\*\d{2,4}/g, " ");

  s = s.replace(/₽|руб\.?|р\./gi, " ");
  s = s.replace(/\b\d[\d\s .:,-]*\d\b/g, " ");

  s = s.replace(/[.,;:]+/g, " ").replace(/\s{2,}/g, " ").trim();

  return s.length > 0 ? s : null;
}
