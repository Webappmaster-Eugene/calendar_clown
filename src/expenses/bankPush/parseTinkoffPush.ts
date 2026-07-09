/**
 * Parser for T-Bank (Тинькофф) push-notification text forwarded from a phone.
 *
 * A companion Android app (MacroDroid / Tasker) listens to notifications from the
 * T-Bank app and POSTs the notification title + text to the bot webhook. This module
 * turns that free-form text into a structured result.
 *
 * Design goals:
 * - Only real outgoing purchases/debits become expenses. Income, refunds, transfers,
 *   declined operations and anything unrecognised are deliberately NOT recorded
 *   (kind !== "expense"), because the `expenses` table is for spending only.
 * - Robust to formatting noise (nbsp thousands separators, comma decimals, balance
 *   clauses, card masks). Unknown formats degrade to `kind: "ignore"` rather than
 *   guessing — a wrong expense is worse than a missed one the user can add by hand.
 *
 * NOTE: T-Bank push wording changes over time and across notification types. The
 * keyword sets and regexes below are tuned against representative samples and covered
 * by unit tests; adjust them against real device output if the format drifts.
 */

export type PushKind = "expense" | "income" | "ignore";

export interface ParsedPush {
  /** What the notification represents. Only "expense" is written to the ledger. */
  kind: PushKind;
  /** Transaction amount in the detected currency, or null if none found. */
  amount: number | null;
  /** ISO 4217-ish currency code we detected ("RUB" for ₽/руб). */
  currency: string;
  /** Merchant / counterparty name, or null if it could not be extracted. */
  merchant: string | null;
  /** Original combined text, kept for logging/debugging unrecognised formats. */
  raw: string;
}

/** Keywords that mark a real outgoing spend. */
const EXPENSE_KEYWORDS = [
  "покупка",
  "оплата",
  "оплатили",
  "списание",
  "списали",
  "снятие",
  "потрачено",
];

/** Keywords that mark money coming in or being returned — never an expense. */
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

/** Keywords that mark a failed/irrelevant event — explicitly ignored. */
const IGNORE_KEYWORDS = [
  "отклон", // отклонена / отклонён
  "отказ",
  "недостаточно",
  "не хватает",
  "заблокир",
  "подтвердите",
  "код для",
];

/** Words after which the number is a balance, not the transaction amount. */
const BALANCE_MARKERS = /(баланс|доступно|остаток)/i;

/** Non-ruble currency tokens; their presence means we skip (table assumes RUB). */
const FOREIGN_CURRENCY = /(\$|€|£|usd|eur|gbp|доллар|евро)/i;

/**
 * Parse a T-Bank push notification into a structured expense candidate.
 *
 * @param title  Notification title (often the app/bank name or the operation type).
 * @param text   Notification body.
 */
export function parseTinkoffPush(title: string, text: string): ParsedPush {
  const raw = [title, text].filter((s) => s && s.trim()).join(" — ").trim();
  const haystack = `${title} ${text}`.toLowerCase();

  const base: Omit<ParsedPush, "kind"> = {
    amount: null,
    currency: "RUB",
    merchant: null,
    raw,
  };

  // 1) Failed / irrelevant events first — never record.
  if (IGNORE_KEYWORDS.some((k) => haystack.includes(k))) {
    return { ...base, kind: "ignore" };
  }

  // 2) Income / refunds / transfers in — never an expense.
  if (INCOME_KEYWORDS.some((k) => haystack.includes(k))) {
    return { ...base, kind: "income" };
  }

  // 3) Must look like a spend; otherwise ignore rather than guess.
  if (!EXPENSE_KEYWORDS.some((k) => haystack.includes(k))) {
    return { ...base, kind: "ignore" };
  }

  // Foreign-currency operation → skip (the ledger is RUB-only).
  if (FOREIGN_CURRENCY.test(`${title} ${text}`)) {
    return { ...base, kind: "ignore" };
  }

  // Only look at the part before any balance clause so we don't grab the balance.
  const beforeBalance = splitBeforeBalance(`${title}. ${text}`);

  const amountMatch = extractRubAmount(beforeBalance);
  if (amountMatch == null) {
    // Recognised as a spend but no parseable amount — don't fabricate one.
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

/** Return the substring before the first balance marker (or the whole string). */
function splitBeforeBalance(text: string): string {
  const m = text.match(BALANCE_MARKERS);
  if (m && m.index !== undefined) {
    return text.slice(0, m.index);
  }
  return text;
}

interface AmountMatch {
  amount: number;
  /** The exact matched substring (used to cut the amount out for merchant extraction). */
  matchedText: string;
}

/**
 * Extract the first ruble amount from text. Requires a ₽/руб marker so we never
 * mistake a card mask, date or reference number for the amount.
 * Handles "540 ₽", "1 234,56 ₽", nbsp/narrow-nbsp separators and "руб."/"р." suffixes.
 */
function extractRubAmount(text: string): AmountMatch | null {
  // number (with space/nbsp thousands and , or . decimals) followed by a ruble marker
  const re = /(\d[\d\s  ]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|руб|р\.)/gi;
  const match = re.exec(text);
  if (!match) return null;

  const amount = normalizeNumber(match[1]);
  if (amount == null || amount <= 0) return null;

  return { amount, matchedText: match[0] };
}

/**
 * Normalize a Russian-formatted number string to a JS number.
 * "1 234,56" → 1234.56, "12 000" → 12000, "540" → 540.
 */
function normalizeNumber(raw: string): number | null {
  let s = raw.replace(/[\s  ]/g, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // Assume "." thousands and "," decimal (RU convention): 1.234,56 → 1234.56
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract the merchant/counterparty by stripping the operation keyword, the amount,
 * card masks and leftover punctuation from the (pre-balance) text.
 */
function extractMerchant(text: string, amountText: string): string | null {
  let s = text;

  // Remove the amount occurrence.
  s = s.replace(amountText, " ");

  // Remove operation keywords.
  const allKeywords = [...EXPENSE_KEYWORDS];
  for (const k of allKeywords) {
    s = s.replace(new RegExp(k, "gi"), " ");
  }

  // Remove card masks like "Карта *1234", "*1234", "MIR-1234".
  s = s.replace(/карт[аы]?\s*\*?\d{2,4}/gi, " ");
  s = s.replace(/\*\d{2,4}/g, " ");

  // Remove leftover currency markers and standalone numbers (times, dates, refs).
  s = s.replace(/₽|руб\.?|р\./gi, " ");
  s = s.replace(/\b\d[\d\s .:,-]*\d\b/g, " ");

  // Collapse separators/punctuation and whitespace.
  s = s.replace(/[.,;:]+/g, " ").replace(/\s{2,}/g, " ").trim();

  return s.length > 0 ? s : null;
}
