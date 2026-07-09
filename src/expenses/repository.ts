import { and, count, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle.js";
import { categories, expenses, tribeMonthlyLimits, tribes, users } from "../db/schema.js";
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

function mapCategory(r: typeof categories.$inferSelect): Category {
  return {
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    aliases: r.aliases,
    description: r.description,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
    createdByUserId: r.createdByUserId,
  };
}

/** Fetch all active categories (cached in memory). */
export async function getCategories(): Promise<Category[]> {
  if (categoriesCache) return categoriesCache;
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(categories.sortOrder);
  categoriesCache = rows.map(mapCategory);
  return categoriesCache;
}

/** Clear the in-memory categories cache (e.g., after admin changes). */
export function invalidateCategoriesCache(): void {
  categoriesCache = null;
}

/** Next sort order for a new category (keeps it before the "Другое" fallback at 100). */
async function getNextCategorySortOrder(): Promise<number> {
  const [row] = await db
    .select({ next: sql<number>`coalesce(max(${categories.sortOrder}), 0) + 1`.mapWith(Number) })
    .from(categories)
    .where(lt(categories.sortOrder, 100));
  return row?.next ?? 1;
}

/** Create a new expense category (admin). */
export async function createCategory(input: {
  name: string;
  emoji: string;
  aliases?: string[];
  description?: string | null;
  createdByUserId: number;
}): Promise<Category> {
  const sortOrder = await getNextCategorySortOrder();
  const [row] = await db
    .insert(categories)
    .values({
      name: input.name,
      emoji: input.emoji,
      aliases: input.aliases ?? [],
      description: input.description ?? null,
      sortOrder,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  invalidateCategoriesCache();
  return mapCategory(row);
}

/** Update an existing category (admin). Only provided fields are changed. */
export async function updateCategory(
  categoryId: number,
  updates: {
    name?: string;
    emoji?: string;
    aliases?: string[];
    description?: string | null;
  }
): Promise<Category | null> {
  const set: PgUpdateSetSource<typeof categories> = {};
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.emoji !== undefined) set.emoji = updates.emoji;
  if (updates.aliases !== undefined) set.aliases = updates.aliases;
  if (updates.description !== undefined) set.description = updates.description;

  if (Object.keys(set).length === 0) {
    const existing = (await getCategories()).find((c) => c.id === categoryId);
    return existing ?? null;
  }

  const [row] = await db.update(categories).set(set).where(eq(categories.id, categoryId)).returning();
  invalidateCategoriesCache();
  return row ? mapCategory(row) : null;
}

/** Soft-delete a category (admin). Returns the affected row, or null if not found. */
export async function deactivateCategory(categoryId: number): Promise<Category | null> {
  const [row] = await db
    .update(categories)
    .set({ isActive: false })
    .where(eq(categories.id, categoryId))
    .returning();
  invalidateCategoriesCache();
  return row ? mapCategory(row) : null;
}

/** Reassign all expenses from one category to another. Returns rows moved. */
export async function reassignExpensesCategory(
  fromCategoryId: number,
  toCategoryId: number
): Promise<number> {
  const rows = await db
    .update(expenses)
    .set({ categoryId: toCategoryId, updatedAt: sql`now()` })
    .where(eq(expenses.categoryId, fromCategoryId))
    .returning({ id: expenses.id });
  return rows.length;
}

/** Fetch a single category by id, regardless of active state. */
export async function getCategoryById(categoryId: number): Promise<Category | null> {
  const [row] = await db.select().from(categories).where(eq(categories.id, categoryId));
  return row ? mapCategory(row) : null;
}

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
  const rows = await db
    .select({
      id: expenses.id,
      subcategory: expenses.subcategory,
      amount: expenses.amount,
      firstName: users.firstName,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .innerJoin(users, eq(users.id, expenses.userId))
    .where(
      and(
        eq(expenses.tribeId, tribeId),
        eq(expenses.categoryId, categoryId),
        gte(expenses.createdAt, dateFrom),
        lt(expenses.createdAt, dateTo),
      ),
    )
    .orderBy(desc(expenses.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    id: r.id,
    subcategory: r.subcategory,
    amount: parseFloat(r.amount),
    firstName: r.firstName,
    createdAt: r.createdAt,
  }));
}

/** Get all expenses for a tribe in a date range, sorted by category (sortOrder) then by createdAt DESC.
 *  Used to render the fully detailed monthly report (every operation visible per category). */
export async function getAllExpensesForReport(
  tribeId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<Array<{
  id: number;
  categoryId: number;
  subcategory: string | null;
  amount: number;
  firstName: string;
  createdAt: Date;
}>> {
  const rows = await db
    .select({
      id: expenses.id,
      categoryId: expenses.categoryId,
      subcategory: expenses.subcategory,
      amount: expenses.amount,
      firstName: users.firstName,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .innerJoin(users, eq(users.id, expenses.userId))
    .innerJoin(categories, eq(categories.id, expenses.categoryId))
    .where(
      and(eq(expenses.tribeId, tribeId), gte(expenses.createdAt, dateFrom), lt(expenses.createdAt, dateTo)),
    )
    .orderBy(categories.sortOrder, desc(expenses.createdAt));
  return rows.map((r) => ({
    id: r.id,
    categoryId: r.categoryId,
    subcategory: r.subcategory,
    amount: parseFloat(r.amount),
    firstName: r.firstName,
    createdAt: r.createdAt,
  }));
}

/** Count expenses in a category for a date range. */
export async function countExpensesByCategory(
  tribeId: number,
  categoryId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(expenses)
    .where(
      and(
        eq(expenses.tribeId, tribeId),
        eq(expenses.categoryId, categoryId),
        gte(expenses.createdAt, dateFrom),
        lt(expenses.createdAt, dateTo),
      ),
    );
  return row.value;
}

// ─── Users ────────────────────────────────────────────────────────────

function mapDbUser(r: typeof users.$inferSelect): DbUser {
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

/** Create or update a user in the DB. Updates name fields if the user already exists. */
export async function ensureUser(
  telegramId: number,
  username: string | null,
  firstName: string,
  lastName: string | null,
  isAdmin: boolean
): Promise<DbUser> {
  const role = isAdmin ? "admin" : "user";
  const tgId = BigInt(telegramId);

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.telegramId, tgId));

    if (existing) {
      // Only upgrade to admin (never downgrade), since other users may have been made admin via /admin
      const newRole = isAdmin && existing.role !== "admin" ? "admin" : existing.role;
      const needsUpdate =
        existing.username !== username ||
        existing.firstName !== firstName ||
        existing.lastName !== lastName ||
        newRole !== existing.role;

      if (needsUpdate) {
        await tx
          .update(users)
          .set({ username, firstName, lastName, role: newRole })
          .where(eq(users.id, existing.id));
      }
      return {
        id: existing.id,
        telegramId: Number(existing.telegramId),
        username: username ?? existing.username,
        firstName: firstName || existing.firstName,
        lastName: lastName ?? existing.lastName,
        role: newRole as "admin" | "user",
        tribeId: existing.tribeId,
      };
    }

    const [firstTribe] = await tx.select({ id: tribes.id }).from(tribes).orderBy(tribes.id).limit(1);
    const tribeId = firstTribe?.id ?? 1;

    const [inserted] = await tx
      .insert(users)
      .values({ telegramId: tgId, username, firstName, lastName, role, tribeId })
      .returning({ id: users.id });

    return { id: inserted.id, telegramId, username, firstName, lastName, role, tribeId };
  });
}

/** Look up a user by Telegram ID. Returns null if not found. */
export async function getUserByTelegramId(telegramId: number): Promise<DbUser | null> {
  const [row] = await db.select().from(users).where(eq(users.telegramId, BigInt(telegramId)));
  return row ? mapDbUser(row) : null;
}

/** Check if a telegram user exists in the DB (used for access control). */
export async function isUserInDb(telegramId: number): Promise<boolean> {
  const [row] = await db
    .select({ value: count() })
    .from(users)
    .where(eq(users.telegramId, BigInt(telegramId)));
  return row.value > 0;
}

/** List approved users without a tribe (for tribe assignment). */
export async function listUsersWithoutTribe(): Promise<DbUser[]> {
  const rows = await db
    .select()
    .from(users)
    .where(and(isNull(users.tribeId), eq(users.status, "approved"), ne(users.role, "admin")))
    .orderBy(users.id);
  return rows.map(mapDbUser);
}

/** List all approved (non-pending) users. */
export async function listAllApprovedUsers(): Promise<DbUser[]> {
  const rows = await db.select().from(users).where(ne(users.status, "pending")).orderBy(users.id);
  return rows.map(mapDbUser);
}

/** List all users in a tribe. */
export async function listTribeUsers(tribeId: number): Promise<DbUser[]> {
  const rows = await db.select().from(users).where(eq(users.tribeId, tribeId)).orderBy(users.id);
  return rows.map(mapDbUser);
}

/** Add a new user by telegram ID (admin action). Returns the created user or null if already exists. */
export async function addUserByTelegramId(
  telegramId: number,
  role: "admin" | "user" = "user"
): Promise<DbUser | null> {
  const exists = await isUserInDb(telegramId);
  if (exists) return null;

  const [firstTribe] = await db.select({ id: tribes.id }).from(tribes).orderBy(tribes.id).limit(1);
  const tribeId = firstTribe?.id ?? 1;

  const [inserted] = await db
    .insert(users)
    .values({ telegramId: BigInt(telegramId), username: null, firstName: "", role, tribeId })
    .returning({ id: users.id });

  return { id: inserted.id, telegramId, username: null, firstName: "", lastName: null, role, tribeId };
}

/** Remove a user by telegram ID (admin action). Returns true if deleted. */
export async function removeUserByTelegramId(telegramId: number): Promise<boolean> {
  const rows = await db
    .delete(users)
    .where(eq(users.telegramId, BigInt(telegramId)))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Create a pending user (onboarding request). No tribe assigned — admin assigns later. */
export async function createPendingUser(
  telegramId: number,
  username: string | null,
  firstName: string,
  lastName: string | null
): Promise<DbUser> {
  const [inserted] = await db
    .insert(users)
    .values({ telegramId: BigInt(telegramId), username, firstName, lastName, role: "user", status: "pending" })
    .returning({ id: users.id });

  return { id: inserted.id, telegramId, username, firstName, lastName, role: "user", tribeId: null };
}

/** Approve a pending user. */
export async function approveUser(telegramId: number): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ status: "approved" })
    .where(and(eq(users.telegramId, BigInt(telegramId)), eq(users.status, "pending")))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Reject a pending user (delete from DB so they can re-apply). */
export async function rejectUser(telegramId: number): Promise<boolean> {
  const rows = await db
    .delete(users)
    .where(and(eq(users.telegramId, BigInt(telegramId)), eq(users.status, "pending")))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** List all pending users. */
export async function listPendingUsers(): Promise<DbUser[]> {
  const rows = await db.select().from(users).where(eq(users.status, "pending")).orderBy(users.id);
  return rows.map(mapDbUser);
}

/** Get user status by telegram ID. Returns null if user not found. */
export async function getUserStatus(telegramId: number): Promise<string | null> {
  const [row] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.telegramId, BigInt(telegramId)));
  return row?.status ?? null;
}

/** Set user's tribe. */
export async function setUserTribe(telegramId: number, tribeId: number): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ tribeId })
    .where(eq(users.telegramId, BigInt(telegramId)))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Remove user from tribe (set tribe_id to NULL). */
export async function removeUserFromTribe(telegramId: number): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ tribeId: null })
    .where(eq(users.telegramId, BigInt(telegramId)))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** List all tribes. */
export async function listTribes(): Promise<Array<{ id: number; name: string }>> {
  return db.select({ id: tribes.id, name: tribes.name }).from(tribes).orderBy(tribes.name);
}

/** Create a new tribe. */
export async function createTribe(name: string): Promise<{ id: number; name: string }> {
  const [row] = await db.insert(tribes).values({ name }).returning({ id: tribes.id, name: tribes.name });
  return row;
}

/** Valid bot modes. */
type BotMode = "calendar" | "expenses" | "transcribe" | "simplifier" | "digest" | "broadcast" | "notable_dates" | "gandalf" | "neuro" | "wishlist" | "goals" | "reminders" | "osint" | "summarizer" | "blogger" | "nutritionist" | "admin" | "tasks";

const VALID_MODES: ReadonlySet<string> = new Set<BotMode>(["calendar", "expenses", "transcribe", "simplifier", "digest", "broadcast", "notable_dates", "gandalf", "neuro", "wishlist", "goals", "reminders", "osint", "summarizer", "blogger", "nutritionist", "admin", "tasks"]);

/** Get user's current bot mode from DB. */
export async function getUserMode(telegramId: number): Promise<BotMode> {
  const [row] = await db
    .select({ mode: users.mode })
    .from(users)
    .where(eq(users.telegramId, BigInt(telegramId)));
  const mode = row?.mode;
  return mode && VALID_MODES.has(mode) ? (mode as BotMode) : "calendar";
}

/** Set user's bot mode in DB. */
export async function setUserMode(telegramId: number, mode: BotMode): Promise<void> {
  await db.update(users).set({ mode }).where(eq(users.telegramId, BigInt(telegramId)));
}

/** Get display name for a tribe. Falls back to 'Семья'. */
export async function getTribeName(tribeId: number): Promise<string> {
  const [row] = await db.select({ name: tribes.name }).from(tribes).where(eq(tribes.id, tribeId));
  return row?.name ?? "Семья";
}

// ─── Expenses CRUD ────────────────────────────────────────────────────

/**
 * Insert a new expense. Validates amount range and subcategory length.
 * `createdAt` is optional: when omitted, PostgreSQL `NOW()` is used (current month).
 * When provided, it overrides the timestamp — used by Mini App to backdate expenses.
 */
export async function addExpense(
  userId: number,
  tribeId: number,
  categoryId: number,
  amount: number,
  subcategory: string | null,
  inputMethod: "text" | "voice",
  createdAt?: Date | null
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

  const [r] = await db
    .insert(expenses)
    .values({
      userId,
      tribeId,
      categoryId,
      subcategory: sanitizedSub,
      amount: String(amount),
      inputMethod,
      createdAt: createdAt ?? sql`now()`,
    })
    .returning();
  return {
    id: r.id,
    userId: r.userId,
    tribeId: r.tribeId,
    categoryId: r.categoryId,
    subcategory: r.subcategory,
    amount: parseFloat(r.amount),
    inputMethod: r.inputMethod as "text" | "voice",
    createdAt: r.createdAt,
  };
}

/** Get a single expense by ID with category info. */
export async function getExpenseById(expenseId: number): Promise<ExpenseWithCategory | null> {
  const [r] = await db
    .select({
      id: expenses.id,
      userId: expenses.userId,
      tribeId: expenses.tribeId,
      categoryId: expenses.categoryId,
      subcategory: expenses.subcategory,
      amount: expenses.amount,
      inputMethod: expenses.inputMethod,
      createdAt: expenses.createdAt,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
    })
    .from(expenses)
    .innerJoin(categories, eq(categories.id, expenses.categoryId))
    .where(eq(expenses.id, expenseId));
  if (!r) return null;
  return {
    id: r.id,
    userId: r.userId,
    tribeId: r.tribeId,
    categoryId: r.categoryId,
    subcategory: r.subcategory,
    amount: parseFloat(r.amount),
    inputMethod: r.inputMethod as "text" | "voice",
    createdAt: r.createdAt,
    categoryName: r.categoryName,
    categoryEmoji: r.categoryEmoji,
  };
}

/** Delete an expense by ID. Only deletes if owned by the given user. */
export async function deleteExpense(expenseId: number, userId: number): Promise<boolean> {
  const rows = await db
    .delete(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.userId, userId)))
    .returning({ id: expenses.id });
  return rows.length > 0;
}

/** Get the most recent expense for a user (for undo). */
export async function getLastExpense(userId: number): Promise<ExpenseWithCategory | null> {
  const [r] = await db
    .select({
      id: expenses.id,
      userId: expenses.userId,
      tribeId: expenses.tribeId,
      categoryId: expenses.categoryId,
      subcategory: expenses.subcategory,
      amount: expenses.amount,
      inputMethod: expenses.inputMethod,
      createdAt: expenses.createdAt,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
    })
    .from(expenses)
    .innerJoin(categories, eq(categories.id, expenses.categoryId))
    .where(eq(expenses.userId, userId))
    .orderBy(desc(expenses.createdAt))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    userId: r.userId,
    tribeId: r.tribeId,
    categoryId: r.categoryId,
    subcategory: r.subcategory,
    amount: parseFloat(r.amount),
    inputMethod: r.inputMethod as "text" | "voice",
    createdAt: r.createdAt,
    categoryName: r.categoryName,
    categoryEmoji: r.categoryEmoji,
  };
}

// ─── Aggregation ──────────────────────────────────────────────────────

/** Calculate total expenses for a tribe in a given month. */
export async function getMonthTotal(tribeId: number, year: number, month: number): Promise<number> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
    .from(expenses)
    .where(and(eq(expenses.tribeId, tribeId), gte(expenses.createdAt, start), lt(expenses.createdAt, end)));
  return parseFloat(row.total ?? "0");
}

/** Get per-category expense totals for a tribe in a date range. */
export async function getCategoryTotals(
  tribeId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<CategoryTotal[]> {
  const total = sql<string>`coalesce(sum(${expenses.amount}), 0)`;
  const rows = await db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      total,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .leftJoin(
      expenses,
      and(
        eq(expenses.categoryId, categories.id),
        eq(expenses.tribeId, tribeId),
        gte(expenses.createdAt, dateFrom),
        lt(expenses.createdAt, dateTo),
      ),
    )
    .where(eq(categories.isActive, true))
    .groupBy(categories.id, categories.name, categories.emoji, categories.sortOrder)
    .having(sql`coalesce(sum(${expenses.amount}), 0) > 0`)
    .orderBy(categories.sortOrder);
  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categoryEmoji: r.categoryEmoji,
    total: parseFloat(r.total),
    sortOrder: r.sortOrder,
  }));
}

/** Get per-user expense totals for a tribe in a date range. */
export async function getUserTotals(
  tribeId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<UserTotal[]> {
  const total = sql<string>`coalesce(sum(${expenses.amount}), 0)`;
  const rows = await db
    .select({ userId: expenses.userId, firstName: users.firstName, total })
    .from(expenses)
    .innerJoin(users, eq(users.id, expenses.userId))
    .where(and(eq(expenses.tribeId, tribeId), gte(expenses.createdAt, dateFrom), lt(expenses.createdAt, dateTo)))
    .groupBy(expenses.userId, users.firstName)
    .orderBy(desc(total));
  return rows.map((r) => ({ userId: r.userId, firstName: r.firstName, total: parseFloat(r.total) }));
}

/** Compare category totals between two months (for trend analysis).
 *  When `day` is provided, both ranges are capped to 1..day (partial-month comparison). */
export async function getMonthComparison(
  tribeId: number,
  year1: number,
  month1: number,
  year2: number,
  month2: number,
  day?: number
): Promise<MonthComparison[]> {
  const prevFrom = new Date(Date.UTC(year1, month1 - 1, 1));
  const prevTo = day ? new Date(Date.UTC(year1, month1 - 1, day + 1)) : new Date(Date.UTC(year1, month1, 1));
  const currFrom = new Date(Date.UTC(year2, month2 - 1, 1));
  const currTo = day ? new Date(Date.UTC(year2, month2 - 1, day + 1)) : new Date(Date.UTC(year2, month2, 1));

  const prevTotal = sql<string>`coalesce(sum(${expenses.amount}) filter (where ${expenses.createdAt} >= ${prevFrom} and ${expenses.createdAt} < ${prevTo}), 0)`;
  const currTotal = sql<string>`coalesce(sum(${expenses.amount}) filter (where ${expenses.createdAt} >= ${currFrom} and ${expenses.createdAt} < ${currTo}), 0)`;

  const rows = await db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      sortOrder: categories.sortOrder,
      prevTotal,
      currTotal,
    })
    .from(categories)
    .leftJoin(expenses, and(eq(expenses.categoryId, categories.id), eq(expenses.tribeId, tribeId)))
    .where(eq(categories.isActive, true))
    .groupBy(categories.id, categories.name, categories.emoji, categories.sortOrder)
    .having(sql`${prevTotal} > 0 or ${currTotal} > 0`)
    .orderBy(categories.sortOrder);

  return rows.map((r) => {
    const prev = parseFloat(r.prevTotal);
    const curr = parseFloat(r.currTotal);
    return {
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      categoryEmoji: r.categoryEmoji,
      sortOrder: r.sortOrder,
      prevTotal: prev,
      currTotal: curr,
      diff: curr - prev,
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
  const rows = await db
    .select({
      id: expenses.id,
      userId: expenses.userId,
      tribeId: expenses.tribeId,
      categoryId: expenses.categoryId,
      subcategory: expenses.subcategory,
      amount: expenses.amount,
      inputMethod: expenses.inputMethod,
      createdAt: expenses.createdAt,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      firstName: users.firstName,
    })
    .from(expenses)
    .innerJoin(categories, eq(categories.id, expenses.categoryId))
    .innerJoin(users, eq(users.id, expenses.userId))
    .where(eq(expenses.tribeId, tribeId))
    .orderBy(desc(expenses.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    tribeId: r.tribeId,
    categoryId: r.categoryId,
    subcategory: r.subcategory,
    amount: parseFloat(r.amount),
    inputMethod: r.inputMethod as "text" | "voice",
    createdAt: r.createdAt,
    categoryName: r.categoryName,
    categoryEmoji: r.categoryEmoji,
    firstName: r.firstName,
  }));
}

/** Admin: count all expenses for a tribe. */
export async function countExpenses(tribeId: number): Promise<number> {
  const [row] = await db.select({ value: count() }).from(expenses).where(eq(expenses.tribeId, tribeId));
  return row.value;
}

/** Admin: update expense fields (no ownership check). */
export async function updateExpense(
  expenseId: number,
  fields: { amount?: number; categoryId?: number; subcategory?: string | null; createdAt?: Date }
): Promise<boolean> {
  const set: PgUpdateSetSource<typeof expenses> = {};
  if (fields.amount !== undefined) set.amount = String(fields.amount);
  if (fields.categoryId !== undefined) set.categoryId = fields.categoryId;
  if (fields.subcategory !== undefined) set.subcategory = fields.subcategory;
  if (fields.createdAt !== undefined) set.createdAt = fields.createdAt;

  if (Object.keys(set).length === 0) return false;
  // updated_at always tracks the moment of edit
  set.updatedAt = sql`now()`;

  const rows = await db.update(expenses).set(set).where(eq(expenses.id, expenseId)).returning({ id: expenses.id });
  return rows.length > 0;
}

/** Admin: bulk delete expenses by ID array. */
export async function bulkDeleteExpenses(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.delete(expenses).where(inArray(expenses.id, ids)).returning({ id: expenses.id });
  return rows.length;
}

/** Admin: delete all expenses for a tribe. */
export async function deleteAllExpenses(tribeId: number): Promise<number> {
  const rows = await db.delete(expenses).where(eq(expenses.tribeId, tribeId)).returning({ id: expenses.id });
  return rows.length;
}

/** Admin: update tribe name/monthlyLimit. */
export async function updateTribe(
  tribeId: number,
  fields: { name?: string; monthlyLimit?: number | null }
): Promise<boolean> {
  const set: PgUpdateSetSource<typeof tribes> = {};
  if (fields.name !== undefined) set.name = fields.name;
  if (fields.monthlyLimit !== undefined) {
    set.monthlyLimit = fields.monthlyLimit === null ? null : String(fields.monthlyLimit);
  }

  if (Object.keys(set).length === 0) return false;

  const rows = await db.update(tribes).set(set).where(eq(tribes.id, tribeId)).returning({ id: tribes.id });
  return rows.length > 0;
}

/** Admin: delete a tribe (only if no users assigned). */
export async function deleteTribe(tribeId: number): Promise<boolean> {
  const [row] = await db.select({ value: count() }).from(users).where(eq(users.tribeId, tribeId));
  if (row.value > 0) return false;
  const rows = await db.delete(tribes).where(eq(tribes.id, tribeId)).returning({ id: tribes.id });
  return rows.length > 0;
}

/** Get detailed expense rows for Excel export (includes user and category info). */
export async function getExpensesForExcel(
  tribeId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<Array<{
  categoryId: number;
  categoryName: string;
  categoryEmoji: string;
  subcategory: string | null;
  amount: number;
  firstName: string;
  createdAt: Date;
  sortOrder: number;
}>> {
  const rows = await db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      subcategory: expenses.subcategory,
      amount: expenses.amount,
      firstName: users.firstName,
      createdAt: expenses.createdAt,
      sortOrder: categories.sortOrder,
    })
    .from(expenses)
    .innerJoin(categories, eq(categories.id, expenses.categoryId))
    .innerJoin(users, eq(users.id, expenses.userId))
    .where(and(eq(expenses.tribeId, tribeId), gte(expenses.createdAt, dateFrom), lt(expenses.createdAt, dateTo)))
    .orderBy(categories.sortOrder, expenses.createdAt);
  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categoryEmoji: r.categoryEmoji,
    subcategory: r.subcategory,
    amount: parseFloat(r.amount),
    firstName: r.firstName,
    createdAt: r.createdAt,
    sortOrder: r.sortOrder,
  }));
}

/**
 * For yearly pivot reports: returns per-(month, category) totals across the year.
 * One SQL roundtrip instead of 12×N. Months returned use 1..12.
 *
 * Month bucketing is done in UTC to stay consistent with `getMonthTotal` and
 * the rest of the reports — those treat a "month" as `[UTC(y, m-1, 1), UTC(y, m, 1))`.
 */
export async function getMonthlyCategoryTotalsForYear(
  tribeId: number,
  year: number
): Promise<Array<{ month: number; categoryId: number; total: number }>> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const monthExpr = sql<number>`extract(month from (${expenses.createdAt} at time zone 'UTC'))::int`.mapWith(Number);
  const rows = await db
    .select({
      month: monthExpr,
      categoryId: expenses.categoryId,
      total: sql<string>`coalesce(sum(${expenses.amount}), 0)`,
    })
    .from(expenses)
    .where(and(eq(expenses.tribeId, tribeId), gte(expenses.createdAt, start), lt(expenses.createdAt, end)))
    .groupBy(monthExpr, expenses.categoryId);
  return rows.map((r) => ({ month: r.month, categoryId: r.categoryId, total: parseFloat(r.total) }));
}

// ─── Monthly limit overrides ──────────────────────────────────────────

/**
 * Resolve the effective monthly spending limit for a tribe in a given month.
 * Lookup order:
 *   1. tribe_monthly_limits override for (tribe, year, month)
 *   2. tribes.monthly_limit (tribe-wide default)
 *   3. fallback (passed by caller, typically the ENV-based DEFAULT_MONTHLY_LIMIT)
 */
export async function getEffectiveMonthLimit(
  tribeId: number,
  year: number,
  month: number,
  fallback: number
): Promise<number> {
  const [override] = await db
    .select({ v: tribeMonthlyLimits.limitAmount })
    .from(tribeMonthlyLimits)
    .where(
      and(
        eq(tribeMonthlyLimits.tribeId, tribeId),
        eq(tribeMonthlyLimits.year, year),
        eq(tribeMonthlyLimits.month, month),
      ),
    );
  if (override?.v != null) {
    const v = parseFloat(override.v);
    if (Number.isFinite(v) && v > 0) return v;
  }

  const [tribe] = await db.select({ v: tribes.monthlyLimit }).from(tribes).where(eq(tribes.id, tribeId));
  if (tribe?.v != null) {
    const v = parseFloat(tribe.v);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return fallback;
}

/** Whether a tribe has an explicit override for the given month. */
export async function isMonthLimitOverridden(
  tribeId: number,
  year: number,
  month: number
): Promise<boolean> {
  const [row] = await db
    .select({ id: tribeMonthlyLimits.id })
    .from(tribeMonthlyLimits)
    .where(
      and(
        eq(tribeMonthlyLimits.tribeId, tribeId),
        eq(tribeMonthlyLimits.year, year),
        eq(tribeMonthlyLimits.month, month),
      ),
    )
    .limit(1);
  return !!row;
}

/** Returns the tribe-wide default limit (tribes.monthly_limit), or null if unset. */
export async function getTribeDefaultLimit(tribeId: number): Promise<number | null> {
  const [row] = await db.select({ v: tribes.monthlyLimit }).from(tribes).where(eq(tribes.id, tribeId));
  const raw = row?.v;
  if (raw == null) return null;
  const v = parseFloat(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Set the monthly spending limit.
 * - applyToFuture=false: UPSERT a single (tribe, year, month) override.
 * - applyToFuture=true:  set tribes.monthly_limit AND drop overrides for (year, month) and later
 *   so the new default takes effect for all future months.
 */
export async function setEffectiveMonthLimit(
  tribeId: number,
  year: number,
  month: number,
  amount: number,
  applyToFuture: boolean
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Лимит должен быть положительным числом.");
  }
  if (month < 1 || month > 12) {
    throw new Error("Некорректный месяц.");
  }

  if (applyToFuture) {
    await db.transaction(async (tx) => {
      await tx.update(tribes).set({ monthlyLimit: String(amount) }).where(eq(tribes.id, tribeId));
      // Remove overrides for this month and any later month so the new default applies cleanly.
      await tx.delete(tribeMonthlyLimits).where(
        and(
          eq(tribeMonthlyLimits.tribeId, tribeId),
          or(
            gt(tribeMonthlyLimits.year, year),
            and(eq(tribeMonthlyLimits.year, year), gte(tribeMonthlyLimits.month, month)),
          ),
        ),
      );
    });
    return;
  }

  await db
    .insert(tribeMonthlyLimits)
    .values({ tribeId, year, month, limitAmount: String(amount), updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: [tribeMonthlyLimits.tribeId, tribeMonthlyLimits.year, tribeMonthlyLimits.month],
      set: { limitAmount: sql`excluded.limit_amount`, updatedAt: sql`now()` },
    });
}
