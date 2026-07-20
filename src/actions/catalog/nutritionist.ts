/**
 * Nutritionist actions — wrappers over nutritionistService
 * (mirrors src/api/routes/nutritionist.ts + nutritionist-products.ts).
 * Individual mode. Photo analysis stays UI-only (binary channel).
 */
import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getHistory,
  getAnalysis,
  removeAnalysis,
  getDailySummary,
  saveManualCalculation,
  listUserProducts,
} from "../../services/nutritionistService.js";
import type { ManualCalcRequest } from "../../shared/types.js";
import { TIMEZONE_MSK } from "../../constants.js";

const idArg = z.object({ id: z.number().int().positive() });

const manualItem = z.object({
  name: z.string().min(1),
  weightG: z.number(),
  caloriesPer100G: z.number(),
  proteinsPer100G: z.number(),
  fatsPer100G: z.number(),
  carbsPer100G: z.number(),
  catalogProductId: z.number().int().positive().optional(),
});

export const nutritionistActions: Action[] = [
  defineAction({
    name: "nutritionist.history", mode: "nutritionist", humanTitle: "История анализов",
    description: "Показать историю анализов питания (пагинация limit/offset).",
    argsSchema: z.object({
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getHistory(ctx.telegramId, a.limit ?? 10, a.offset ?? 0) }),
  }),
  defineAction({
    name: "nutritionist.daily", mode: "nutritionist", humanTitle: "Дневная сводка",
    description: "Показать дневную сводку КБЖУ за дату (YYYY-MM-DD, по умолчанию сегодня по МСК).",
    argsSchema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    mutates: false,
    handler: async (ctx, a) => {
      const date = a.date
        ?? new Date().toLocaleDateString("sv-SE", { timeZone: TIMEZONE_MSK });
      return { data: await getDailySummary(ctx.telegramId, date) };
    },
  }),
  defineAction({
    name: "nutritionist.get", mode: "nutritionist", humanTitle: "Анализ по id",
    description: "Показать один анализ питания по id.",
    argsSchema: idArg, mutates: false,
    handler: async (ctx, a) => {
      const res = await getAnalysis(ctx.telegramId, a.id);
      if (!res) throw new Error("Анализ не найден.");
      return { data: res };
    },
  }),
  defineAction({
    name: "nutritionist.delete", mode: "nutritionist", humanTitle: "Удалить анализ",
    description: "Удалить анализ питания по id.",
    argsSchema: idArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeAnalysis(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "nutritionist.manual", mode: "nutritionist", humanTitle: "Ручной расчёт КБЖУ",
    description: "Сохранить ручной расчёт КБЖУ (список продуктов с граммовкой и КБЖУ на 100г, опц. порции).",
    argsSchema: z.object({
      mealName: z.string().optional(),
      items: z.array(manualItem).min(1),
      servings: z.number().int().positive().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await saveManualCalculation(ctx.telegramId, a as ManualCalcRequest) }),
  }),
  defineAction({
    name: "nutritionist.products.list", mode: "nutritionist", humanTitle: "Каталог продуктов",
    description: "Показать каталог продуктов пользователя (пагинация limit/offset, опц. поиск).",
    argsSchema: z.object({
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
      search: z.string().optional(),
    }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await listUserProducts(ctx.telegramId, a.limit ?? 50, a.offset ?? 0, a.search) }),
  }),
  defineAction({
    name: "nutritionist.analyze", mode: "nutritionist", humanTitle: "Анализ фото блюда",
    description: "Проанализировать фото блюда через AI (требуется загрузка фото).",
    argsSchema: z.object({ caption: z.string().optional() }),
    mutates: true, heavy: true, requiresUI: "photo",
    handler: async () => { throw new Error("Пришлите фото блюда в режиме нутрициолога."); },
  }),
];
