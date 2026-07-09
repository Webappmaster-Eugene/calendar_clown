/**
 * Database access for the bank push-notification webhook feature.
 * Kept separate from the general expenses repository to keep the feature cohesive.
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/drizzle.js";
import { expenses, users } from "../../db/schema.js";
import {
  MAX_EXPENSE_AMOUNT,
  MIN_EXPENSE_AMOUNT,
  MAX_SUBCATEGORY_LENGTH,
} from "../../constants.js";
import type { DbUser } from "../types.js";

function mapUser(r: typeof users.$inferSelect): DbUser {
  return {
    id: r.id,
    telegramId: Number(r.telegramId),
    username: r.username,
    firstName: r.firstName,
    lastName: r.lastName,
    role: r.role as "admin" | "user",
    tribeId: r.tribeId,
  };
}

/** Generate a 32-byte (64 hex chars) webhook secret — same shape as the MTProto token. */
function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Return the user's webhook secret, creating one on first use.
 * Race-safe: the UPDATE only writes when the column is still NULL; on a lost race we
 * re-read the value the winner stored.
 */
export async function getOrCreateWebhookSecret(telegramId: number): Promise<string | null> {
  const [existing] = await db
    .select({ webhookSecret: users.webhookSecret })
    .from(users)
    .where(eq(users.telegramId, BigInt(telegramId)));
  if (!existing) return null; // user not provisioned yet
  if (existing.webhookSecret) return existing.webhookSecret;

  const secret = generateSecret();
  const [updated] = await db
    .update(users)
    .set({ webhookSecret: secret })
    .where(and(eq(users.telegramId, BigInt(telegramId)), isNull(users.webhookSecret)))
    .returning({ webhookSecret: users.webhookSecret });
  if (updated?.webhookSecret) return updated.webhookSecret;

  // Lost the race — return whatever the concurrent call stored.
  const [fresh] = await db
    .select({ webhookSecret: users.webhookSecret })
    .from(users)
    .where(eq(users.telegramId, BigInt(telegramId)));
  return fresh?.webhookSecret ?? null;
}

/** Rotate the user's webhook secret (invalidates the previous URL). */
export async function regenerateWebhookSecret(telegramId: number): Promise<string | null> {
  const secret = generateSecret();
  const [row] = await db
    .update(users)
    .set({ webhookSecret: secret })
    .where(eq(users.telegramId, BigInt(telegramId)))
    .returning({ webhookSecret: users.webhookSecret });
  return row?.webhookSecret ?? null;
}

/** Resolve an inbound webhook secret to its owner. Returns null if unknown. */
export async function findUserByWebhookSecret(secret: string): Promise<DbUser | null> {
  const [row] = await db.select().from(users).where(eq(users.webhookSecret, secret));
  return row ? mapUser(row) : null;
}

export interface InsertBankPushExpenseInput {
  userId: number;
  tribeId: number;
  categoryId: number;
  amount: number;
  subcategory: string | null;
  dedupHash: string;
  createdAt?: Date | null;
}

export interface InsertedBankPushExpense {
  id: number;
  createdAt: Date;
}

/**
 * Insert an expense originating from a bank push. Idempotent: if a row with the same
 * dedup_hash already exists (repeated delivery), returns null and inserts nothing.
 */
export async function insertBankPushExpense(
  input: InsertBankPushExpenseInput
): Promise<InsertedBankPushExpense | null> {
  const { amount } = input;
  if (!Number.isFinite(amount) || amount < MIN_EXPENSE_AMOUNT || amount > MAX_EXPENSE_AMOUNT) {
    throw new Error(
      `Сумма должна быть от ${MIN_EXPENSE_AMOUNT} до ${MAX_EXPENSE_AMOUNT.toLocaleString("ru-RU")} ₽`
    );
  }
  const sanitizedSub = input.subcategory
    ? input.subcategory.slice(0, MAX_SUBCATEGORY_LENGTH).trim() || null
    : null;

  const [row] = await db
    .insert(expenses)
    .values({
      userId: input.userId,
      tribeId: input.tribeId,
      categoryId: input.categoryId,
      subcategory: sanitizedSub,
      amount: String(amount),
      inputMethod: "text",
      source: "bank_push",
      dedupHash: input.dedupHash,
      createdAt: input.createdAt ?? sql`now()`,
    })
    // Partial unique index idx_expenses_dedup_hash ... WHERE dedup_hash IS NOT NULL.
    .onConflictDoNothing({ target: expenses.dedupHash, where: sql`${expenses.dedupHash} is not null` })
    .returning({ id: expenses.id, createdAt: expenses.createdAt });

  if (!row) return null; // duplicate — already recorded
  return { id: row.id, createdAt: row.createdAt };
}
