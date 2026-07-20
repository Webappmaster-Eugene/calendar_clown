import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getCategories,
  addCategory,
  editCategory,
  removeCategory,
  getAllEntries,
  getEntriesForCategory,
  getEntry,
  addEntry,
  editEntry,
  removeEntry,
  getStats,
} from "../../services/gandalfService.js";

const idArg = z.object({ id: z.number().int().positive() });
const visibility = z.enum(["tribe", "private"]);

export const gandalfActions: Action[] = [
  defineAction({
    name: "gandalf.categories.list", mode: "gandalf", humanTitle: "Категории",
    description: "Показать категории базы знаний (с id).",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getCategories(ctx.telegramId) }),
  }),
  defineAction({
    name: "gandalf.category.create", mode: "gandalf", humanTitle: "Создать категорию",
    description: "Создать категорию базы знаний.",
    argsSchema: z.object({ name: z.string().min(1), emoji: z.string().optional() }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await addCategory(ctx.telegramId, a.name.trim(), a.emoji) }),
  }),
  defineAction({
    name: "gandalf.category.edit", mode: "gandalf", humanTitle: "Изменить категорию",
    description: "Изменить название/эмодзи категории по id.",
    argsSchema: z.object({ id: z.number().int().positive(), name: z.string().optional(), emoji: z.string().optional() }),
    mutates: true,
    handler: async (ctx, a) => {
      const cat = await editCategory(ctx.telegramId, a.id, { name: a.name, emoji: a.emoji });
      if (!cat) throw new Error("Категория не найдена.");
      return { data: cat };
    },
  }),
  defineAction({
    name: "gandalf.category.delete", mode: "gandalf", humanTitle: "Удалить категорию",
    description: "Удалить категорию по id.",
    argsSchema: idArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeCategory(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "gandalf.entries.list", mode: "gandalf", humanTitle: "Все записи",
    description: "Показать все записи (пагинация limit/offset).",
    argsSchema: z.object({ limit: z.number().int().positive().max(100).optional(), offset: z.number().int().min(0).optional() }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getAllEntries(ctx.telegramId, a.limit ?? 10, a.offset ?? 0) }),
  }),
  defineAction({
    name: "gandalf.category.entries", mode: "gandalf", humanTitle: "Записи категории",
    description: "Показать записи категории по categoryId (пагинация).",
    argsSchema: z.object({ categoryId: z.number().int().positive(), limit: z.number().int().positive().max(100).optional(), offset: z.number().int().min(0).optional() }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getEntriesForCategory(ctx.telegramId, a.categoryId, a.limit ?? 10, a.offset ?? 0) }),
  }),
  defineAction({
    name: "gandalf.entry.get", mode: "gandalf", humanTitle: "Запись",
    description: "Показать запись по id.",
    argsSchema: idArg, mutates: false,
    handler: async (ctx, a) => {
      const e = await getEntry(ctx.telegramId, a.id);
      if (!e) throw new Error("Запись не найдена.");
      return { data: e };
    },
  }),
  defineAction({
    name: "gandalf.entry.create", mode: "gandalf", humanTitle: "Создать запись",
    description: "Создать запись в категории (categoryId, title и опц. поля).",
    argsSchema: z.object({
      categoryId: z.number().int().positive(),
      title: z.string().min(1),
      price: z.number().nullable().optional(),
      nextDate: z.string().nullable().optional(),
      additionalInfo: z.string().nullable().optional(),
      isImportant: z.boolean().optional(),
      isUrgent: z.boolean().optional(),
      visibility: visibility.optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await addEntry(ctx.telegramId, { ...a, title: a.title.trim() }) }),
  }),
  defineAction({
    name: "gandalf.entry.edit", mode: "gandalf", humanTitle: "Изменить запись",
    description: "Изменить поля записи по id (переданные поля; можно сменить категорию).",
    argsSchema: z.object({
      id: z.number().int().positive(),
      title: z.string().optional(),
      price: z.number().nullable().optional(),
      nextDate: z.string().nullable().optional(),
      additionalInfo: z.string().nullable().optional(),
      isImportant: z.boolean().optional(),
      isUrgent: z.boolean().optional(),
      visibility: visibility.optional(),
      categoryId: z.number().int().positive().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => {
      const { id, ...updates } = a;
      const e = await editEntry(ctx.telegramId, id, updates);
      if (!e) throw new Error("Запись не найдена.");
      return { data: e };
    },
  }),
  defineAction({
    name: "gandalf.entry.delete", mode: "gandalf", humanTitle: "Удалить запись",
    description: "Удалить запись по id.",
    argsSchema: idArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeEntry(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "gandalf.stats", mode: "gandalf", humanTitle: "Статистика базы знаний",
    description: "Показать статистику по категориям/годам/участникам.",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getStats(ctx.telegramId) }),
  }),
];
