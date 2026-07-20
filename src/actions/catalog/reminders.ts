import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getUserReminders,
  getTribeRemindersList,
  getAvailableSounds,
  createNewReminder,
  toggleReminder,
  removeReminder,
  editReminderText,
  editReminderSchedule,
  editReminderSoundSettings,
  subscribeToReminder,
  unsubscribeFromReminder,
} from "../../services/remindersService.js";

const scheduleSchema = z.object({
  times: z.array(z.string()).describe('Времена срабатывания "HH:MM", напр. ["10:00","19:30"]'),
  weekdays: z.array(z.number().int().min(0).max(6)).describe("Дни недели: 0=вс … 6=сб. Пустой массив = каждый день"),
  endDate: z.string().nullable().optional().describe("Дата окончания ISO или null"),
});
const idArg = z.object({ id: z.number().int().positive() });

export const remindersActions: Action[] = [
  defineAction({
    name: "reminders.list",
    mode: "reminders",
    humanTitle: "Список напоминаний",
    description: "Показать все напоминания пользователя (с id).",
    argsSchema: z.object({}),
    mutates: false,
    handler: async (ctx) => ({ data: await getUserReminders(ctx.telegramId) }),
  }),
  defineAction({
    name: "reminders.tribe.list",
    mode: "reminders",
    humanTitle: "Напоминания трайба",
    description: "Показать напоминания других участников трайба (для подписки).",
    argsSchema: z.object({}),
    mutates: false,
    handler: async (ctx) => ({ data: await getTribeRemindersList(ctx.telegramId) }),
  }),
  defineAction({
    name: "reminders.sounds.list",
    mode: "reminders",
    humanTitle: "Список звуков",
    description: "Показать доступные звуки напоминаний (id для выбора).",
    argsSchema: z.object({}),
    mutates: false,
    handler: async () => ({ data: await getAvailableSounds() }),
  }),
  defineAction({
    name: "reminders.create",
    mode: "reminders",
    humanTitle: "Создать напоминание",
    description: "Создать напоминание с расписанием (times HH:MM, weekdays 0-6).",
    argsSchema: z.object({
      text: z.string().min(1),
      schedule: scheduleSchema,
      soundId: z.number().int().optional(),
      soundEnabled: z.boolean().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => ({
      data: await createNewReminder(
        ctx.telegramId,
        a.text.trim(),
        { times: a.schedule.times, weekdays: a.schedule.weekdays, endDate: a.schedule.endDate ?? null },
        "text",
        a.soundId,
        a.soundEnabled,
      ),
    }),
  }),
  defineAction({
    name: "reminders.toggle",
    mode: "reminders",
    humanTitle: "Вкл/выкл напоминание",
    description: "Переключить активность (пауза/возобновление) напоминания по id.",
    argsSchema: idArg,
    mutates: true,
    handler: async (ctx, a) => {
      const r = await toggleReminder(ctx.telegramId, a.id);
      if (!r) throw new Error("Напоминание не найдено.");
      return { data: r };
    },
  }),
  defineAction({
    name: "reminders.edit",
    mode: "reminders",
    humanTitle: "Редактировать напоминание",
    description: "Изменить текст/расписание/звук напоминания по id (переданные поля).",
    argsSchema: z.object({
      id: z.number().int().positive(),
      text: z.string().optional(),
      schedule: scheduleSchema.optional(),
      soundId: z.number().int().nullable().optional(),
      soundEnabled: z.boolean().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => {
      if (a.text?.trim()) await editReminderText(ctx.telegramId, a.id, a.text.trim());
      if (a.schedule) {
        await editReminderSchedule(ctx.telegramId, a.id, {
          times: a.schedule.times,
          weekdays: a.schedule.weekdays,
          endDate: a.schedule.endDate ?? null,
        });
      }
      if (a.soundId !== undefined || a.soundEnabled !== undefined) {
        await editReminderSoundSettings(ctx.telegramId, a.id, a.soundId ?? null, a.soundEnabled ?? false);
      }
      return { data: { updated: true, id: a.id } };
    },
  }),
  defineAction({
    name: "reminders.delete",
    mode: "reminders",
    humanTitle: "Удалить напоминание",
    description: "Удалить напоминание по id.",
    argsSchema: idArg,
    mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeReminder(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "reminders.subscribe",
    mode: "reminders",
    humanTitle: "Подписаться на напоминание",
    description: "Подписаться на напоминание трайба по id.",
    argsSchema: idArg,
    mutates: true,
    handler: async (ctx, a) => {
      await subscribeToReminder(ctx.telegramId, a.id);
      return { data: { subscribed: true, id: a.id } };
    },
  }),
  defineAction({
    name: "reminders.unsubscribe",
    mode: "reminders",
    humanTitle: "Отписаться от напоминания",
    description: "Отписаться от напоминания трайба по id.",
    argsSchema: idArg,
    mutates: true,
    handler: async (ctx, a) => {
      await unsubscribeFromReminder(ctx.telegramId, a.id);
      return { data: { unsubscribed: true, id: a.id } };
    },
  }),
];
