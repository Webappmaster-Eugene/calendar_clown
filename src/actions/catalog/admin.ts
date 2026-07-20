/**
 * Admin actions — wrappers over adminService/adminSummaryService/adminDataService
 * (mirrors src/api/routes/admin.ts). ADMIN mode: guard restricts to role admin;
 * services additionally enforce isBootstrapAdmin on the acting telegramId.
 * The generic data-browser is exposed read-only (list) — the destructive
 * "delete all entities of type" is intentionally not surfaced here.
 */
import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  listUsers,
  getPendingUsers,
  addUser,
  approveUserById,
  rejectUserById,
  removeUser,
  assignUserToTribe,
  removeUserTribe,
  getTribes,
  createNewTribe,
  editTribe,
  removeTribe,
  getGlobalStats,
} from "../../services/adminService.js";
import {
  getPeriodRange,
  collectSummaryData,
  isEmptyData,
  generateAiSummary,
  type SummaryPeriod,
} from "../../services/adminSummaryService.js";
import {
  getEntityList,
  type EntityType,
} from "../../services/adminDataService.js";
import { getActionLogs, getDistinctActions } from "../../logging/actionLogger.js";

const targetIdArg = z.object({ targetTelegramId: z.number().int() });
const summaryPeriod = z.enum(["today", "yesterday", "week", "month", "year"]);
const entityType = z.enum([
  "transcriptions", "expenses", "gandalf", "digest", "dates", "calendar",
  "dialogs", "wishlists", "goals", "reminders", "osint", "workplaces", "blogger",
]);

export const adminActions: Action[] = [
  // ─── Users ──────────────────────────────────────────────────
  defineAction({
    name: "admin.users.list", mode: "admin", humanTitle: "Список пользователей",
    description: "Показать всех пользователей (кроме ожидающих одобрения) с ролью, трайбом и id.",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await listUsers(ctx.telegramId) }),
  }),
  defineAction({
    name: "admin.users.pending", mode: "admin", humanTitle: "Заявки на одобрение",
    description: "Показать пользователей, ожидающих одобрения.",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getPendingUsers(ctx.telegramId) }),
  }),
  defineAction({
    name: "admin.users.add", mode: "admin", humanTitle: "Добавить пользователя",
    description: "Добавить пользователя в allowlist по его Telegram ID.",
    argsSchema: targetIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { added: await addUser(ctx.telegramId, a.targetTelegramId), targetTelegramId: a.targetTelegramId } }),
  }),
  defineAction({
    name: "admin.users.approve", mode: "admin", humanTitle: "Одобрить пользователя",
    description: "Одобрить заявку пользователя по его Telegram ID.",
    argsSchema: targetIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { approved: await approveUserById(ctx.telegramId, a.targetTelegramId), targetTelegramId: a.targetTelegramId } }),
  }),
  defineAction({
    name: "admin.users.reject", mode: "admin", humanTitle: "Отклонить пользователя",
    description: "Отклонить заявку пользователя по его Telegram ID.",
    argsSchema: targetIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { rejected: await rejectUserById(ctx.telegramId, a.targetTelegramId), targetTelegramId: a.targetTelegramId } }),
  }),
  defineAction({
    name: "admin.users.delete", mode: "admin", humanTitle: "Удалить пользователя",
    description: "Удалить пользователя по его Telegram ID (нельзя удалить себя/системного).",
    argsSchema: targetIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { removed: await removeUser(ctx.telegramId, a.targetTelegramId), targetTelegramId: a.targetTelegramId } }),
  }),
  defineAction({
    name: "admin.users.setTribe", mode: "admin", humanTitle: "Назначить трайб",
    description: "Назначить пользователю (targetTelegramId) трайб по tribeId.",
    argsSchema: z.object({ targetTelegramId: z.number().int(), tribeId: z.number().int().positive() }),
    mutates: true,
    handler: async (ctx, a) => ({ data: { assigned: await assignUserToTribe(ctx.telegramId, a.targetTelegramId, a.tribeId), targetTelegramId: a.targetTelegramId, tribeId: a.tribeId } }),
  }),
  defineAction({
    name: "admin.users.removeTribe", mode: "admin", humanTitle: "Убрать из трайба",
    description: "Убрать пользователя (targetTelegramId) из его трайба.",
    argsSchema: targetIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { removed: await removeUserTribe(ctx.telegramId, a.targetTelegramId), targetTelegramId: a.targetTelegramId } }),
  }),

  // ─── Tribes ─────────────────────────────────────────────────
  defineAction({
    name: "admin.tribes.list", mode: "admin", humanTitle: "Список трайбов",
    description: "Показать трайбы с лимитом и количеством участников.",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getTribes(ctx.telegramId) }),
  }),
  defineAction({
    name: "admin.tribes.create", mode: "admin", humanTitle: "Создать трайб",
    description: "Создать новый трайб с названием.",
    argsSchema: z.object({ name: z.string().min(1) }), mutates: true,
    handler: async (ctx, a) => ({ data: await createNewTribe(ctx.telegramId, a.name.trim()) }),
  }),
  defineAction({
    name: "admin.tribes.edit", mode: "admin", humanTitle: "Изменить трайб",
    description: "Изменить название и/или месячный лимит трайба по id.",
    argsSchema: z.object({
      id: z.number().int().positive(),
      name: z.string().optional(),
      monthlyLimit: z.number().nullable().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => ({ data: { updated: await editTribe(ctx.telegramId, a.id, { name: a.name, monthlyLimit: a.monthlyLimit }), id: a.id } }),
  }),
  defineAction({
    name: "admin.tribes.delete", mode: "admin", humanTitle: "Удалить трайб",
    description: "Удалить трайб по id.",
    argsSchema: z.object({ id: z.number().int().positive() }), mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeTribe(ctx.telegramId, a.id), id: a.id } }),
  }),

  // ─── Analytics ──────────────────────────────────────────────
  defineAction({
    name: "admin.stats", mode: "admin", humanTitle: "Глобальная статистика",
    description: "Сводные счётчики: пользователи, трайбы, расходы, события, транскрипции.",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getGlobalStats(ctx.telegramId) }),
  }),
  defineAction({
    name: "admin.summary", mode: "admin", humanTitle: "Сводка активности",
    description: "Аналитика использования за период (today/yesterday/week/month/year); ai=true — LLM-саммари.",
    argsSchema: z.object({ period: summaryPeriod.default("today"), ai: z.boolean().optional() }),
    mutates: false, heavy: true,
    handler: async (ctx, a) => {
      // Guard already enforces admin mode; service-level checks live in adminService.
      const range = getPeriodRange(a.period as SummaryPeriod);
      const data = await collectSummaryData(range);
      if (!a.ai) {
        return { data: { ...data, period: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label } } };
      }
      const text = isEmptyData(data)
        ? "За этот период активности не обнаружено."
        : await generateAiSummary(data);
      return { data: { text } };
    },
  }),
  defineAction({
    name: "admin.logs", mode: "admin", humanTitle: "Журнал действий",
    description: "Постраничный журнал действий с фильтрами (action/search/userId/telegramId/даты). withActions=true добавляет список известных действий.",
    argsSchema: z.object({
      userId: z.number().int().positive().optional(),
      telegramId: z.number().int().optional(),
      action: z.string().optional(),
      search: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
      withActions: z.boolean().optional(),
    }),
    mutates: false,
    handler: async (_ctx, a) => {
      const logs = await getActionLogs({
        userId: a.userId,
        telegramId: a.telegramId,
        action: a.action,
        search: a.search,
        dateFrom: a.dateFrom,
        dateTo: a.dateTo,
        limit: a.limit ?? 50,
        offset: a.offset ?? 0,
      });
      if (!a.withActions) return { data: logs };
      const actions = await getDistinctActions();
      return { data: { ...logs, actions } };
    },
  }),

  // ─── Data browser (read-only) ───────────────────────────────
  defineAction({
    name: "admin.data.list", mode: "admin", humanTitle: "Просмотр сущностей",
    description: "Постраничный список записей выбранной сущности (transcriptions, expenses, gandalf, digest, dates, calendar, dialogs, wishlists, goals, reminders, osint, workplaces, blogger).",
    argsSchema: z.object({
      entity: entityType,
      limit: z.number().int().positive().max(50).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getEntityList(ctx.telegramId, a.entity as EntityType, a.limit ?? 10, a.offset ?? 0) }),
  }),
];
