/**
 * Calendar actions — wrappers over calendarService (mirrors src/api/routes/calendar.ts).
 * Individual mode. Uses per-user Google OAuth (userId = String(telegramId)); if the
 * user hasn't linked Google Calendar the service throws, surfaced as an error.
 */
import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getEventsToday,
  getEventsWeek,
  createEventFromText,
  updateEventById,
  cancelEventById,
  cancelRecurringEvent,
  searchAndCancelEvent,
} from "../../services/calendarService.js";

const uid = (telegramId: number): string => String(telegramId);

export const calendarActions: Action[] = [
  defineAction({
    name: "calendar.today", mode: "calendar", humanTitle: "События сегодня",
    description: "Показать события Google Calendar на сегодня.",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getEventsToday(uid(ctx.telegramId)) }),
  }),
  defineAction({
    name: "calendar.week", mode: "calendar", humanTitle: "События на неделю",
    description: "Показать события Google Calendar на неделю.",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getEventsWeek(uid(ctx.telegramId)) }),
  }),
  defineAction({
    name: "calendar.event.create", mode: "calendar", humanTitle: "Создать событие",
    description: 'Создать событие из фразы, напр. "встреча с командой завтра в 15:00".',
    argsSchema: z.object({ text: z.string().min(1) }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await createEventFromText(uid(ctx.telegramId), ctx.telegramId, a.text.trim()) }),
  }),
  defineAction({
    name: "calendar.event.edit", mode: "calendar", humanTitle: "Изменить событие",
    description: "Изменить название/время события по eventId (ISO-время со смещением).",
    argsSchema: z.object({
      eventId: z.string().min(1),
      title: z.string().min(1),
      startISO: z.string().min(1),
      endISO: z.string().min(1),
    }),
    mutates: true,
    handler: async (ctx, a) => ({
      data: await updateEventById(uid(ctx.telegramId), ctx.telegramId, a.eventId, a.title.trim(), a.startISO, a.endISO),
    }),
  }),
  defineAction({
    name: "calendar.event.cancel", mode: "calendar", humanTitle: "Отменить событие",
    description: "Удалить/отменить событие по eventId.",
    argsSchema: z.object({ eventId: z.string().min(1) }),
    mutates: true,
    handler: async (ctx, a) => {
      await cancelEventById(uid(ctx.telegramId), ctx.telegramId, a.eventId);
      return { data: { cancelled: true, eventId: a.eventId } };
    },
  }),
  defineAction({
    name: "calendar.recurring.cancel", mode: "calendar", humanTitle: "Отменить серию",
    description: "Отменить всю серию повторяющегося события по recurringEventId.",
    argsSchema: z.object({ recurringEventId: z.string().min(1) }),
    mutates: true,
    handler: async (ctx, a) => {
      await cancelRecurringEvent(uid(ctx.telegramId), a.recurringEventId);
      return { data: { cancelled: true, recurringEventId: a.recurringEventId } };
    },
  }),
  defineAction({
    name: "calendar.searchCancel", mode: "calendar", humanTitle: "Найти и отменить",
    description: "Найти событие по тексту запроса и отменить его.",
    argsSchema: z.object({ query: z.string().min(1) }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await searchAndCancelEvent(uid(ctx.telegramId), ctx.telegramId, a.query.trim()) }),
  }),
];
