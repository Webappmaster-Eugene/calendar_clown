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

/** Create a new expense category (admin). */
export async function createCategory(
  name: string,
  emoji: string,
  aliases: string[] = [],
  sortOrder: number = 0
): Promise<Category> {
  const { rows } = await query<{
    id: number; name: string; emoji: string; aliases: string[]; sort_order: number; is_active: boolean;
  }>(
    `INSERT INTO categories (name, emoji, aliases, sort_order) VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, emoji, JSON.stringify(aliases), sortOrder]
  );
  invalidateCategoriesCache();
  const r = rows[0];
  return { id: r.id, name: r.name, emoji: r.emoji, aliases: r.aliases, sortOrder: r.sort_order, isActive: r.is_active };
}

/** Rename an existing category (admin). */
export async function renameCategory(categoryId: number, newName: string): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE categories SET name = $1 WHERE id = $2",
    [newName, categoryId]
  );
  invalidateCategoriesCache();
  return (rowCount ?? 0) > 0;
}

/** Set monthly limit for a category (stored in description-like field — here we use a lightweight approach). */
// Note: category limits could be stored in a separate table; for now we skip this
// as the plan focuses on adding the management UI.

/** Get detailed expense rows for a category in a date range (drilldown). */
export async function getExpensesByCategory(
  tribeId: number,
  categoryId: number,
  dateFrom: Date,
  dateTo: Date,
  limit: number = 20,
  offset: number = 0
): Promise<Array<{
  id: number;
  subcategory: string | null;
  amount: number;
  firstName: string;
  createdAt: Date;
}>> {
  const { rows } = await query<{
    id: number;
    subcategory: string | null;
    amount: string;
    first_name: string;
    created_at: Date;
  }>(
    `SELECT e.id, e.subcategory, e.amount, u.first_name, e.created_at
     FROM expenses e
     JOIN users u ON u.id = e.user_id
     WHERE e.tribe_id = $1 AND e.category_id = $2 AND e.created_at >= $3 AND e.created_at < $4
     ORDER BY e.created_at DESC
     LIMIT $5 OFFSET $6`,
    [tribeId, categoryId, dateFrom.toISOString(), dateTo.toISOString(), limit, offset]
  );
  return rows.map((r) => ({
    id: r.id,
    subcategory: r.subcategory,
    amount: parseFloat(r.amount),
    firstName: r.first_name,
    createdAt: r.created_at,
  }));
}

/** Count expenses in a category for a date range. */
export async function countExpensesByCategory(
  tribeId: number,
  categoryId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM expenses
     WHERE tribe_id = $1 AND category_id = $2 AND created_at >= $3 AND created_at < $4`,
    [tribeId, categoryId, dateFrom.toISOString(), dateTo.toISOString()]
  );
  return parseInt(rows[0].count, 10);
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
    tribe_id: number | null;
  }>(
    "SELECT id, telegram_id, username, first_name, last_name, role, tribe_id FROM users WHERE telegram_id = $1",
    [telegramId]
  );

  if (existing.length > 0) {
    const row = existing[0];
    // Only upgrade to admin (never downgrade), since other users may have been made admin via /admin
    const newRole = isAdmin && row.role !== "admin" ? "admin" : row.role;
    const needsUpdate =
      row.username !== username ||
      row.first_name !== firstName ||
      row.last_name !== lastName ||
      newRole !== row.role;

    if (needsUpdate) {
      await query(
        "UPDATE users SET username = $1, first_name = $2, last_name = $3, role = $4 WHERE id = $5",
        [username, firstName, lastName, newRole, row.id]
      );
    }
    return {
      id: row.id,
      telegramId: Number(row.telegram_id),
      username: username ?? row.username,
      firstName: firstName || row.first_name,
      lastName: lastName ?? row.last_name,
      role: newRole as "admin" | "user",
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
    tribe_id: number | null;
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

/** List approved users without a tribe (for tribe assignment). */
export async function listUsersWithoutTribe(): Promise<DbUser[]> {
  const { rows } = await query<{
    id: number;
    telegram_id: string;
    username: string | null;
    first_name: string;
    last_name: string | null;
    role: string;
    tribe_id: number | null;
  }>(
    `SELECT id, telegram_id, username, first_name, last_name, role, tribe_id
     FROM users
     WHERE tribe_id IS NULL AND COALESCE(status, 'approved') = 'approved' AND role != 'admin'
     ORDER BY id`
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

/** List all approved (non-pending) users. */
export async function listAllApprovedUsers(): Promise<DbUser[]> {
  const { rows } = await query<{
    id: number;
    telegram_id: string;
    username: string | null;
    first_name: string;
    last_name: string | null;
    role: string;
    tribe_id: number | null;
  }>(
    `SELECT id, telegram_id, username, first_name, last_name, role, tribe_id
     FROM users
     WHERE COALESCE(status, 'approved') != 'pending'
     ORDER BY id`
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

/** List all users in a tribe. */
export async function listTribeUsers(tribeId: number): Promise<DbUser[]> {
  const { rows } = await query<{
    id: number;
    telegram_id: string;
    username: string | null;
    first_name: string;
    last_name: string | null;
    role: string;
    tribe_id: number | null;
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

/** Create a pending user (onboarding request). No tribe assigned — admin assigns later. */
export async function createPendingUser(
  telegramId: number,
  username: string | null,
  firstName: string,
  lastName: string | null
): Promise<DbUser> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO users (telegram_id, username, first_name, last_name, role, status)
     VALUES ($1, $2, $3, $4, 'user', 'pending') RETURNING id`,
    [telegramId, username, firstName, lastName]
  );

  return {
    id: rows[0].id,
    telegramId,
    username,
    firstName,
    lastName,
    role: "user",
    tribeId: null,
  };
}

/** Approve a pending user. */
export async function approveUser(telegramId: number): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE users SET status = 'approved' WHERE telegram_id = $1 AND status = 'pending'",
    [telegramId]
  );
  return (rowCount ?? 0) > 0;
}

/** Reject a pending user (delete from DB so they can re-apply). */
export async function rejectUser(telegramId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM users WHERE telegram_id = $1 AND status = 'pending'",
    [telegramId]
  );
  return (rowCount ?? 0) > 0;
}

/** List all pending users. */
export async function listPendingUsers(): Promise<DbUser[]> {
  const { rows } = await query<{
    id: number;
    telegram_id: string;
    username: string | null;
    first_name: string;
    last_name: string | null;
    role: string;
    tribe_id: number | null;
  }>(
    "SELECT id, telegram_id, username, first_name, last_name, role, tribe_id FROM users WHERE status = 'pending' ORDER BY id"
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

/** Get user status by telegram ID. Returns null if user not found. */
export async function getUserStatus(telegramId: number): Promise<string | null> {
  const { rows } = await query<{ status: string }>(
    "SELECT COALESCE(status, 'approved') AS status FROM users WHERE telegram_id = $1",
    [telegramId]
  );
  return rows[0]?.status ?? null;
}

/** Set user's tribe. */
export async function setUserTribe(telegramId: number, tribeId: number): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE users SET tribe_id = $1 WHERE telegram_id = $2",
    [tribeId, telegramId]
  );
  return (rowCount ?? 0) > 0;
}

/** Remove user from tribe (set tribe_id to NULL). */
export async function removeUserFromTribe(telegramId: number): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE users SET tribe_id = NULL WHERE telegram_id = $1",
    [telegramId]
  );
  return (rowCount ?? 0) > 0;
}

/** List all tribes. */
export async function listTribes(): Promise<Array<{ id: number; name: string }>> {
  const { rows } = await query<{ id: number; name: string }>(
    "SELECT id, name FROM tribes ORDER BY name"
  );
  return rows;
}

/** Create a new tribe. */
export async function createTribe(name: string): Promise<{ id: number; name: string }> {
  const { rows } = await query<{ id: number; name: string }>(
    "INSERT INTO tribes (name) VALUES ($1) RETURNING id, name",
    [name]
  );
  return rows[0];
}

/** Valid bot modes. */
type BotMode = "calendar" | "expenses" | "transcribe" | "simplifier" | "digest" | "broadcast" | "notable_dates" | "gandalf" | "neuro" | "wishlist" | "goals" | "reminders" | "osint" | "summarizer" | "blogger" | "nutritionist" | "admin" | "tasks";

const VALID_MODES: ReadonlySet<string> = new Set<BotMode>(["calendar", "expenses", "transcribe", "simplifier", "digest", "broadcast", "notable_dates", "gandalf", "neuro", "wishlist", "goals", "reminders", "osint", "summarizer", "blogger", "nutritionist", "admin", "tasks"]);

/** Get user's current bot mode from DB. */
export async function getUserMode(telegramId: number): Promise<BotMode> {
  const { rows } = await query<{ mode: string }>(
    "SELECT mode FROM users WHERE telegram_id = $1",
    [telegramId]
  );
  const mode = rows[0]?.mode;
  return VALID_MODES.has(mode) ? (mode as BotMode) : "calendar";
}

/** Set user's bot mode in DB. */
export async function setUserMode(telegramId: number, mode: BotMode): Promise<void> {
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

/** Get a single expense by ID with category info. */
export async function getExpenseById(expenseId: number): Promise<ExpenseWithCategory | null> {
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
     WHERE e.id = $1`,
    [expenseId]
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

// ─── Admin functions ──────────────────────────────────────────────────

/** Admin: get expenses paginated with category/user info. */
export async function getExpensesPaginated(
  tribeId: number,
  limit: number,
  offset: number
): Promise<Array<ExpenseWithCategory & { firstName: string }>> {
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
    first_name: string;
  }>(
    `SELECT e.id, e.user_id, e.tribe_id, e.category_id, e.subcategory, e.amount,
            e.input_method, e.created_at, c.name AS category_name, c.emoji AS category_emoji,
            u.first_name
     FROM expenses e
     JOIN categories c ON c.id = e.category_id
     JOIN users u ON u.id = e.user_id
     WHERE e.tribe_id = $1
     ORDER BY e.created_at DESC
     LIMIT $2 OFFSET $3`,
    [tribeId, limit, offset]
  );
  return rows.map((r) => ({
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
    firstName: r.first_name,
  }));
}

/** Admin: count all expenses for a tribe. */
export async function countExpenses(tribeId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM expenses WHERE tribe_id = $1",
    [tribeId]
  );
  return parseInt(rows[0].count, 10);
}

/** Admin: update expense fields (no ownership check). */
export async function updateExpense(
  expenseId: number,
  fields: { amount?: number; categoryId?: number; subcategory?: string | null }
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (fields.amount !== undefined) {
    sets.push(`amount = $${idx++}`);
    params.push(fields.amount);
  }
  if (fields.categoryId !== undefined) {
    sets.push(`category_id = $${idx++}`);
    params.push(fields.categoryId);
  }
  if (fields.subcategory !== undefined) {
    sets.push(`subcategory = $${idx++}`);
    params.push(fields.subcategory);
  }

  if (sets.length === 0) return false;
  params.push(expenseId);

  const { rowCount } = await query(
    `UPDATE expenses SET ${sets.join(", ")} WHERE id = $${idx}`,
    params
  );
  return (rowCount ?? 0) > 0;
}

/** Admin: bulk delete expenses by ID array. */
export async function bulkDeleteExpenses(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await query(
    "DELETE FROM expenses WHERE id = ANY($1)",
    [ids]
  );
  return rowCount ?? 0;
}

/** Admin: delete all expenses for a tribe. */
export async function deleteAllExpenses(tribeId: number): Promise<number> {
  const { rowCount } = await query(
    "DELETE FROM expenses WHERE tribe_id = $1",
    [tribeId]
  );
  return rowCount ?? 0;
}

/** Admin: update tribe name/monthlyLimit. */
export async function updateTribe(
  tribeId: number,
  fields: { name?: string; monthlyLimit?: number | null }
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${idx++}`);
    params.push(fields.name);
  }
  if (fields.monthlyLimit !== undefined) {
    sets.push(`monthly_limit = $${idx++}`);
    params.push(fields.monthlyLimit);
  }

  if (sets.length === 0) return false;
  params.push(tribeId);

  const { rowCount } = await query(
    `UPDATE tribes SET ${sets.join(", ")} WHERE id = $${idx}`,
    params
  );
  return (rowCount ?? 0) > 0;
}

/** Admin: delete a tribe (only if no users assigned). */
export async function deleteTribe(tribeId: number): Promise<boolean> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM users WHERE tribe_id = $1",
    [tribeId]
  );
  if (parseInt(rows[0].count, 10) > 0) return false;
  const { rowCount } = await query("DELETE FROM tribes WHERE id = $1", [tribeId]);
  return (rowCount ?? 0) > 0;
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
