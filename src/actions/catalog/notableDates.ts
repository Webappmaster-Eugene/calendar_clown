/**
 * Notable-dates actions — wrappers over notableDatesService
 * (mirrors src/api/routes/notable-dates.ts). Tribe mode. CSV import stays UI-only.
 */
import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getUpcoming,
  getDatesPaginated,
  createDate,
  editDate,
  togglePriority,
  removeDate,
} from "../../services/notableDatesService.js";

const idArg = z.object({ id: z.number().int().positive() });
const monthField = z.number().int().min(1).max(12);
const dayField = z.number().int().min(1).max(31);

export const notableDatesActions: Action[] = [
  defineAction({
    name: "dates.upcoming", mode: "notable_dates", humanTitle: "Ближайшие даты",
    description: "Показать ближайшие памятные даты (по умолчанию 14 дней).",
    argsSchema: z.object({ days: z.number().int().positive().max(366).optional() }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getUpcoming(ctx.telegramId, a.days ?? 14) }),
  }),
  defineAction({
    name: "dates.list", mode: "notable_dates", humanTitle: "Все даты",
    description: "Показать памятные даты (пагинация limit/offset).",
    argsSchema: z.object({
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
      excludeHolidays: z.boolean().optional(),
    }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getDatesPaginated(ctx.telegramId, a.limit ?? 10, a.offset ?? 0, a.excludeHolidays ?? false) }),
  }),
  defineAction({
    name: "dates.create", mode: "notable_dates", humanTitle: "Добавить дату",
    description: "Добавить памятную дату (name, месяц 1-12, день 1-31, опц. поля).",
    argsSchema: z.object({
      name: z.string().min(1),
      dateMonth: monthField,
      dateDay: dayField,
      eventType: z.string().optional(),
      description: z.string().optional(),
      emoji: z.string().optional(),
      isPriority: z.boolean().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await createDate(ctx.telegramId, { ...a, name: a.name.trim() }) }),
  }),
  defineAction({
    name: "dates.edit", mode: "notable_dates", humanTitle: "Изменить дату",
    description: "Изменить памятную дату по id (переданные поля).",
    argsSchema: z.object({
      id: z.number().int().positive(),
      name: z.string().optional(),
      dateMonth: monthField.optional(),
      dateDay: dayField.optional(),
      description: z.string().nullable().optional(),
      eventType: z.string().optional(),
      emoji: z.string().optional(),
      isPriority: z.boolean().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => {
      const { id, ...fields } = a;
      const d = await editDate(ctx.telegramId, id, fields);
      if (!d) throw new Error("Дата не найдена.");
      return { data: d };
    },
  }),
  defineAction({
    name: "dates.togglePriority", mode: "notable_dates", humanTitle: "Переключить важность",
    description: "Переключить приоритет/уведомления даты по id.",
    argsSchema: idArg, mutates: true,
    handler: async (ctx, a) => ({ data: { toggled: await togglePriority(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "dates.delete", mode: "notable_dates", humanTitle: "Удалить дату",
    description: "Удалить памятную дату по id.",
    argsSchema: idArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeDate(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "dates.import", mode: "notable_dates", humanTitle: "Импорт дат из CSV",
    description: "Импорт памятных дат из CSV-файла (требуется загрузка файла).",
    argsSchema: z.object({}), mutates: true, requiresUI: "file",
    handler: async () => { throw new Error("Импорт CSV доступен только через Mini App."); },
  }),
];
