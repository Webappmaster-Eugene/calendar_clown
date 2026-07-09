/**
 * Orchestration for a single inbound bank push: parse → classify → categorize →
 * record (idempotently) → confirm to the user.
 *
 * Called by the webhook route in oauthServer.ts. Returns a small status object; it
 * never throws for "expected" outcomes (skipped/duplicate/not-in-tribe) so the webhook
 * can always answer 200 and avoid MacroDroid's 24h retry storm.
 */
import { createHash } from "node:crypto";
import type { DbUser, Category } from "../types.js";
import { getCategories } from "../repository.js";
import { findCategory } from "../parser.js";
import { categorizeExpenseText } from "../categorizeWithAI.js";
import { parseTinkoffPush, type PushKind } from "./parseTinkoffPush.js";
import { insertBankPushExpense } from "./repository.js";
import { sendBankPushConfirmation } from "./confirm.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("bank-push-ingest");

const FALLBACK_CATEGORY_NAME = "Другое";
/** Fuzzy-match confidence threshold (aligned with parseExpenseText). */
const CONFIDENT_SCORE = 40;

export type IngestStatus = "recorded" | "duplicate" | "skipped" | "no_tribe" | "error";

export interface IngestResult {
  status: IngestStatus;
  /** For non-expense pushes: what kind it was. */
  kind?: PushKind;
  expenseId?: number;
}

export interface IngestInput {
  user: DbUser;
  title: string;
  text: string;
  /** Injected for testability; defaults to now. */
  now?: Date;
}

/**
 * Build an idempotency key. Duplicate deliveries of the same notification (the phone
 * fires twice, or two notification channels) collapse to one expense because they share
 * amount, merchant and minute bucket. A *minute* window (not hour) is used deliberately:
 * the webhook always answers 200 so the forwarder never retries, meaning real duplicates
 * arrive within seconds — while two genuine identical purchases an hour apart must both
 * be recorded.
 */
function buildDedupHash(telegramId: number, amount: number, merchant: string, minuteBucket: string): string {
  return createHash("sha256")
    .update(`${telegramId}|${amount.toFixed(2)}|${merchant.toLowerCase()}|${minuteBucket}`)
    .digest("hex");
}

/** Resolve a category for a merchant: fast fuzzy match → AI fallback → "Другое". */
async function resolveCategory(merchant: string | null, amount: number, categories: Category[]): Promise<Category> {
  const fallback = categories.find((c) => c.name === FALLBACK_CATEGORY_NAME) ?? categories[0];

  if (merchant) {
    const match = findCategory(merchant, categories);
    if (match && match.score >= CONFIDENT_SCORE) {
      return match.category;
    }
    // Low confidence — ask the AI. Feed "merchant amount" so the existing text
    // categorizer (which expects an amount) works; we only use its category.
    try {
      const ai = await categorizeExpenseText(`${merchant} ${amount}`, categories);
      if (ai) {
        return categories.find((c) => c.id === ai.categoryId) ?? fallback;
      }
    } catch (err) {
      log.warn("AI categorization failed, using fallback:", err);
    }
    // Fuzzy had *some* match but below threshold — better than nothing.
    if (match) return match.category;
  }

  return fallback;
}

export async function ingestBankPush(input: IngestInput): Promise<IngestResult> {
  const { user } = input;
  const parsed = parseTinkoffPush(input.title, input.text);

  if (parsed.kind !== "expense") {
    log.info("Skipping non-expense push (%s) for user %d: %s", parsed.kind, user.telegramId, parsed.raw);
    return { status: "skipped", kind: parsed.kind };
  }
  if (parsed.amount == null) {
    return { status: "skipped", kind: "ignore" };
  }
  if (!user.tribeId) {
    log.warn("User %d has no tribe; cannot record bank-push expense", user.telegramId);
    return { status: "no_tribe" };
  }

  const categories = await getCategories();
  const category = await resolveCategory(parsed.merchant, parsed.amount, categories);

  const now = input.now ?? new Date();
  const minuteBucket = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM (UTC)
  const dedupHash = buildDedupHash(user.telegramId, parsed.amount, parsed.merchant ?? "", minuteBucket);

  const inserted = await insertBankPushExpense({
    userId: user.id,
    tribeId: user.tribeId,
    categoryId: category.id,
    amount: parsed.amount,
    subcategory: parsed.merchant,
    dedupHash,
    createdAt: now,
  });

  if (!inserted) {
    log.info("Duplicate bank push for user %d (%s %d)", user.telegramId, parsed.merchant, parsed.amount);
    return { status: "duplicate" };
  }

  // Fire-and-forget confirmation; the expense is already saved.
  void sendBankPushConfirmation({
    telegramId: user.telegramId,
    expenseId: inserted.id,
    categoryEmoji: category.emoji,
    categoryName: category.name,
    merchant: parsed.merchant,
    amount: parsed.amount,
  });

  log.info("Recorded bank-push expense %d for user %d: %s %d → %s",
    inserted.id, user.telegramId, parsed.merchant, parsed.amount, category.name);
  return { status: "recorded", expenseId: inserted.id };
}
