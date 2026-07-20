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

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Race-safe: the UPDATE only writes when the column is still NULL; on a lost race we
 * re-read the value the winner stored.
 */
export async function getOrCreateWebhookSecret(telegramId: number): Promise<string | null> {
  const [existing] = await db
    .select({ webhookSecret: users.webhookSecret })
    .from(users)
    .where(eq(users.telegramId, BigInt(telegramId)));
  if (!existing) return null;
  if (existing.webhookSecret) return existing.webhookSecret;

  const secret = generateSecret();
  const [updated] = await db
    .update(users)
    .set({ webhookSecret: secret })
    .where(and(eq(users.telegramId, BigInt(telegramId)), isNull(users.webhookSecret)))
    .returning({ webhookSecret: users.webhookSecret });
  if (updated?.webhookSecret) return updated.webhookSecret;

  const [fresh] = await db
    .select({ webhookSecret: users.webhookSecret })
    .from(users)
    .where(eq(users.telegramId, BigInt(telegramId)));
  return fresh?.webhookSecret ?? null;
}

export async function regenerateWebhookSecret(telegramId: number): Promise<string | null> {
  const secret = generateSecret();
  const [row] = await db
    .update(users)
    .set({ webhookSecret: secret })
    .where(eq(users.telegramId, BigInt(telegramId)))
    .returning({ webhookSecret: users.webhookSecret });
  return row?.webhookSecret ?? null;
}

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

/** Idempotent: on a repeated delivery (same dedup_hash) returns null and inserts nothing. */
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

  if (!row) return null;
  return { id: row.id, createdAt: row.createdAt };
}
