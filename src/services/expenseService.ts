/**
 * Expense business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import { parseExpenseText, parseMultipleExpenses, getCategoriesList } from "../expenses/parser.js";
import {
  addExpense,
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
  getCategories,
} from "../expenses/repository.js";
import {
  formatExpenseConfirmation,
  formatMoney,
  monthName,
  formatMonthReport,
  formatComparisonReport,
  formatUserStats,
  formatYearReport,
  formatExpenseDetailList,
} from "../expenses/formatter.js";
import { generateMonthlyExcel } from "../expenses/excel.js";
import { getMskNow, getMonthRange, getMonthLimit } from "../utils/date.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import type {
  ExpenseDto,
  CategoryDto,
  CategoryTotalDto,
  UserTotalDto,
  MonthComparisonDto,
  ExpenseReportDto,
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
 */
export async function addExpenseFromText(
  telegramId: number,
  username: string | null,
  firstName: string,
  lastName: string | null,
  isAdmin: boolean,
  text: string
): Promise<AddExpenseResult> {
  requireDb();

  const parsed = await parseExpenseText(text);
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
    "text"
  );

  const { year, month } = getMskNow();
  const total = await getMonthTotal(dbUser.tribeId, year, month);
  const limit = getMonthLimit();

  const confirmation = formatExpenseConfirmation(
    parsed.categoryEmoji,
    parsed.categoryName,
    parsed.subcategory,
    parsed.amount,
    expense.createdAt,
    dbUser.firstName || firstName || "Пользователь",
    total,
    limit,
    monthName(month)
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
    month,
    confirmation,
  };
}

/**
 * Add multiple expenses from multi-line text.
 */
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
  const limit = getMonthLimit();
  const totalAmount = savedExpenses.reduce((s, e) => s + e.amount, 0);

  return { expenses: savedExpenses, monthTotal: total, monthlyLimit: limit, month, totalAmount };
}

/**
 * Add expense from voice input.
 */
export async function addExpenseFromVoice(
  telegramId: number,
  username: string | null,
  firstName: string,
  lastName: string | null,
  isAdmin: boolean,
  categoryName: string,
  subcategory: string | null,
  amount: number
): Promise<AddExpenseResult> {
  requireDb();

  const parsed = await parseExpenseText(`${categoryName} ${subcategory || ""} ${amount}`);
  if (!parsed) throw new Error("Не удалось определить категорию из голосового сообщения.");

  const dbUser = await ensureUser(telegramId, username, firstName, lastName, isAdmin);
  if (!dbUser.tribeId) throw new Error("Расходы доступны только для участников трайба.");

  const expense = await addExpense(
    dbUser.id,
    dbUser.tribeId,
    parsed.categoryId,
    parsed.amount,
    parsed.subcategory,
    "voice"
  );

  const { year, month } = getMskNow();
  const total = await getMonthTotal(dbUser.tribeId, year, month);
  const limit = getMonthLimit();

  const confirmation = formatExpenseConfirmation(
    parsed.categoryEmoji,
    parsed.categoryName,
    parsed.subcategory,
    parsed.amount,
    expense.createdAt,
    dbUser.firstName || firstName || "Пользователь",
    total,
    limit,
    monthName(month)
  );

  return {
    expense: {
      id: expense.id,
      categoryId: parsed.categoryId,
      categoryName: parsed.categoryName,
      categoryEmoji: parsed.categoryEmoji,
      subcategory: parsed.subcategory,
      amount: parsed.amount,
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
 */
export async function getMonthReport(
  telegramId: number,
  year: number,
  month: number
): Promise<ExpenseReportDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  if (!dbUser.tribeId) throw new Error("Нет трайба.");

  const { from, to } = getMonthRange(year, month);
  const [totals, userTotals, prevComparison] = await Promise.all([
    getCategoryTotals(dbUser.tribeId, from, to),
    getUserTotals(dbUser.tribeId, from, to),
    getMonthComparison(
      dbUser.tribeId,
      month === 1 ? year - 1 : year,
      month === 1 ? 12 : month - 1,
      year,
      month
    ),
  ]);

  const grandTotal = totals.reduce((s, t) => s + t.total, 0);
  const limit = getMonthLimit();

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
  };
}

/**
 * Get year report (monthly totals).
 */
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

/**
 * Generate Excel file for a month.
 */
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

  const limit = getMonthLimit();
  const tribeName = await getTribeName(dbUser.tribeId);
  const buffer = await generateMonthlyExcel(categoryTotals, detailedRows, year, month, tribeName, limit);
  const filename = `Расходы_${monthName(month)}_${year}.xlsx`;

  return { buffer, filename };
}

/**
 * Get last expense info for undo.
 */
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

/**
 * Confirm undo (delete) of an expense.
 */
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
 * Get expense category list (formatted string).
 */
export async function getCategoriesListFormatted(): Promise<string> {
  requireDb();
  return getCategoriesList();
}

/**
 * Get categories as DTOs.
 */
export async function getCategoryDtos(): Promise<CategoryDto[]> {
  requireDb();
  const cats = await getCategories();
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    sortOrder: c.sortOrder,
  }));
}

/**
 * Get drilldown expenses for a category in a month.
 */
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
