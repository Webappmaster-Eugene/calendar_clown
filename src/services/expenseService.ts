/**
 * Expense business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import { parseExpenseText, parseMultipleExpenses, getCategoriesListWithAliases } from "../expenses/parser.js";
import {
  addExpense,
  addExpenseWithDedup,
  ensureUser,
  getMonthTotal,
  getCategoryTotals,
  getUserTotals,
  getMonthComparison,
  getUserByTelegramId,
  getTribeName,
  getLastExpense,
  deleteExpense,
  getExpensesForExcel,
  getExpensesByCategory,
  countExpensesByCategory,
  getAllExpensesForReport,
  getCategories,
  updateExpense,
  getExpenseById,
  getExpensesPaginated,
  countExpenses,
  getEffectiveMonthLimit,
  isMonthLimitOverridden,
  getTribeDefaultLimit,
  setEffectiveMonthLimit,
  getMonthlyCategoryTotalsForYear,
  createCategory as repoCreateCategory,
  updateCategory as repoUpdateCategory,
  deactivateCategory as repoDeactivateCategory,
  reassignExpensesCategory,
  getCategoryById,
} from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import type { Category } from "../expenses/types.js";
import {
  formatExpenseConfirmation,
  monthName,
} from "../expenses/formatter.js";
import { generateMonthlyExcel, generateYearlyExcel } from "../expenses/excel.js";
import { getMskNow, getMskYmd, getMonthRange, getMonthLimit } from "../utils/date.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import { createHash } from "node:crypto";
import type {
  ExpenseDto,
  CategoryDto,
  ExpenseReportDto,
  ExpenseDetailItemDto,
  RecentExpensesResponse,
  ComparisonDrilldownDto,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from "../shared/types.js";

const log = createLogger("expense-service");

// ─── Types ────────────────────────────────────────────────────

export interface AddExpenseResult {
  expense: ExpenseDto;
  monthTotal: number;
  monthlyLimit: number;
  month: number;
  confirmation: string;
}

export interface AddMultipleExpenseResult {
  expenses: Array<{ emoji: string; name: string; sub: string | null; amount: number }>;
  monthTotal: number;
  monthlyLimit: number;
  month: number;
  totalAmount: number;
}

export interface UndoInfo {
  id: number;
  categoryEmoji: string;
  categoryName: string;
  subcategory: string | null;
  amount: number;
  createdAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────

function requireDb(): void {
  if (!isDatabaseAvailable()) {
    throw new Error("База данных недоступна.");
  }
}

async function requireDbUser(telegramId: number) {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) throw new Error("Пользователь не найден.");
  return dbUser;
}

// ─── Service Functions ────────────────────────────────────────

/**
 * Add a single expense from text input.
 * Optional `createdAt` allows backdating the expense (used by Mini App for past months).
 */
export async function addExpenseFromText(
  telegramId: number,
  username: string | null,
  firstName: string,
  lastName: string | null,
  isAdmin: boolean,
  text: string,
  createdAt?: Date | null
): Promise<AddExpenseResult> {
  requireDb();

  // Multi-expense input (2+ parseable lines) is handled by addMultipleExpenses
  // before we get here. If the message spans several lines but only ONE is a real
  // expense (the rest are notes/junk), record that line cleanly — otherwise a
  // whole-text parse folds the junk lines into the subcategory.
  let parsed = await parseExpenseText(text);
  if (text.includes("\n")) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      const perLine: NonNullable<typeof parsed>[] = [];
      for (const line of lines) {
        const p = await parseExpenseText(line);
        if (p) perLine.push(p);
      }
      if (perLine.length === 1) parsed = perLine[0];
    }
  }
  if (!parsed) {
    throw new Error("Не удалось разобрать трату.");
  }

  const dbUser = await ensureUser(telegramId, username, firstName, lastName, isAdmin);
  if (!dbUser.tribeId) throw new Error("Расходы доступны только для участников трайба.");

  const expense = await addExpense(
    dbUser.id,
    dbUser.tribeId,
    parsed.categoryId,
    parsed.amount,
    parsed.subcategory,
    "text",
    createdAt ?? null
  );

  const { year: reportYear, month: reportMonth } = getMskYmd(expense.createdAt);
  const total = await getMonthTotal(dbUser.tribeId, reportYear, reportMonth);
  const limit = await getEffectiveMonthLimit(dbUser.tribeId, reportYear, reportMonth, getMonthLimit());

  const confirmation = formatExpenseConfirmation(
    parsed.categoryEmoji,
    parsed.categoryName,
    parsed.subcategory,
    parsed.amount,
    expense.createdAt,
    dbUser.firstName || firstName || "Пользователь",
    total,
    limit,
    monthName(reportMonth)
  );

  return {
    expense: {
      id: expense.id,
      categoryId: parsed.categoryId,
      categoryName: parsed.categoryName,
      categoryEmoji: parsed.categoryEmoji,
      subcategory: parsed.subcategory,
      amount: parsed.amount,
      inputMethod: "text",
      createdAt: expense.createdAt.toISOString(),
    },
    monthTotal: total,
    monthlyLimit: limit,
    month: reportMonth,
    confirmation,
  };
}

/**
 * Add expense from structured input (categoryId + amount).
 * Used by Mini App form when user selects category from dropdown.
 * Optional `createdAt` allows backdating to any past month.
 */
export async function addExpenseStructured(
  telegramId: number,
  username: string | null,
  firstName: string,
  lastName: string | null,
  isAdmin: boolean,
  categoryId: number,
  amount: number,
  subcategory?: string,
  createdAt?: Date | null
): Promise<AddExpenseResult> {
  requireDb();

  const dbUser = await ensureUser(telegramId, username, firstName, lastName, isAdmin);
  if (!dbUser.tribeId) throw new Error("Расходы доступны только для участников трайба.");

  const cats = await getCategories();
  const cat = cats.find((c) => c.id === categoryId);
  if (!cat) throw new Error("Категория не найдена.");

  const expense = await addExpense(
    dbUser.id,
    dbUser.tribeId,
    categoryId,
    amount,
    subcategory ?? null,
    "text",
    createdAt ?? null
  );

  const { year: reportYear, month: reportMonth } = getMskYmd(expense.createdAt);
  const total = await getMonthTotal(dbUser.tribeId, reportYear, reportMonth);
  const limit = await getEffectiveMonthLimit(dbUser.tribeId, reportYear, reportMonth, getMonthLimit());

  const confirmation = formatExpenseConfirmation(
    cat.emoji,
    cat.name,
    subcategory ?? null,
    amount,
    expense.createdAt,
    dbUser.firstName || firstName || "Пользователь",
    total,
    limit,
    monthName(reportMonth)
  );

  return {
    expense: {
      id: expense.id,
      categoryId,
      categoryName: cat.name,
      categoryEmoji: cat.emoji,
      subcategory: subcategory ?? null,
      amount,
      inputMethod: "text",
      createdAt: expense.createdAt.toISOString(),
    },
    monthTotal: total,
    monthlyLimit: limit,
    month: reportMonth,
    confirmation,
  };
}

export async function addMultipleExpenses(
  telegramId: number,
  username: string | null,
  firstName: string,
  lastName: string | null,
  isAdmin: boolean,
  text: string
): Promise<AddMultipleExpenseResult | null> {
  requireDb();

  const multiParsed = await parseMultipleExpenses(text);
  if (multiParsed.length <= 1) return null;

  const dbUser = await ensureUser(telegramId, username, firstName, lastName, isAdmin);
  if (!dbUser.tribeId) throw new Error("Расходы доступны только для участников трайба.");

  const savedExpenses: Array<{ emoji: string; name: string; sub: string | null; amount: number }> = [];
  for (const p of multiParsed) {
    await addExpense(dbUser.id, dbUser.tribeId, p.categoryId, p.amount, p.subcategory, "text");
    savedExpenses.push({ emoji: p.categoryEmoji, name: p.categoryName, sub: p.subcategory, amount: p.amount });
  }

  const { year, month } = getMskNow();
  const total = await getMonthTotal(dbUser.tribeId, year, month);
  const limit = await getEffectiveMonthLimit(dbUser.tribeId, year, month, getMonthLimit());
  const totalAmount = savedExpenses.reduce((s, e) => s + e.amount, 0);

  return { expenses: savedExpenses, monthTotal: total, monthlyLimit: limit, month, totalAmount };
}

/**
 * Add expense from voice input.
 * Uses direct category lookup instead of re-parsing through text pipeline.
 */
export async function addExpenseFromVoice(
  telegramId: number,
  username: string | null,
  firstName: string,
  lastName: string | null,
  isAdmin: boolean,
  categoryName: string,
  subcategory: string | null,
  amount: number,
  // When true, the insert is idempotent: a retry with the same user/amount/category/
  // subcategory within the same minute returns the existing row instead of a dup.
  // Used by the Mini App API path (a gateway timeout can make the client re-send);
  // the bot processes each voice message once and leaves this off.
  dedup: boolean = false
): Promise<AddExpenseResult> {
  requireDb();

  const categories = await getCategories();
  const normalizedName = categoryName.toLowerCase().trim();
  let cat = categories.find((c) => c.name.toLowerCase() === normalizedName);

  // If AI returned a name that doesn't exactly match, try alias matching
  if (!cat) {
    cat = categories.find((c) =>
      c.aliases.some((a) => a.toLowerCase() === normalizedName)
    );
  }

  if (!cat) {
    cat = categories.find((c) => c.name === "Другое");
  }

  if (!cat) {
    throw new Error("Не удалось определить категорию из голосового сообщения.");
  }

  const dbUser = await ensureUser(telegramId, username, firstName, lastName, isAdmin);
  if (!dbUser.tribeId) throw new Error("Расходы доступны только для участников трайба.");

  // If we fell back to "Другое" and there's no subcategory, preserve the original AI category guess
  const effectiveSubcategory =
    cat.name === "Другое" && !subcategory && categoryName !== "Другое"
      ? categoryName
      : subcategory;

  let expense: Awaited<ReturnType<typeof addExpense>>;
  if (dedup) {
    const now = new Date();
    const minuteBucket = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM (UTC)
    const dedupHash = createHash("sha256")
      .update(`voice|${telegramId}|${amount.toFixed(2)}|${cat.id}|${(effectiveSubcategory ?? "").toLowerCase().trim()}|${minuteBucket}`)
      .digest("hex");
    const res = await addExpenseWithDedup(dbUser.id, dbUser.tribeId, cat.id, amount, effectiveSubcategory, "voice", dedupHash, now);
    expense = res.expense;
    if (res.deduped) {
      log.info(`Voice expense deduped (idempotent retry) for user ${telegramId}`);
    }
  } else {
    expense = await addExpense(dbUser.id, dbUser.tribeId, cat.id, amount, effectiveSubcategory, "voice");
  }

  const { year, month } = getMskNow();
  const total = await getMonthTotal(dbUser.tribeId, year, month);
  const limit = await getEffectiveMonthLimit(dbUser.tribeId, year, month, getMonthLimit());

  const confirmation = formatExpenseConfirmation(
    cat.emoji,
    cat.name,
    effectiveSubcategory,
    amount,
    expense.createdAt,
    dbUser.firstName || firstName || "Пользователь",
    total,
    limit,
    monthName(month)
  );

  return {
    expense: {
      id: expense.id,
      categoryId: cat.id,
      categoryName: cat.name,
      categoryEmoji: cat.emoji,
      subcategory: effectiveSubcategory,
      amount,
      inputMethod: "voice",
      createdAt: expense.createdAt.toISOString(),
    },
    monthTotal: total,
    monthlyLimit: limit,
    month,
    confirmation,
  };
}

/**
 * Get monthly expense report.
 *
 * @param includeDetails  When true, also fetch every operation grouped by category
 *                        and place them into `byCategoryDetailed`. The bot's /expenses
 *                        report uses this to render the fully detailed view. The API
 *                        used by the Mini App leaves it false (the app pulls per-category
 *                        details on demand via /api/expenses/drilldown).
 */
export async function getMonthReport(
  telegramId: number,
  year: number,
  month: number,
  includeDetails: boolean = false
): Promise<ExpenseReportDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) throw new Error("Нет трайба.");

  const mskNow = getMskNow();
  const isCurrentMonth = year === mskNow.year && month === mskNow.month;
  const comparisonDay = isCurrentMonth ? mskNow.day : undefined;

  const { from, to } = getMonthRange(year, month);
  const [totals, userTotals, prevComparison, detailedRows] = await Promise.all([
    getCategoryTotals(dbUser.tribeId, from, to),
    getUserTotals(dbUser.tribeId, from, to),
    getMonthComparison(
      dbUser.tribeId,
      month === 1 ? year - 1 : year,
      month === 1 ? 12 : month - 1,
      year,
      month,
      comparisonDay
    ),
    includeDetails
      ? getAllExpensesForReport(dbUser.tribeId, from, to)
      : Promise.resolve(null),
  ]);

  const grandTotal = totals.reduce((s, t) => s + t.total, 0);
  const limit = await getEffectiveMonthLimit(dbUser.tribeId, year, month, getMonthLimit());

  let byCategoryDetailed: ExpenseReportDto["byCategoryDetailed"];
  if (detailedRows) {
    const byCat = new Map<number, ExpenseDetailItemDto[]>();
    for (const row of detailedRows) {
      const list = byCat.get(row.categoryId);
      const dto: ExpenseDetailItemDto = {
        id: row.id,
        subcategory: row.subcategory,
        amount: row.amount,
        firstName: row.firstName,
        createdAt: row.createdAt.toISOString(),
      };
      if (list) list.push(dto);
      else byCat.set(row.categoryId, [dto]);
    }
    byCategoryDetailed = totals.map((t) => ({
      categoryId: t.categoryId,
      expenses: byCat.get(t.categoryId) ?? [],
    }));
  }

  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    byCategory: totals.map((t) => ({
      categoryId: t.categoryId,
      categoryName: t.categoryName,
      categoryEmoji: t.categoryEmoji,
      total: t.total,
      sortOrder: t.sortOrder,
    })),
    byUser: userTotals.map((u) => ({
      userId: u.userId,
      firstName: u.firstName,
      total: u.total,
    })),
    total: grandTotal,
    monthlyLimit: limit,
    comparison: prevComparison.map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      categoryEmoji: c.categoryEmoji,
      sortOrder: c.sortOrder,
      prevTotal: c.prevTotal,
      currTotal: c.currTotal,
      diff: c.diff,
    })),
    comparisonDay,
    byCategoryDetailed,
  };
}

export async function getYearReport(
  telegramId: number,
  year: number
): Promise<Array<{ month: number; total: number }>> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) throw new Error("Нет трайба.");

  const monthlyData: Array<{ month: number; total: number }> = [];
  for (let m = 1; m <= 12; m++) {
    const total = await getMonthTotal(dbUser.tribeId, year, m);
    monthlyData.push({ month: m, total });
  }
  return monthlyData;
}

export async function generateExcel(
  telegramId: number,
  year: number,
  month: number
): Promise<{ buffer: Buffer; filename: string } | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) throw new Error("Нет трайба.");

  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));

  const [categoryTotals, detailedRows] = await Promise.all([
    getCategoryTotals(dbUser.tribeId, from, to),
    getExpensesForExcel(dbUser.tribeId, from, to),
  ]);

  if (categoryTotals.length === 0) return null;

  const limit = await getEffectiveMonthLimit(dbUser.tribeId, year, month, getMonthLimit());
  const tribeName = await getTribeName(dbUser.tribeId);
  const buffer = await generateMonthlyExcel(categoryTotals, detailedRows, year, month, tribeName, limit);
  const filename = `Расходы_${monthName(month)}_${year}.xlsx`;

  return { buffer, filename };
}

/**
 * Generate Excel file for an entire year.
 * Year limit = sum of effective monthly limits across the 12 months,
 * so per-month overrides are respected.
 */
export async function generateYearExcel(
  telegramId: number,
  year: number
): Promise<{ buffer: Buffer; filename: string } | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) throw new Error("Нет трайба.");

  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  const [categoryTotals, detailedRows, pivotCells, tribeName] = await Promise.all([
    getCategoryTotals(dbUser.tribeId, from, to),
    getExpensesForExcel(dbUser.tribeId, from, to),
    getMonthlyCategoryTotalsForYear(dbUser.tribeId, year),
    getTribeName(dbUser.tribeId),
  ]);

  if (categoryTotals.length === 0) return null;

  const fallback = getMonthLimit();
  let yearLimit = 0;
  for (let m = 1; m <= 12; m++) {
    yearLimit += await getEffectiveMonthLimit(dbUser.tribeId, year, m, fallback);
  }

  const buffer = await generateYearlyExcel(
    categoryTotals,
    pivotCells,
    detailedRows,
    year,
    tribeName,
    yearLimit
  );
  const filename = `Расходы_${year}_год.xlsx`;

  return { buffer, filename };
}

export async function getUndoInfo(telegramId: number): Promise<UndoInfo | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const last = await getLastExpense(dbUser.id);
  if (!last) return null;

  const UNDO_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const ageMs = Date.now() - last.createdAt.getTime();
  if (ageMs > UNDO_MAX_AGE_MS) return null;

  return {
    id: last.id,
    categoryEmoji: last.categoryEmoji,
    categoryName: last.categoryName,
    subcategory: last.subcategory,
    amount: last.amount,
    createdAt: last.createdAt,
  };
}

export async function undoExpense(telegramId: number, expenseId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const deleted = await deleteExpense(expenseId, dbUser.id);
  if (deleted) {
    log.info(`Expense ${expenseId} undone by user ${telegramId}`);
  }
  return deleted;
}

/**
 * Edit an existing expense. Verifies ownership via user_id.
 * Returns updated expense as DTO, or null if not found / not owned.
 */
export async function editExpense(
  telegramId: number,
  expenseId: number,
  updates: { amount?: number; categoryId?: number; subcategory?: string | null; createdAt?: Date }
): Promise<ExpenseDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Verify ownership: the expense must belong to this user
  const existing = await getExpenseById(expenseId);
  if (!existing || existing.userId !== dbUser.id) {
    return null;
  }

  if (
    updates.amount === undefined &&
    updates.categoryId === undefined &&
    updates.subcategory === undefined &&
    updates.createdAt === undefined
  ) {
    return null;
  }

  const updated = await updateExpense(expenseId, updates);
  if (!updated) return null;

  // Re-fetch to get fresh category info (categoryId may have changed)
  const fresh = await getExpenseById(expenseId);
  if (!fresh) return null;

  log.info(`Expense ${expenseId} edited by user ${telegramId}`);

  return {
    id: fresh.id,
    categoryId: fresh.categoryId,
    categoryName: fresh.categoryName,
    categoryEmoji: fresh.categoryEmoji,
    subcategory: fresh.subcategory,
    amount: fresh.amount,
    inputMethod: fresh.inputMethod,
    createdAt: fresh.createdAt.toISOString(),
  };
}

/**
 * Get expense category list with aliases for AI prompts.
 */
export async function getCategoriesListWithAliasesFormatted(): Promise<string> {
  requireDb();
  return getCategoriesListWithAliases();
}

/** Fallback category that must never be deleted (used by parsers when no match). */
const FALLBACK_CATEGORY_NAME = "Другое";

/** A category can be deleted only if it was user-created and is not the fallback. */
function categoryCanDelete(c: Category): boolean {
  return c.createdByUserId !== null && c.name !== FALLBACK_CATEGORY_NAME;
}

function toCategoryDto(c: Category): CategoryDto {
  return {
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    sortOrder: c.sortOrder,
    aliases: c.aliases,
    description: c.description,
    canDelete: categoryCanDelete(c),
  };
}

/** Error with an associated HTTP status, thrown by category management. */
export class CategoryServiceError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "CategoryServiceError";
  }
}

function requireCategoryAdmin(telegramId: number): void {
  if (!isBootstrapAdmin(telegramId)) {
    throw new CategoryServiceError("Управление категориями доступно только администратору.", 403);
  }
}

/** Normalize aliases: trim, drop empties, lowercase, dedupe. */
function normalizeAliases(aliases?: string[]): string[] {
  if (!aliases) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of aliases) {
    const a = raw.trim().toLowerCase();
    if (a && !seen.has(a)) {
      seen.add(a);
      result.push(a);
    }
  }
  return result;
}

export async function getCategoryDtos(): Promise<CategoryDto[]> {
  requireDb();
  const cats = await getCategories();
  return cats.map(toCategoryDto);
}

/** Create a new expense category (admin only). */
export async function createCategoryFromRequest(
  telegramId: number,
  input: CreateCategoryRequest
): Promise<CategoryDto> {
  requireDb();
  requireCategoryAdmin(telegramId);

  const name = input.name?.trim();
  if (!name) throw new CategoryServiceError("Название категории обязательно.", 400);

  const dbUser = await requireDbUser(telegramId);

  try {
    const cat = await repoCreateCategory({
      name,
      emoji: input.emoji?.trim() || "📦",
      aliases: normalizeAliases(input.aliases),
      description: input.description?.trim() || null,
      createdByUserId: dbUser.id,
    });
    return toCategoryDto(cat);
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      throw new CategoryServiceError(`Категория «${name}» уже существует.`, 409);
    }
    throw err;
  }
}

/** Update an existing category (admin only). Built-in categories can be edited, not deleted. */
export async function updateCategoryFromRequest(
  telegramId: number,
  categoryId: number,
  input: UpdateCategoryRequest
): Promise<CategoryDto> {
  requireDb();
  requireCategoryAdmin(telegramId);

  const existing = await getCategoryById(categoryId);
  if (!existing) throw new CategoryServiceError("Категория не найдена.", 404);

  const updates: UpdateCategoryRequest = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new CategoryServiceError("Название не может быть пустым.", 400);
    updates.name = name;
  }
  if (input.emoji !== undefined) updates.emoji = input.emoji.trim() || "📦";
  if (input.aliases !== undefined) updates.aliases = normalizeAliases(input.aliases);
  if (input.description !== undefined) updates.description = input.description?.trim() || null;

  try {
    const cat = await repoUpdateCategory(categoryId, updates);
    if (!cat) throw new CategoryServiceError("Категория не найдена.", 404);
    return toCategoryDto(cat);
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      throw new CategoryServiceError("Категория с таким названием уже существует.", 409);
    }
    throw err;
  }
}

/** Soft-delete (deactivate) a user-created category (admin only). */
export async function deactivateCategoryFromRequest(
  telegramId: number,
  categoryId: number
): Promise<boolean> {
  requireDb();
  requireCategoryAdmin(telegramId);

  const existing = await getCategoryById(categoryId);
  if (!existing) throw new CategoryServiceError("Категория не найдена.", 404);
  if (!categoryCanDelete(existing)) {
    throw new CategoryServiceError(
      "Встроенные категории удалить нельзя (можно только редактировать).",
      400
    );
  }

  // Перед деактивацией переносим траты в «Другое», чтобы суммы не пропали из отчётов
  // (getCategoryTotals фильтрует по is_active = true).
  const fallback = (await getCategories()).find((c) => c.name === FALLBACK_CATEGORY_NAME);
  if (fallback) {
    await reassignExpensesCategory(categoryId, fallback.id);
  } else {
    log.warn(
      "Fallback category '%s' not found; deactivating %d without reassigning expenses.",
      FALLBACK_CATEGORY_NAME,
      categoryId
    );
  }

  const result = await repoDeactivateCategory(categoryId);
  return result !== null;
}

export async function getCategoryDrilldown(
  telegramId: number,
  categoryId: number,
  year: number,
  month: number,
  pageSize: number = 10,
  offset: number = 0
): Promise<{
  expenses: Array<{ id: number; subcategory: string | null; amount: number; firstName: string; createdAt: string }>;
  total: number;
  categoryName: string;
  categoryEmoji: string;
}> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) throw new Error("Нет трайба.");

  const { from, to } = getMonthRange(year, month);

  const [total, expenses, cats] = await Promise.all([
    countExpensesByCategory(dbUser.tribeId, categoryId, from, to),
    getExpensesByCategory(dbUser.tribeId, categoryId, from, to, pageSize, offset),
    getCategoryTotals(dbUser.tribeId, from, to),
  ]);

  const cat = cats.find((c) => c.categoryId === categoryId);

  return {
    expenses: expenses.map((e) => ({
      id: e.id,
      subcategory: e.subcategory,
      amount: e.amount,
      firstName: e.firstName,
      createdAt: e.createdAt.toISOString(),
    })),
    total,
    categoryName: cat?.categoryName ?? "Категория",
    categoryEmoji: cat?.categoryEmoji ?? "📦",
  };
}

/**
 * Get comparison drilldown: individual expenses for a category from both current and previous month.
 */
export async function getComparisonDrilldown(
  telegramId: number,
  categoryId: number,
  year: number,
  month: number,
  pageSize: number = 20,
  offset: number = 0
): Promise<ComparisonDrilldownDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) throw new Error("Нет трайба.");

  const mskNow = getMskNow();
  const isCurrentMonth = year === mskNow.year && month === mskNow.month;
  const comparisonDay = isCurrentMonth ? mskNow.day : undefined;

  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;

  const currFrom = new Date(Date.UTC(year, month - 1, 1));
  const currTo = comparisonDay
    ? new Date(Date.UTC(year, month - 1, comparisonDay + 1))
    : new Date(Date.UTC(year, month, 1));

  const prevFrom = new Date(Date.UTC(prevYear, prevMonth - 1, 1));
  const prevTo = comparisonDay
    ? new Date(Date.UTC(prevYear, prevMonth - 1, comparisonDay + 1))
    : new Date(Date.UTC(prevYear, prevMonth, 1));

  const [prevCount, currCount, prevExpenses, currExpenses, cats] = await Promise.all([
    countExpensesByCategory(dbUser.tribeId, categoryId, prevFrom, prevTo),
    countExpensesByCategory(dbUser.tribeId, categoryId, currFrom, currTo),
    getExpensesByCategory(dbUser.tribeId, categoryId, prevFrom, prevTo, pageSize, offset),
    getExpensesByCategory(dbUser.tribeId, categoryId, currFrom, currTo, pageSize, offset),
    getCategoryTotals(dbUser.tribeId, currFrom, currTo),
  ]);

  const cat = cats.find((c) => c.categoryId === categoryId);
  const mapExpenses = (list: typeof prevExpenses) =>
    list.map((e) => ({
      id: e.id,
      subcategory: e.subcategory,
      amount: e.amount,
      firstName: e.firstName,
      createdAt: e.createdAt.toISOString(),
    }));

  return {
    categoryName: cat?.categoryName ?? "Категория",
    categoryEmoji: cat?.categoryEmoji ?? "📦",
    prevExpenses: mapExpenses(prevExpenses),
    currExpenses: mapExpenses(currExpenses),
    prevCount,
    currCount,
    comparisonDay,
  };
}

/**
 * Get the most recent expenses across the entire tribe (regardless of month/category)
 * with pagination support.
 */
export async function getRecentExpenses(
  telegramId: number,
  limit: number = 10,
  page: number = 1
): Promise<RecentExpensesResponse> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) throw new Error("Нет трайба.");

  const clamped = Math.min(Math.max(limit, 1), 50);
  const safePage = Math.max(page, 1);
  const offset = (safePage - 1) * clamped;

  const [expenses, total] = await Promise.all([
    getExpensesPaginated(dbUser.tribeId, clamped, offset),
    countExpenses(dbUser.tribeId),
  ]);

  return {
    items: expenses.map((e) => ({
      id: e.id,
      categoryId: e.categoryId,
      categoryName: e.categoryName,
      categoryEmoji: e.categoryEmoji,
      subcategory: e.subcategory,
      amount: e.amount,
      firstName: e.firstName,
      createdAt: e.createdAt.toISOString(),
      isOwn: e.userId === dbUser.id,
    })),
    total,
    page: safePage,
    limit: clamped,
  };
}

// ─── Monthly limit management ─────────────────────────────────────────

/**
 * Get the spending limit details for a specific month, including the resolved value
 * and whether it comes from a per-month override.
 */
export async function getMonthLimitInfo(
  telegramId: number,
  year: number,
  month: number
): Promise<{ year: number; month: number; limit: number; isCustom: boolean; defaultLimit: number }> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) throw new Error("Нет трайба.");

  const envDefault = getMonthLimit();
  const [limit, isCustom, tribeDefault] = await Promise.all([
    getEffectiveMonthLimit(dbUser.tribeId, year, month, envDefault),
    isMonthLimitOverridden(dbUser.tribeId, year, month),
    getTribeDefaultLimit(dbUser.tribeId),
  ]);

  return {
    year,
    month,
    limit,
    isCustom,
    defaultLimit: tribeDefault ?? envDefault,
  };
}

/**
 * Set the monthly spending limit. When applyToFuture is true, also writes the new value
 * as the tribe-wide default and clears overrides for this month and later.
 */
export async function setMonthLimit(
  telegramId: number,
  year: number,
  month: number,
  amount: number,
  applyToFuture: boolean
): Promise<{ year: number; month: number; limit: number; isCustom: boolean; defaultLimit: number }> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) throw new Error("Нет трайба.");

  await setEffectiveMonthLimit(dbUser.tribeId, year, month, amount, applyToFuture);
  log.info(
    `Tribe ${dbUser.tribeId} limit set: year=${year} month=${month} amount=${amount} applyToFuture=${applyToFuture} by user ${telegramId}`
  );
  return getMonthLimitInfo(telegramId, year, month);
}
