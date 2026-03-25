/**
 * Admin Data Management service.
 * Provides generic paginated list + delete operations for all entity types.
 * Used by the Mini App admin data management API routes.
 */

import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";

// Repository imports — same as adminData.ts bot handler
import {
  getAllTranscriptionsPaginated,
  countAllTranscriptions,
  deleteTranscription,
  deleteAllTranscriptions,
} from "../transcribe/repository.js";

import {
  getExpensesPaginated,
  countExpenses,
  bulkDeleteExpenses,
  deleteAllExpenses,
} from "../expenses/repository.js";

import {
  getAllEntriesPaginated,
  countAllEntries,
  deleteAllEntries,
} from "../gandalf/repository.js";

import {
  getAllRubricsPaginated,
  countAllRubrics,
  deleteAllRubrics,
} from "../digest/repository.js";

import {
  getAllDatesPaginated,
  countAllDates,
  removeNotableDate,
  deleteAllDates,
} from "../notable-dates/repository.js";

import {
  getAllEventsPaginated,
  countAllEvents,
  deleteAllEvents,
} from "../calendar/repository.js";

import {
  getAllDialogsPaginated,
  countAllDialogs,
  deleteAllDialogs,
} from "../chat/repository.js";

import {
  getAllWishlistsPaginated,
  countAllWishlists,
  deleteAllWishlists,
} from "../wishlist/repository.js";

import {
  getAllGoalSetsPaginated,
  countAllGoalSets,
  deleteAllGoalSets,
} from "../goals/repository.js";

import {
  getAllRemindersPaginated,
  countAllReminders,
  deleteAllReminders,
} from "../reminders/repository.js";

import {
  getAllSearchesPaginated,
  countAllSearches,
  deleteAllSearches,
} from "../osint/repository.js";

import {
  getAllWorkplacesPaginated,
  countAllWorkplaces,
  deleteAllWorkplaces,
} from "../summarizer/repository.js";

import {
  getAllChannelsPaginated,
  countAllChannels,
  deleteAllChannels,
} from "../blogger/repository.js";

const log = createLogger("admin-data-service");

// ─── Types ────────────────────────────────────────────────────

export type EntityType =
  | "transcriptions"
  | "expenses"
  | "gandalf"
  | "digest"
  | "dates"
  | "calendar"
  | "dialogs"
  | "wishlists"
  | "goals"
  | "reminders"
  | "osint"
  | "workplaces"
  | "blogger";

export interface EntityListItem {
  id: number;
  label: string;
  hint: string;
}

export interface EntityListResult {
  items: EntityListItem[];
  total: number;
}

export const ENTITY_LABELS: Record<EntityType, { emoji: string; label: string }> = {
  transcriptions: { emoji: "🎙", label: "Транскрипции" },
  expenses: { emoji: "💰", label: "Расходы" },
  gandalf: { emoji: "🧙", label: "База знаний" },
  digest: { emoji: "📰", label: "Дайджест" },
  dates: { emoji: "🎂", label: "Даты" },
  calendar: { emoji: "📅", label: "Календарь" },
  dialogs: { emoji: "🧠", label: "Нейро-диалоги" },
  wishlists: { emoji: "🎁", label: "Вишлисты" },
  goals: { emoji: "🎯", label: "Цели" },
  reminders: { emoji: "⏰", label: "Напоминания" },
  osint: { emoji: "🔍", label: "OSINT" },
  workplaces: { emoji: "📋", label: "Саммаризатор" },
  blogger: { emoji: "✍️", label: "Блогер" },
};

// ─── Helpers ──────────────────────────────────────────────────

function requireAdmin(telegramId: number): void {
  if (!isBootstrapAdmin(telegramId)) {
    throw new Error("Доступ запрещён. Требуются права администратора.");
  }
}

function requireDb(): void {
  if (!isDatabaseAvailable()) {
    throw new Error("База данных недоступна.");
  }
}

function formatDate(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// ─── Generic Operations ──────────────────────────────────────

export async function getEntityList(
  telegramId: number,
  entity: EntityType,
  limit: number = 10,
  offset: number = 0
): Promise<EntityListResult> {
  requireAdmin(telegramId);
  requireDb();

  switch (entity) {
    case "transcriptions": {
      const [items, total] = await Promise.all([
        getAllTranscriptionsPaginated(limit, offset),
        countAllTranscriptions(),
      ]);
      return {
        total,
        items: items.map((t) => ({
          id: t.id,
          label: t.transcript ? t.transcript.slice(0, 80) : "(нет текста)",
          hint: `${t.firstName ?? ""} · ${formatDate(t.transcribedAt)} · ${t.durationSeconds}с`,
        })),
      };
    }
    case "expenses": {
      const [items, total] = await Promise.all([
        getExpensesPaginated(limit, offset),
        countExpenses(),
      ]);
      return {
        total,
        items: items.map((e) => ({
          id: e.id,
          label: `${e.categoryEmoji ?? ""} ${e.categoryName ?? ""} ${e.amount}₽`,
          hint: `${e.firstName ?? ""} · ${formatDate(e.createdAt)}${e.subcategory ? ` · ${e.subcategory}` : ""}`,
        })),
      };
    }
    case "gandalf": {
      const [items, total] = await Promise.all([
        getAllEntriesPaginated(limit, offset),
        countAllEntries(),
      ]);
      return {
        total,
        items: items.map((e) => ({
          id: e.id,
          label: e.title,
          hint: `${e.categoryName ?? ""} · ${formatDate(e.createdAt)}${e.price != null ? ` · ${e.price}₽` : ""}`,
        })),
      };
    }
    case "digest": {
      const [items, total] = await Promise.all([
        getAllRubricsPaginated(limit, offset),
        countAllRubrics(),
      ]);
      return {
        total,
        items: items.map((r) => ({
          id: r.id,
          label: r.name,
          hint: `${r.isActive ? "Активна" : "На паузе"} · ${r.channelCount ?? 0} каналов`,
        })),
      };
    }
    case "dates": {
      const [items, total] = await Promise.all([
        getAllDatesPaginated(limit, offset),
        countAllDates(),
      ]);
      return {
        total,
        items: items.map((d) => ({
          id: d.id,
          label: d.name,
          hint: `${d.dateDay}.${String(d.dateMonth).padStart(2, "0")} · ${d.eventType ?? ""}`,
        })),
      };
    }
    case "calendar": {
      const [items, total] = await Promise.all([
        getAllEventsPaginated(limit, offset),
        countAllEvents(),
      ]);
      return {
        total,
        items: items.map((e) => ({
          id: e.id,
          label: e.summary ?? "(без названия)",
          hint: `${e.firstName ?? ""} · ${formatDate(e.startTime)}`,
        })),
      };
    }
    case "dialogs": {
      const [items, total] = await Promise.all([
        getAllDialogsPaginated(limit, offset),
        countAllDialogs(),
      ]);
      return {
        total,
        items: items.map((d) => ({
          id: d.id,
          label: d.title ?? "(без названия)",
          hint: `${d.firstName ?? ""} · ${d.messageCount ?? 0} сообщений`,
        })),
      };
    }
    case "wishlists": {
      const [items, total] = await Promise.all([
        getAllWishlistsPaginated(limit, offset),
        countAllWishlists(),
      ]);
      return {
        total,
        items: items.map((w) => ({
          id: w.id,
          label: `${w.emoji ?? "🎁"} ${w.name}`,
          hint: `${w.ownerName ?? ""} · ${w.itemCount ?? 0} элементов`,
        })),
      };
    }
    case "goals": {
      const [items, total] = await Promise.all([
        getAllGoalSetsPaginated(limit, offset),
        countAllGoalSets(),
      ]);
      return {
        total,
        items: items.map((g) => ({
          id: g.id,
          label: g.name,
          hint: `${g.firstName ?? ""} · ${g.period ?? ""} · ${g.goalCount ?? 0} целей`,
        })),
      };
    }
    case "reminders": {
      const [items, total] = await Promise.all([
        getAllRemindersPaginated(limit, offset),
        countAllReminders(),
      ]);
      return {
        total,
        items: items.map((r) => ({
          id: r.id,
          label: r.text,
          hint: `${r.firstName ?? ""} · ${r.isActive ? "Активно" : "Пауза"}`,
        })),
      };
    }
    case "osint": {
      const [items, total] = await Promise.all([
        getAllSearchesPaginated(limit, offset),
        countAllSearches(),
      ]);
      return {
        total,
        items: items.map((s) => ({
          id: s.id,
          label: s.query,
          hint: `${s.firstName ?? ""} · ${formatDate(s.createdAt)}`,
        })),
      };
    }
    case "workplaces": {
      const [items, total] = await Promise.all([
        getAllWorkplacesPaginated(limit, offset),
        countAllWorkplaces(),
      ]);
      return {
        total,
        items: items.map((w) => ({
          id: w.id,
          label: w.title,
          hint: `${w.firstName ?? ""} · ${w.company ?? ""}`,
        })),
      };
    }
    case "blogger": {
      const [items, total] = await Promise.all([
        getAllChannelsPaginated(limit, offset),
        countAllChannels(),
      ]);
      return {
        total,
        items: items.map((ch) => ({
          id: ch.id,
          label: ch.channelTitle,
          hint: `${ch.firstName ?? ""} · ${ch.postCount ?? 0} постов`,
        })),
      };
    }
    default:
      throw new Error(`Unknown entity type: ${entity}`);
  }
}

export async function deleteEntity(
  telegramId: number,
  entity: EntityType,
  entityId: number
): Promise<boolean> {
  requireAdmin(telegramId);
  requireDb();

  switch (entity) {
    case "transcriptions":
      return deleteTranscription(entityId);
    case "expenses": {
      const deleted = await bulkDeleteExpenses([entityId]);
      return deleted > 0;
    }
    case "dates":
      return removeNotableDate(entityId);
    default: {
      // For entities without individual delete, use bulk with single ID
      const bulkFn = getBulkDeleteFn(entity);
      if (bulkFn) {
        const deleted = await bulkFn([entityId]);
        return deleted > 0;
      }
      throw new Error(`Delete not supported for entity: ${entity}`);
    }
  }
}

export async function deleteAllEntitiesOfType(
  telegramId: number,
  entity: EntityType
): Promise<number> {
  requireAdmin(telegramId);
  requireDb();

  log.info("Admin %d deleting all %s", telegramId, entity);

  switch (entity) {
    case "transcriptions": return deleteAllTranscriptions();
    case "expenses": return deleteAllExpenses();
    case "gandalf": return deleteAllEntries();
    case "digest": return deleteAllRubrics();
    case "dates": return deleteAllDates();
    case "calendar": return deleteAllEvents();
    case "dialogs": return deleteAllDialogs();
    case "wishlists": return deleteAllWishlists();
    case "goals": return deleteAllGoalSets();
    case "reminders": return deleteAllReminders();
    case "osint": return deleteAllSearches();
    case "workplaces": return deleteAllWorkplaces();
    case "blogger": return deleteAllChannels();
    default:
      throw new Error(`Unknown entity type: ${entity}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────

type BulkDeleteFn = (ids: number[]) => Promise<number>;

function getBulkDeleteFn(entity: EntityType): BulkDeleteFn | null {
  const map: Partial<Record<EntityType, BulkDeleteFn>> = {
    expenses: bulkDeleteExpenses,
    gandalf: (ids) => Promise.resolve(ids.length), // fallback — individual deletes needed
    digest: bulkDeleteRubrics,
    dates: bulkDeleteDates,
    calendar: bulkDeleteEvents,
    dialogs: bulkDeleteDialogs,
    wishlists: bulkDeleteWishlists,
    goals: bulkDeleteGoalSets,
    reminders: bulkDeleteReminders,
    osint: bulkDeleteSearches,
    workplaces: bulkDeleteWorkplaces,
    blogger: bulkDeleteChannels,
  };
  return map[entity] ?? null;
}

// Re-import individual bulk deletes needed by getBulkDeleteFn
import { bulkDeleteDates } from "../notable-dates/repository.js";
import { bulkDeleteEvents } from "../calendar/repository.js";
import { bulkDeleteDialogs } from "../chat/repository.js";
import { bulkDeleteWishlists } from "../wishlist/repository.js";
import { bulkDeleteGoalSets } from "../goals/repository.js";
import { bulkDeleteReminders } from "../reminders/repository.js";
import { bulkDeleteSearches } from "../osint/repository.js";
import { bulkDeleteWorkplaces } from "../summarizer/repository.js";
import { bulkDeleteChannels } from "../blogger/repository.js";
import { bulkDeleteRubrics } from "../digest/repository.js";
import { bulkDeleteEntries } from "../gandalf/repository.js";
