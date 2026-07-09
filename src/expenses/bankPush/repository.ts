/**
 * Database access for the bank push-notification webhook feature.
 * Kept separate from the general expenses repository to keep the feature cohesive.
 */
import { randomBytes } from "node:crypto";
import { query } from "../../db/connection.js";
import {
  MAX_EXPENSE_AMOUNT,
  MIN_EXPENSE_AMOUNT,
  MAX_SUBCATEGORY_LENGTH,
} from "../../constants.js";
import type { DbUser } from "../types.js";

const USER_COLUMNS = "id, telegram_id, username, first_name, last_name, role, tribe_id";

interface UserRow {
  id: number;
  telegram_id: string;
  username: string | null;
  first_name: string;
  last_name: string | null;
  role: string;
  tribe_id: number | null;
}

function mapUserRow(r: UserRow): DbUser {
  return {
    id: r.id,
    telegramId: Number(r.telegram_id),
    username: r.username,
    firstName: r.first_name,
    lastName: r.last_name,
    role: r.role as "admin" | "user",
    tribeId: r.tribe_id,
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
  const { rows } = await query<{ webhook_secret: string | null }>(
    "SELECT webhook_secret FROM users WHERE telegram_id = $1",
    [telegramId]
  );
  if (rows.length === 0) return null; // user not provisioned yet
  if (rows[0].webhook_secret) return rows[0].webhook_secret;

  const secret = generateSecret();
  const { rows: updated } = await query<{ webhook_secret: string }>(
    `UPDATE users SET webhook_secret = $1
     WHERE telegram_id = $2 AND webhook_secret IS NULL
     RETURNING webhook_secret`,
    [secret, telegramId]
  );
  if (updated.length > 0) return updated[0].webhook_secret;

  // Lost the race — return whatever the concurrent call stored.
  const { rows: fresh } = await query<{ webhook_secret: string | null }>(
    "SELECT webhook_secret FROM users WHERE telegram_id = $1",
    [telegramId]
  );
  return fresh[0]?.webhook_secret ?? null;
}

/** Rotate the user's webhook secret (invalidates the previous URL). */
export async function regenerateWebhookSecret(telegramId: number): Promise<string | null> {
  const secret = generateSecret();
  const { rows } = await query<{ webhook_secret: string }>(
    "UPDATE users SET webhook_secret = $1 WHERE telegram_id = $2 RETURNING webhook_secret",
    [secret, telegramId]
  );
  return rows[0]?.webhook_secret ?? null;
}

/** Resolve an inbound webhook secret to its owner. Returns null if unknown. */
export async function findUserByWebhookSecret(secret: string): Promise<DbUser | null> {
  const { rows } = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE webhook_secret = $1`,
    [secret]
  );
  return rows.length > 0 ? mapUserRow(rows[0]) : null;
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

  const { rows } = await query<{ id: number; created_at: Date }>(
    `INSERT INTO expenses
       (user_id, tribe_id, category_id, subcategory, amount, input_method, source, dedup_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, 'text', 'bank_push', $6, COALESCE($7::timestamptz, NOW()))
     ON CONFLICT (dedup_hash) WHERE dedup_hash IS NOT NULL DO NOTHING
     RETURNING id, created_at`,
    [
      input.userId,
      input.tribeId,
      input.categoryId,
      sanitizedSub,
      amount,
      input.dedupHash,
      input.createdAt ?? null,
    ]
  );

  if (rows.length === 0) return null; // duplicate — already recorded
  return { id: rows[0].id, createdAt: rows[0].created_at };
}
