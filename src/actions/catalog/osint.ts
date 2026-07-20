/**
 * OSINT actions — wrappers over osintService (mirrors src/api/routes/osint.ts).
 * Tribe mode. Search is LLM/web-heavy and runs a background pipeline.
 */
import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getSearchHistory,
  getSearch,
  initiateSearch,
} from "../../services/osintService.js";

const idArg = z.object({ id: z.number().int().positive() });

export const osintActions: Action[] = [
  defineAction({
    name: "osint.history", mode: "osint", humanTitle: "История поисков",
    description: "Показать историю OSINT-поисков (пагинация limit/offset).",
    argsSchema: z.object({
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getSearchHistory(ctx.telegramId, a.limit ?? 10, a.offset ?? 0) }),
  }),
  defineAction({
    name: "osint.get", mode: "osint", humanTitle: "Поиск по id",
    description: "Показать OSINT-поиск и его отчёт по id.",
    argsSchema: idArg, mutates: false,
    handler: async (ctx, a) => {
      const res = await getSearch(ctx.telegramId, a.id);
      if (!res) throw new Error("Поиск не найден.");
      return { data: res };
    },
  }),
  defineAction({
    name: "osint.search", mode: "osint", humanTitle: "Запустить поиск",
    description: "Запустить OSINT-поиск по запросу (создаёт запись, пайплайн идёт в фоне).",
    argsSchema: z.object({ query: z.string().min(1) }),
    mutates: true, heavy: true,
    handler: async (ctx, a) => ({ data: await initiateSearch(ctx.telegramId, a.query.trim()) }),
  }),
];
