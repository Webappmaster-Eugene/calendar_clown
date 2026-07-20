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

/** Cached in memory; invalidated by invalidateCategoriesCache. */
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

/** Only provided fields are changed. */
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

/** Soft-delete (isActive=false). Returns the affected row, or null if not found. */
export async function deactivateCategory(categoryId: number): Promise<Category | null> {
  const [row] = await db
    .update(categories)
    .set({ isActive: false })
    .where(eq(categories.id, categoryId))
    .returning();
  invalidateCategoriesCache();
  return row ? mapCategory(row) : null;
}

/** Returns rows moved. */
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

/** Returns inactive categories too. */
export async function getCategoryById(categoryId: number): Promise<Category | null> {
  const [row] = await db.select().from(categories).where(eq(categories.id, categoryId));
  return row ? mapCategory(row) : null;
}

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
      // Only upgrade to admin, never downgrade: users may have been made admin via /admin.
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

export async function getUserByTelegramId(telegramId: number): Promise<DbUser | null> {
  const [row] = await db.select().from(users).where(eq(users.telegramId, BigInt(telegramId)));
  return row ? mapDbUser(row) : null;
}

export async function isUserInDb(telegramId: number): Promise<boolean> {
  const [row] = await db
    .select({ value: count() })
    .from(users)
    .where(eq(users.telegramId, BigInt(telegramId)));
  return row.value > 0;
}

export async function listUsersWithoutTribe(): Promise<DbUser[]> {
  const rows = await db
    .select()
    .from(users)
    .where(and(isNull(users.tribeId), eq(users.status, "approved"), ne(users.role, "admin")))
    .orderBy(users.id);
  return rows.map(mapDbUser);
}

export async function listAllApprovedUsers(): Promise<DbUser[]> {
  const rows = await db.select().from(users).where(ne(users.status, "pending")).orderBy(users.id);
  return rows.map(mapDbUser);
}

export async function listTribeUsers(tribeId: number): Promise<DbUser[]> {
  const rows = await db.select().from(users).where(eq(users.tribeId, tribeId)).orderBy(users.id);
  return rows.map(mapDbUser);
}

/** Returns null if the user already exists. */
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

export async function removeUserByTelegramId(telegramId: number): Promise<boolean> {
  const rows = await db
    .delete(users)
    .where(eq(users.telegramId, BigInt(telegramId)))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** No tribe assigned — admin assigns later. */
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

export async function approveUser(telegramId: number): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ status: "approved" })
    .where(and(eq(users.telegramId, BigInt(telegramId)), eq(users.status, "pending")))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Deletes the row so the user can re-apply. */
export async function rejectUser(telegramId: number): Promise<boolean> {
  const rows = await db
    .delete(users)
    .where(and(eq(users.telegramId, BigInt(telegramId)), eq(users.status, "pending")))
    .returning({ id: users.id });
  return rows.length > 0;
}

export async function listPendingUsers(): Promise<DbUser[]> {
  const rows = await db.select().from(users).where(eq(users.status, "pending")).orderBy(users.id);
  return rows.map(mapDbUser);
}

export async function getUserStatus(telegramId: number): Promise<string | null> {
  const [row] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.telegramId, BigInt(telegramId)));
  return row?.status ?? null;
}

export async function setUserTribe(telegramId: number, tribeId: number): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ tribeId })
    .where(eq(users.telegramId, BigInt(telegramId)))
    .returning({ id: users.id });
  return rows.length > 0;
}

export async function removeUserFromTribe(telegramId: number): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ tribeId: null })
    .where(eq(users.telegramId, BigInt(telegramId)))
    .returning({ id: users.id });
  return rows.length > 0;
}

export async function listTribes(): Promise<Array<{ id: number; name: string }>> {
  return db.select({ id: tribes.id, name: tribes.name }).from(tribes).orderBy(tribes.name);
}

export async function createTribe(name: string): Promise<{ id: number; name: string }> {
  const [row] = await db.insert(tribes).values({ name }).returning({ id: tribes.id, name: tribes.name });
  return row;
}

type BotMode = "calendar" | "expenses" | "transcribe" | "simplifier" | "digest" | "broadcast" | "notable_dates" | "gandalf" | "neuro" | "wishlist" | "goals" | "reminders" | "osint" | "summarizer" | "blogger" | "nutritionist" | "admin" | "tasks";

const VALID_MODES: ReadonlySet<string> = new Set<BotMode>(["calendar", "expenses", "transcribe", "simplifier", "digest", "broadcast", "notable_dates", "gandalf", "neuro", "wishlist", "goals", "reminders", "osint", "summarizer", "blogger", "nutritionist", "admin", "tasks"]);

export async function getUserMode(telegramId: number): Promise<BotMode> {
  const [row] = await db
    .select({ mode: users.mode })
    .from(users)
    .where(eq(users.telegramId, BigInt(telegramId)));
  const mode = row?.mode;
  return mode && VALID_MODES.has(mode) ? (mode as BotMode) : "calendar";
}

export async function setUserMode(telegramId: number, mode: BotMode): Promise<void> {
  await db.update(users).set({ mode }).where(eq(users.telegramId, BigInt(telegramId)));
}

/** Falls back to 'Семья'. */
export async function getTribeName(tribeId: number): Promise<string> {
  const [row] = await db.select({ name: tribes.name }).from(tribes).where(eq(tribes.id, tribeId));
  return row?.name ?? "Семья";
}

// ─── Expenses CRUD ────────────────────────────────────────────────────

/** `createdAt` overrides the timestamp (Mini App backdates expenses); omit for NOW(). */
export async function addExpense(
  userId: number,
  tribeId: number,
  categoryId: number,
  amount: number,
  subcategory: string | null,
  inputMethod: "text" | "voice",
  createdAt?: Date | null
): Promise<Expense> {
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

/**
 * Guarded by an idempotency key: on a hash collision (partial unique index
 * idx_expenses_dedup_hash) the existing row is returned with deduped=true, so a
 * retried request (e.g. a voice upload the gateway timed out on) never duplicates.
 */
export async function addExpenseWithDedup(
  userId: number,
  tribeId: number,
  categoryId: number,
  amount: number,
  subcategory: string | null,
  inputMethod: "text" | "voice",
  dedupHash: string,
  createdAt?: Date | null
): Promise<{ expense: Expense; deduped: boolean }> {
  if (amount < MIN_EXPENSE_AMOUNT || amount > MAX_EXPENSE_AMOUNT) {
    throw new Error(`Сумма должна быть от ${MIN_EXPENSE_AMOUNT} до ${MAX_EXPENSE_AMOUNT.toLocaleString("ru-RU")} ₽`);
  }
  if (!Number.isFinite(amount)) {
    throw new Error("Некорректная сумма");
  }
  const sanitizedSub = subcategory
    ? subcategory.slice(0, MAX_SUBCATEGORY_LENGTH).trim() || null
    : null;

  const inserted = await db
    .insert(expenses)
    .values({
      userId,
      tribeId,
      categoryId,
      subcategory: sanitizedSub,
      amount: String(amount),
      inputMethod,
      dedupHash,
      createdAt: createdAt ?? sql`now()`,
    })
    .onConflictDoNothing({ target: expenses.dedupHash, where: sql`${expenses.dedupHash} is not null` })
    .returning();

  const row =
    inserted[0] ??
    (await db.select().from(expenses).where(eq(expenses.dedupHash, dedupHash)).limit(1))[0];
  if (!row) throw new Error("Не удалось сохранить трату");

  return {
    expense: {
      id: row.id,
      userId: row.userId,
      tribeId: row.tribeId,
      categoryId: row.categoryId,
      subcategory: row.subcategory,
      amount: parseFloat(row.amount),
      inputMethod: row.inputMethod as "text" | "voice",
      createdAt: row.createdAt,
    },
    deduped: inserted.length === 0,
  };
}

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

/** Only deletes if owned by the given user. */
export async function deleteExpense(expenseId: number, userId: number): Promise<boolean> {
  const rows = await db
    .delete(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.userId, userId)))
    .returning({ id: expenses.id });
  return rows.length > 0;
}

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

export async function getMonthTotal(tribeId: number, year: number, month: number): Promise<number> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
    .from(expenses)
    .where(and(eq(expenses.tribeId, tribeId), gte(expenses.createdAt, start), lt(expenses.createdAt, end)));
  return parseFloat(row.total ?? "0");
}

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

/** When `day` is provided, both ranges are capped to 1..day (partial-month comparison). */
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

export async function countExpenses(tribeId: number): Promise<number> {
  const [row] = await db.select({ value: count() }).from(expenses).where(eq(expenses.tribeId, tribeId));
  return row.value;
}

/** No ownership check (admin). */
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
  set.updatedAt = sql`now()`;

  const rows = await db.update(expenses).set(set).where(eq(expenses.id, expenseId)).returning({ id: expenses.id });
  return rows.length > 0;
}

export async function bulkDeleteExpenses(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.delete(expenses).where(inArray(expenses.id, ids)).returning({ id: expenses.id });
  return rows.length;
}

export async function deleteAllExpenses(tribeId: number): Promise<number> {
  const rows = await db.delete(expenses).where(eq(expenses.tribeId, tribeId)).returning({ id: expenses.id });
  return rows.length;
}

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

/** Only if no users are assigned. */
export async function deleteTribe(tribeId: number): Promise<boolean> {
  const [row] = await db.select({ value: count() }).from(users).where(eq(users.tribeId, tribeId));
  if (row.value > 0) return false;
  const rows = await db.delete(tribes).where(eq(tribes.id, tribeId)).returning({ id: tribes.id });
  return rows.length > 0;
}

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
 * Per-(month, category) totals across the year in one SQL roundtrip; months use 1..12.
 * Bucketed in UTC to stay consistent with `getMonthTotal` and the rest of the reports,
 * which treat a "month" as `[UTC(y, m-1, 1), UTC(y, m, 1))`.
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
      // Drop overrides for this month and later so the new default applies cleanly.
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
