import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  addExpenseFromText,
  getRecentExpenses,
  getMonthReport,
  undoExpense,
  setMonthLimit,
  getCategoryDtos,
} from "../../services/expenseService.js";
import { getUserByTelegramId } from "../../expenses/repository.js";

function mskYearMonth(now: Date = new Date()): { year: number; month: number } {
  const msk = new Date(now.getTime() + 3 * 3600_000);
  return { year: msk.getUTCFullYear(), month: msk.getUTCMonth() + 1 };
}

export const expensesActions: Action[] = [
  defineAction({
    name: "expenses.add", mode: "expenses", humanTitle: "Записать расход",
    description: 'Добавить трату из текста, напр. "аптека 500" или "кафе кофе 250".',
    argsSchema: z.object({ text: z.string().min(1) }),
    mutates: true,
    handler: async (ctx, a) => {
      const user = await getUserByTelegramId(ctx.telegramId);
      if (!user) throw new Error("Пользователь не найден.");
      const res = await addExpenseFromText(
        ctx.telegramId, user.username, user.firstName, user.lastName,
        ctx.menu.role === "admin", a.text.trim(),
      );
      return { data: res };
    },
  }),
  defineAction({
    name: "expenses.recent", mode: "expenses", humanTitle: "Последние расходы",
    description: "Показать последние траты (с id для удаления).",
    argsSchema: z.object({ limit: z.number().int().positive().max(50).optional(), page: z.number().int().positive().optional() }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getRecentExpenses(ctx.telegramId, a.limit ?? 10, a.page ?? 1) }),
  }),
  defineAction({
    name: "expenses.report", mode: "expenses", humanTitle: "Отчёт за месяц",
    description: "Отчёт по категориям за месяц (по умолчанию текущий).",
    argsSchema: z.object({ year: z.number().int().optional(), month: z.number().int().min(1).max(12).optional() }),
    mutates: false,
    handler: async (ctx, a) => {
      const def = mskYearMonth();
      return { data: await getMonthReport(ctx.telegramId, a.year ?? def.year, a.month ?? def.month, true) };
    },
  }),
  defineAction({
    name: "expenses.delete", mode: "expenses", humanTitle: "Удалить расход",
    description: "Отменить/удалить трату по id.",
    argsSchema: z.object({ id: z.number().int().positive() }),
    mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await undoExpense(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "expenses.categories", mode: "expenses", humanTitle: "Категории расходов",
    description: "Показать категории расходов (id для структурированного добавления).",
    argsSchema: z.object({}), mutates: false,
    handler: async () => ({ data: await getCategoryDtos() }),
  }),
  defineAction({
    name: "expenses.limit.set", mode: "expenses", humanTitle: "Установить лимит",
    description: "Установить месячный лимит расходов (опц. applyToFuture, year/month).",
    argsSchema: z.object({
      amount: z.number().nonnegative(),
      applyToFuture: z.boolean().optional(),
      year: z.number().int().optional(),
      month: z.number().int().min(1).max(12).optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => {
      const def = mskYearMonth();
      return { data: await setMonthLimit(ctx.telegramId, a.year ?? def.year, a.month ?? def.month, a.amount, a.applyToFuture ?? false) };
    },
  }),
];
