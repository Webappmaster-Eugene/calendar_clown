import { query } from "../db/connection.js";
import {
  MAX_EXPENSE_AMOUNT,
  MIN_EXPENSE_AMOUNT,
  MAX_SUBCATEGORY_LENGTH,
} from "../constants.js";
import type {
  Category,
  Expense,
  ExpenseWithCategory,
  CategoryTotal,
  UserTotal,
  MonthComparison,
  DbUser,
} from "./types.js";

// ─── Categories ───────────────────────────────────────────────────────

let categoriesCache: Category[] | null = null;

/** Fetch all active categories (cached in memory). */
export async function getCategories(): Promise<Category[]> {
  if (categoriesCache) return categoriesCache;
  const { rows } = await query<{
    id: number;
    name: string;
    emoji: string;
    aliases: string[];
    sort_order: number;
    is_active: boolean;
  }>(
    "SELECT id, name, emoji, aliases, sort_order, is_active FROM categories WHERE is_active = true ORDER BY sort_order"
  );
  categoriesCache = rows.map((r) => ({
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    aliases: r.aliases,
    sortOrder: r.sort_order,
    isActive: r.is_active,
  }));
  return categoriesCache;
}

/** Clear the in-memory categories cache (e.g., after admin changes). */
export function invalidateCategoriesCache(): void {
  categoriesCache = null;
}

// ─── Users ────────────────────────────────────────────────────────────

/** Create or update a user in the DB. Updates name fields if the user already exists. */
export async function ensureUser(
  telegramId: number,
  username: string | null,
  firstName: string,
  lastName: string | null,
  isAdmin: boolean
): Promise<DbUser> {
  const role = isAdmin ? "admin" : "user";

  const { rows: existing } = await query<{
    id: number;
    telegram_id: string;
    username: string | null;
    first_name: string;
    last_name: string | null;
    role: string;
    tribe_id: number;
  }>(
    "SELECT id, telegram_id, username, first_name, last_name, role, tribe_id FROM users WHERE telegram_id = $1",
    [telegramId]
  );

  if (existing.length > 0) {
    const row = existing[0];
    if (row.username !== username || row.first_name !== firstName || row.last_name !== lastName) {
      await query(
        "UPDATE users SET username = $1, first_name = $2, last_name = $3 WHERE id = $4",
        [username, firstName, lastName, row.id]
      );
    }
    return {
      id: row.id,
      telegramId: Number(row.telegram_id),
      username: username ?? row.username,
      firstName: firstName || row.first_name,
      lastName: lastName ?? row.last_name,
      role: row.role as "admin" | "user",
      tribeId: row.tribe_id,
    };
  }

  const { rows: tribes } = await query<{ id: number }>(
    "SELECT id FROM tribes ORDER BY id LIMIT 1"
  );
  const tribeId = tribes[0]?.id ?? 1;

  const { rows: inserted } = await query<{ id: number }>(
    `INSERT INTO users (telegram_id, username, first_name, last_name, role, tribe_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [telegramId, username, firstName, lastName, role, tribeId]
  );

  return {
    id: inserted[0].id,
    telegramId,
    username,
    firstName,
    lastName,
    role,
    tribeId,
  };
}

/** Look up a user by Telegram ID. Returns null if not found. */
export async function getUserByTelegramId(telegramId: number): Promise<DbUser | null> {
  const { rows } = await query<{
    id: number;
    telegram_id: string;
    username: string | null;
    first_name: string;
    last_name: string | null;
    role: string;
    tribe_id: number;
  }>(
    "SELECT id, telegram_id, username, first_name, last_name, role, tribe_id FROM users WHERE telegram_id = $1",
    [telegramId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
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

/** Check if a telegram user exists in the DB (used for access control). */
export async function isUserInDb(telegramId: number): Promise<boolean> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM users WHERE telegram_id = $1",
    [telegramId]
  );
  return parseInt(rows[0].count, 10) > 0;
}

/** List all users in a tribe. */
export async function listTribeUsers(tribeId: number): Promise<DbUser[]> {
  const { rows } = await query<{
    id: number;
    telegram_id: string;
    username: string | null;
    first_name: string;
    last_name: string | null;
    role: string;
    tribe_id: number;
  }>(
    "SELECT id, telegram_id, username, first_name, last_name, role, tribe_id FROM users WHERE tribe_id = $1 ORDER BY id",
    [tribeId]
  );
  return rows.map((r) => ({
    id: r.id,
    telegramId: Number(r.telegram_id),
    username: r.username,
    firstName: r.first_name,
    lastName: r.last_name,
    role: r.role as "admin" | "user",
    tribeId: r.tribe_id,
  }));
}

/** Add a new user by telegram ID (admin action). Returns the created user or null if already exists. */
export async function addUserByTelegramId(
  telegramId: number,
  role: "admin" | "user" = "user"
): Promise<DbUser | null> {
  const exists = await isUserInDb(telegramId);
  if (exists) return null;

  const { rows: tribes } = await query<{ id: number }>(
    "SELECT id FROM tribes ORDER BY id LIMIT 1"
  );
  const tribeId = tribes[0]?.id ?? 1;

  const { rows } = await query<{ id: number }>(
    `INSERT INTO users (telegram_id, username, first_name, role, tribe_id)
     VALUES ($1, NULL, '', $2, $3) RETURNING id`,
    [telegramId, role, tribeId]
  );

  return {
    id: rows[0].id,
    telegramId,
    username: null,
    firstName: "",
    lastName: null,
    role,
    tribeId,
  };
}

/** Remove a user by telegram ID (admin action). Returns true if deleted. */
export async function removeUserByTelegramId(telegramId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM users WHERE telegram_id = $1",
    [telegramId]
  );
  return (rowCount ?? 0) > 0;
}

/** Get user's current bot mode from DB. */
export async function getUserMode(telegramId: number): Promise<"calendar" | "expenses"> {
  const { rows } = await query<{ mode: string }>(
    "SELECT mode FROM users WHERE telegram_id = $1",
    [telegramId]
  );
  const mode = rows[0]?.mode;
  return mode === "expenses" ? "expenses" : "calendar";
}

/** Set user's bot mode in DB. */
export async function setUserMode(telegramId: number, mode: "calendar" | "expenses"): Promise<void> {
  await query(
    "UPDATE users SET mode = $1 WHERE telegram_id = $2",
    [mode, telegramId]
  );
}

/** Get display name for a tribe. Falls back to 'Семья'. */
export async function getTribeName(tribeId: number): Promise<string> {
  const { rows } = await query<{ name: string }>(
    "SELECT name FROM tribes WHERE id = $1",
    [tribeId]
  );
  return rows[0]?.name ?? "Семья";
}

// ─── Expenses CRUD ────────────────────────────────────────────────────

/** Insert a new expense. Validates amount range and subcategory length. */
export async function addExpense(
  userId: number,
  tribeId: number,
  categoryId: number,
  amount: number,
  subcategory: string | null,
  inputMethod: "text" | "voice"
): Promise<Expense> {
  // Anti-abuse validation
  if (amount < MIN_EXPENSE_AMOUNT || amount > MAX_EXPENSE_AMOUNT) {
    throw new Error(`Сумма должна быть от ${MIN_EXPENSE_AMOUNT} до ${MAX_EXPENSE_AMOUNT.toLocaleString("ru-RU")} ₽`);
  }
  if (!Number.isFinite(amount)) {
    throw new Error("Некорректная сумма");
  }
  const sanitizedSub = subcategory
    ? subcategory.slice(0, MAX_SUBCATEGORY_LENGTH).trim() || null
    : null;

  const { rows } = await query<{
    id: number;
    user_id: number;
    tribe_id: number;
    category_id: number;
    subcategory: string | null;
    amount: string;
    input_method: string;
    created_at: Date;
  }>(
    `INSERT INTO expenses (user_id, tribe_id, category_id, subcategory, amount, input_method)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, tribe_id, category_id, subcategory, amount, input_method, created_at`,
    [userId, tribeId, categoryId, sanitizedSub, amount, inputMethod]
  );
  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    tribeId: r.tribe_id,
    categoryId: r.category_id,
    subcategory: r.subcategory,
    amount: parseFloat(r.amount),
    inputMethod: r.input_method as "text" | "voice",
    createdAt: r.created_at,
  };
}

/** Delete an expense by ID. Only deletes if owned by the given user. */
export async function deleteExpense(expenseId: number, userId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM expenses WHERE id = $1 AND user_id = $2",
    [expenseId, userId]
  );
  return (rowCount ?? 0) > 0;
}

/** Get the most recent expense for a user (for undo). */
export async function getLastExpense(userId: number): Promise<ExpenseWithCategory | null> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    tribe_id: number;
    category_id: number;
    subcategory: string | null;
    amount: string;
    input_method: string;
    created_at: Date;
    category_name: string;
    category_emoji: string;
  }>(
    `SELECT e.id, e.user_id, e.tribe_id, e.category_id, e.subcategory, e.amount,
            e.input_method, e.created_at, c.name AS category_name, c.emoji AS category_emoji
     FROM expenses e
     JOIN categories c ON c.id = e.category_id
     WHERE e.user_id = $1
     ORDER BY e.created_at DESC
     LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    tribeId: r.tribe_id,
    categoryId: r.category_id,
    subcategory: r.subcategory,
    amount: parseFloat(r.amount),
    inputMethod: r.input_method as "text" | "voice",
    createdAt: r.created_at,
    categoryName: r.category_name,
    categoryEmoji: r.category_emoji,
  };
}

// ─── Aggregation ──────────────────────────────────────────────────────

/** Calculate total expenses for a tribe in a given month. */
export async function getMonthTotal(tribeId: number, year: number, month: number): Promise<number> {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const { rows } = await query<{ total: string | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE tribe_id = $1 AND created_at >= $2 AND created_at < $3`,
    [tribeId, start.toISOString(), end.toISOString()]
  );
  return parseFloat(rows[0].total ?? "0");
}

/** Get per-category expense totals for a tribe in a date range. */
export async function getCategoryTotals(
  tribeId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<CategoryTotal[]> {
  const { rows } = await query<{
    category_id: number;
    category_name: string;
    category_emoji: string;
    total: string;
    sort_order: number;
  }>(
    `SELECT c.id AS category_id, c.name AS category_name, c.emoji AS category_emoji,
            COALESCE(SUM(e.amount), 0) AS total, c.sort_order
     FROM categories c
     LEFT JOIN expenses e ON e.category_id = c.id
       AND e.tribe_id = $1
       AND e.created_at >= $2
       AND e.created_at < $3
     WHERE c.is_active = true
     GROUP BY c.id, c.name, c.emoji, c.sort_order
     HAVING COALESCE(SUM(e.amount), 0) > 0
     ORDER BY c.sort_order`,
    [tribeId, dateFrom.toISOString(), dateTo.toISOString()]
  );
  return rows.map((r) => ({
    categoryId: r.category_id,
    categoryName: r.category_name,
    categoryEmoji: r.category_emoji,
    total: parseFloat(r.total),
    sortOrder: r.sort_order,
  }));
}

/** Get per-user expense totals for a tribe in a date range. */
export async function getUserTotals(
  tribeId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<UserTotal[]> {
  const { rows } = await query<{
    user_id: number;
    first_name: string;
    total: string;
  }>(
    `SELECT e.user_id, u.first_name, COALESCE(SUM(e.amount), 0) AS total
     FROM expenses e
     JOIN users u ON u.id = e.user_id
     WHERE e.tribe_id = $1 AND e.created_at >= $2 AND e.created_at < $3
     GROUP BY e.user_id, u.first_name
     ORDER BY total DESC`,
    [tribeId, dateFrom.toISOString(), dateTo.toISOString()]
  );
  return rows.map((r) => ({
    userId: r.user_id,
    firstName: r.first_name,
    total: parseFloat(r.total),
  }));
}

/** Compare category totals between two months (for trend analysis). */
export async function getMonthComparison(
  tribeId: number,
  year1: number,
  month1: number,
  year2: number,
  month2: number
): Promise<MonthComparison[]> {
  const prevFrom = new Date(year1, month1 - 1, 1);
  const prevTo = new Date(year1, month1, 1);
  const currFrom = new Date(year2, month2 - 1, 1);
  const currTo = new Date(year2, month2, 1);

  const { rows } = await query<{
    category_id: number;
    category_name: string;
    category_emoji: string;
    sort_order: number;
    prev_total: string;
    curr_total: string;
  }>(
    `SELECT c.id AS category_id, c.name AS category_name, c.emoji AS category_emoji,
            c.sort_order,
            COALESCE(SUM(e.amount) FILTER (WHERE e.created_at >= $2 AND e.created_at < $3), 0) AS prev_total,
            COALESCE(SUM(e.amount) FILTER (WHERE e.created_at >= $4 AND e.created_at < $5), 0) AS curr_total
     FROM categories c
     LEFT JOIN expenses e ON e.category_id = c.id AND e.tribe_id = $1
     WHERE c.is_active = true
     GROUP BY c.id, c.name, c.emoji, c.sort_order
     HAVING COALESCE(SUM(e.amount) FILTER (WHERE e.created_at >= $2 AND e.created_at < $3), 0) > 0
        OR COALESCE(SUM(e.amount) FILTER (WHERE e.created_at >= $4 AND e.created_at < $5), 0) > 0
     ORDER BY c.sort_order`,
    [tribeId, prevFrom.toISOString(), prevTo.toISOString(), currFrom.toISOString(), currTo.toISOString()]
  );

  return rows.map((r) => {
    const prevTotal = parseFloat(r.prev_total);
    const currTotal = parseFloat(r.curr_total);
    return {
      categoryId: r.category_id,
      categoryName: r.category_name,
      categoryEmoji: r.category_emoji,
      sortOrder: r.sort_order,
      prevTotal,
      currTotal,
      diff: currTotal - prevTotal,
    };
  });
}

/** Get detailed expense rows for Excel export (includes user and category info). */
export async function getExpensesForExcel(
  tribeId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<Array<{
  categoryName: string;
  categoryEmoji: string;
  subcategory: string | null;
  amount: number;
  firstName: string;
  createdAt: Date;
  sortOrder: number;
}>> {
  const { rows } = await query<{
    category_name: string;
    category_emoji: string;
    subcategory: string | null;
    amount: string;
    first_name: string;
    created_at: Date;
    sort_order: number;
  }>(
    `SELECT c.name AS category_name, c.emoji AS category_emoji, e.subcategory,
            e.amount, u.first_name, e.created_at, c.sort_order
     FROM expenses e
     JOIN categories c ON c.id = e.category_id
     JOIN users u ON u.id = e.user_id
     WHERE e.tribe_id = $1 AND e.created_at >= $2 AND e.created_at < $3
     ORDER BY c.sort_order, e.created_at`,
    [tribeId, dateFrom.toISOString(), dateTo.toISOString()]
  );
  return rows.map((r) => ({
    categoryName: r.category_name,
    categoryEmoji: r.category_emoji,
    subcategory: r.subcategory,
    amount: parseFloat(r.amount),
    firstName: r.first_name,
    createdAt: r.created_at,
    sortOrder: r.sort_order,
  }));
}
