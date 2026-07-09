/**
 * Admin Summary Analytics service.
 * Collects per-module usage data for a given period and optionally generates AI summary.
 * Extracted from commands/adminSummary.ts for reuse in both Telegram bot and REST API.
 */

import { type SQL, sql } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import {
  actionLogs,
  calendarEvents,
  categories,
  chatMessages,
  digestRuns,
  expenses,
  gandalfCategories,
  gandalfEntries,
  goals,
  notableDates,
  users,
  voiceTranscriptions,
  wishlistItems,
} from "../db/schema.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import { DEEPSEEK_MODEL, TIMEZONE_MSK } from "../constants.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("adminSummaryService");

// ─── Types ───────────────────────────────────────────────────────────────────

export type SummaryPeriod = "today" | "yesterday" | "week" | "month" | "year";

export interface PeriodRange {
  from: Date;
  to: Date;
  label: string;
}

export interface CategoryStat {
  name: string;
  emoji: string;
  count: number;
  amount: number;
}

export interface UserCount {
  firstName: string;
  count: number;
}

export interface UserExpense {
  firstName: string;
  count: number;
  amount: number;
}

export interface UserCalendar {
  firstName: string;
  created: number;
  deleted: number;
}

export interface UsageSummaryData {
  period: PeriodRange;
  expenses: {
    count: number;
    totalAmount: number;
    textCount: number;
    voiceCount: number;
    categories: CategoryStat[];
    perUser: UserExpense[];
  };
  calendarEvents: {
    created: number;
    deleted: number;
    textCount: number;
    voiceCount: number;
    perUser: UserCalendar[];
  };
  transcriptions: {
    total: number;
    errors: number;
    perUser: UserCount[];
  };
  actionLogs: Array<{ action: string; count: number }>;
  gandalfEntries: {
    count: number;
    categories: Array<{ name: string; count: number }>;
  };
  chatMessages: {
    count: number;
    perUser: UserCount[];
  };
  digestRuns: {
    count: number;
    postsFound: number;
  };
  wishlistItems: { count: number };
  goals: { created: number; completed: number };
  notableDates: { count: number };
}

// ─── Period calculation ──────────────────────────────────────────────────────

export function getPeriodRange(period: SummaryPeriod): PeriodRange {
  const now = new Date();
  const msk = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE_MSK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const todayStart = new Date(`${msk}T00:00:00+03:00`);

  switch (period) {
    case "today":
      return {
        from: todayStart,
        to: new Date(todayStart.getTime() + 86_400_000),
        label: "сегодня",
      };
    case "yesterday": {
      const yd = new Date(todayStart.getTime() - 86_400_000);
      return { from: yd, to: todayStart, label: "вчера" };
    }
    case "week": {
      const wd = new Date(todayStart.getTime() - 7 * 86_400_000);
      return { from: wd, to: new Date(todayStart.getTime() + 86_400_000), label: "неделю" };
    }
    case "month": {
      const md = new Date(todayStart);
      md.setMonth(md.getMonth() - 1);
      return { from: md, to: new Date(todayStart.getTime() + 86_400_000), label: "месяц" };
    }
    case "year": {
      const yd = new Date(todayStart);
      yd.setFullYear(yd.getFullYear() - 1);
      return { from: yd, to: new Date(todayStart.getTime() + 86_400_000), label: "год" };
    }
  }
}

// ─── Data collection ─────────────────────────────────────────────────────────

export async function collectSummaryData(range: PeriodRange): Promise<UsageSummaryData> {
  const from = range.from.toISOString();
  const to = range.to.toISOString();

  async function safeQuery<T extends Record<string, unknown>>(
    statement: SQL,
    label: string,
  ): Promise<{ rows: T[] }> {
    try {
      const result = await db.execute<T>(statement);
      return { rows: result.rows as T[] };
    } catch (err) {
      log.error(`Summary query failed [${label}]`, err);
      return { rows: [] };
    }
  }

  const [
    expenseStats,
    expenseCategories,
    expenseUsers,
    calendarStats,
    calendarUsers,
    transcriptionStats,
    transcriptionUsers,
    actionStats,
    gandalfStats,
    chatCount,
    chatUsers,
    digestStats,
    wishlistCount,
    goalStats,
    notableCount,
  ] = await Promise.all([
    // 1. expenses: count, sum, text/voice split
    safeQuery<{ count: string; total: string; text_count: string; voice_count: string }>(
      sql`SELECT
         COUNT(*)::text AS count,
         COALESCE(SUM(${expenses.amount}), 0)::text AS total,
         COUNT(*) FILTER (WHERE ${expenses.inputMethod} = 'text')::text AS text_count,
         COUNT(*) FILTER (WHERE ${expenses.inputMethod} = 'voice')::text AS voice_count
       FROM ${expenses}
       WHERE ${expenses.createdAt} >= ${from} AND ${expenses.createdAt} < ${to}`,
      "expenses",
    ),
    // 2. expenses + categories: top-10
    safeQuery<{ name: string; emoji: string; cnt: string; amt: string }>(
      sql`SELECT ${categories.name} AS name, ${categories.emoji} AS emoji, COUNT(*)::text AS cnt, SUM(${expenses.amount})::text AS amt
       FROM ${expenses}
       JOIN ${categories} ON ${categories.id} = ${expenses.categoryId}
       WHERE ${expenses.createdAt} >= ${from} AND ${expenses.createdAt} < ${to}
       GROUP BY ${categories.id}, ${categories.name}, ${categories.emoji}
       ORDER BY SUM(${expenses.amount}) DESC
       LIMIT 10`,
      "expense_categories",
    ),
    // 3. expenses + users: per-user breakdown
    safeQuery<{ first_name: string; cnt: string; amt: string }>(
      sql`SELECT ${users.firstName} AS first_name, COUNT(*)::text AS cnt, SUM(${expenses.amount})::text AS amt
       FROM ${expenses}
       JOIN ${users} ON ${users.id} = ${expenses.userId}
       WHERE ${expenses.createdAt} >= ${from} AND ${expenses.createdAt} < ${to}
       GROUP BY ${users.id}, ${users.firstName}
       ORDER BY SUM(${expenses.amount}) DESC`,
      "expense_users",
    ),
    // 4. calendar_events: created/deleted, text/voice
    safeQuery<{ created: string; deleted: string; text_count: string; voice_count: string }>(
      sql`SELECT
         COUNT(*) FILTER (WHERE ${calendarEvents.status} = 'created')::text AS created,
         COUNT(*) FILTER (WHERE ${calendarEvents.status} = 'deleted')::text AS deleted,
         COUNT(*) FILTER (WHERE ${calendarEvents.inputMethod} = 'text')::text AS text_count,
         COUNT(*) FILTER (WHERE ${calendarEvents.inputMethod} = 'voice')::text AS voice_count
       FROM ${calendarEvents}
       WHERE ${calendarEvents.createdAt} >= ${from} AND ${calendarEvents.createdAt} < ${to}`,
      "calendar_events",
    ),
    // 5. calendar_events + users: per-user
    safeQuery<{ first_name: string; created: string; deleted: string }>(
      sql`SELECT ${users.firstName} AS first_name,
         COUNT(*) FILTER (WHERE ${calendarEvents.status} = 'created')::text AS created,
         COUNT(*) FILTER (WHERE ${calendarEvents.status} = 'deleted')::text AS deleted
       FROM ${calendarEvents}
       JOIN ${users} ON ${users.id} = ${calendarEvents.userId}
       WHERE ${calendarEvents.createdAt} >= ${from} AND ${calendarEvents.createdAt} < ${to}
       GROUP BY ${users.id}, ${users.firstName}
       ORDER BY COUNT(*) DESC`,
      "calendar_users",
    ),
    // 6. voice_transcriptions: total, errors
    safeQuery<{ total: string; errors: string }>(
      sql`SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE ${voiceTranscriptions.status} = 'error')::text AS errors
       FROM ${voiceTranscriptions}
       WHERE ${voiceTranscriptions.createdAt} >= ${from} AND ${voiceTranscriptions.createdAt} < ${to}`,
      "transcriptions",
    ),
    // 7. voice_transcriptions + users: per-user
    safeQuery<{ first_name: string; cnt: string }>(
      sql`SELECT ${users.firstName} AS first_name, COUNT(*)::text AS cnt
       FROM ${voiceTranscriptions}
       JOIN ${users} ON ${users.id} = ${voiceTranscriptions.userId}
       WHERE ${voiceTranscriptions.createdAt} >= ${from} AND ${voiceTranscriptions.createdAt} < ${to}
       GROUP BY ${users.id}, ${users.firstName}
       ORDER BY COUNT(*) DESC`,
      "transcription_users",
    ),
    // 8. action_logs: action types + counts (top 20)
    safeQuery<{ action: string; cnt: string }>(
      sql`SELECT ${actionLogs.action} AS action, COUNT(*)::text AS cnt
       FROM ${actionLogs}
       WHERE ${actionLogs.createdAt} >= ${from} AND ${actionLogs.createdAt} < ${to}
       GROUP BY ${actionLogs.action}
       ORDER BY COUNT(*) DESC
       LIMIT 20`,
      "action_logs",
    ),
    // 9. gandalf_entries + categories: entries per category
    safeQuery<{ name: string; cnt: string }>(
      sql`SELECT ${gandalfCategories.name} AS name, COUNT(*)::text AS cnt
       FROM ${gandalfEntries}
       JOIN ${gandalfCategories} ON ${gandalfCategories.id} = ${gandalfEntries.categoryId}
       WHERE ${gandalfEntries.createdAt} >= ${from} AND ${gandalfEntries.createdAt} < ${to}
       GROUP BY ${gandalfCategories.id}, ${gandalfCategories.name}
       ORDER BY COUNT(*) DESC`,
      "gandalf",
    ),
    // 10. chat_messages: count
    safeQuery<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count
       FROM ${chatMessages}
       WHERE ${chatMessages.createdAt} >= ${from} AND ${chatMessages.createdAt} < ${to}`,
      "chat_count",
    ),
    // 11. chat_messages + users: per-user
    safeQuery<{ first_name: string; cnt: string }>(
      sql`SELECT ${users.firstName} AS first_name, COUNT(*)::text AS cnt
       FROM ${chatMessages}
       JOIN ${users} ON ${users.id} = ${chatMessages.userId}
       WHERE ${chatMessages.createdAt} >= ${from} AND ${chatMessages.createdAt} < ${to}
       GROUP BY ${users.id}, ${users.firstName}
       ORDER BY COUNT(*) DESC`,
      "chat_users",
    ),
    // 12. digest_runs: count, posts_found
    safeQuery<{ count: string; posts_found: string }>(
      sql`SELECT COUNT(*)::text AS count, COALESCE(SUM(${digestRuns.postsFound}), 0)::text AS posts_found
       FROM ${digestRuns}
       WHERE ${digestRuns.createdAt} >= ${from} AND ${digestRuns.createdAt} < ${to}`,
      "digest_runs",
    ),
    // 13. wishlist_items: count
    safeQuery<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count
       FROM ${wishlistItems}
       WHERE ${wishlistItems.createdAt} >= ${from} AND ${wishlistItems.createdAt} < ${to}`,
      "wishlist",
    ),
    // 14. goals: created + completed
    safeQuery<{ created: string; completed: string }>(
      sql`SELECT
         COUNT(*)::text AS created,
         COUNT(*) FILTER (WHERE ${goals.isCompleted} = true)::text AS completed
       FROM ${goals}
       WHERE ${goals.createdAt} >= ${from} AND ${goals.createdAt} < ${to}`,
      "goals",
    ),
    // 15. notable_dates: count
    safeQuery<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count
       FROM ${notableDates}
       WHERE ${notableDates.createdAt} >= ${from} AND ${notableDates.createdAt} < ${to}`,
      "notable_dates",
    ),
  ]);

  return {
    period: range,
    expenses: {
      count: parseInt(expenseStats.rows[0]?.count ?? "0", 10),
      totalAmount: parseFloat(expenseStats.rows[0]?.total ?? "0"),
      textCount: parseInt(expenseStats.rows[0]?.text_count ?? "0", 10),
      voiceCount: parseInt(expenseStats.rows[0]?.voice_count ?? "0", 10),
      categories: expenseCategories.rows.map((r) => ({
        name: r.name,
        emoji: r.emoji,
        count: parseInt(r.cnt, 10),
        amount: parseFloat(r.amt),
      })),
      perUser: expenseUsers.rows.map((r) => ({
        firstName: r.first_name,
        count: parseInt(r.cnt, 10),
        amount: parseFloat(r.amt),
      })),
    },
    calendarEvents: {
      created: parseInt(calendarStats.rows[0]?.created ?? "0", 10),
      deleted: parseInt(calendarStats.rows[0]?.deleted ?? "0", 10),
      textCount: parseInt(calendarStats.rows[0]?.text_count ?? "0", 10),
      voiceCount: parseInt(calendarStats.rows[0]?.voice_count ?? "0", 10),
      perUser: calendarUsers.rows.map((r) => ({
        firstName: r.first_name,
        created: parseInt(r.created, 10),
        deleted: parseInt(r.deleted, 10),
      })),
    },
    transcriptions: {
      total: parseInt(transcriptionStats.rows[0]?.total ?? "0", 10),
      errors: parseInt(transcriptionStats.rows[0]?.errors ?? "0", 10),
      perUser: transcriptionUsers.rows.map((r) => ({
        firstName: r.first_name,
        count: parseInt(r.cnt, 10),
      })),
    },
    actionLogs: actionStats.rows.map((r) => ({
      action: r.action,
      count: parseInt(r.cnt, 10),
    })),
    gandalfEntries: {
      count: gandalfStats.rows.reduce((s, r) => s + parseInt(r.cnt, 10), 0),
      categories: gandalfStats.rows.map((r) => ({
        name: r.name,
        count: parseInt(r.cnt, 10),
      })),
    },
    chatMessages: {
      count: parseInt(chatCount.rows[0]?.count ?? "0", 10),
      perUser: chatUsers.rows.map((r) => ({
        firstName: r.first_name,
        count: parseInt(r.cnt, 10),
      })),
    },
    digestRuns: {
      count: parseInt(digestStats.rows[0]?.count ?? "0", 10),
      postsFound: parseInt(digestStats.rows[0]?.posts_found ?? "0", 10),
    },
    wishlistItems: { count: parseInt(wishlistCount.rows[0]?.count ?? "0", 10) },
    goals: {
      created: parseInt(goalStats.rows[0]?.created ?? "0", 10),
      completed: parseInt(goalStats.rows[0]?.completed ?? "0", 10),
    },
    notableDates: { count: parseInt(notableCount.rows[0]?.count ?? "0", 10) },
  };
}

// ─── Empty check ─────────────────────────────────────────────────────────────

export function isEmptyData(data: UsageSummaryData): boolean {
  return (
    data.expenses.count === 0 &&
    data.calendarEvents.created === 0 &&
    data.calendarEvents.deleted === 0 &&
    data.transcriptions.total === 0 &&
    data.actionLogs.length === 0 &&
    data.gandalfEntries.count === 0 &&
    data.chatMessages.count === 0 &&
    data.digestRuns.count === 0 &&
    data.wishlistItems.count === 0 &&
    data.goals.created === 0 &&
    data.notableDates.count === 0
  );
}

// ─── AI prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ты — аналитик использования Telegram-бота. Тебе дана JSON-статистика за период.
Составь краткое, информативное саммари на русском с эмодзи (Telegram Markdown).
Правила:
1. Заголовок: "📊 Саммари за [период]"
2. Группируй по модулям (расходы, календарь, транскрибация, база знаний, нейро-чат, дайджест, вишлист, цели, памятные даты)
3. Пропускай модули с нулевой активностью
4. Для расходов: топ категории, общая сумма, по пользователям
5. Показывай имена пользователей
6. Эмодзи для визуального разделения
7. Краткий инсайт в конце (1-2 предложения)
8. НЕ выводи приватные данные/содержимое — только агрегаты
9. Не более 2000 символов
10. Только *bold* и обычный текст, без блоков кода`;

function buildSummaryPrompt(data: UsageSummaryData): string {
  const json = {
    period: data.period.label,
    expenses: data.expenses,
    calendar: data.calendarEvents,
    transcriptions: data.transcriptions,
    actions: data.actionLogs,
    gandalf: data.gandalfEntries,
    chat: data.chatMessages,
    digest: data.digestRuns,
    wishlist: data.wishlistItems,
    goals: data.goals,
    notableDates: data.notableDates,
  };
  return JSON.stringify(json, null, 2);
}

// ─── Fallback formatter ──────────────────────────────────────────────────────

export function formatFallbackSummary(data: UsageSummaryData): string {
  const lines: string[] = [`📊 *Саммари за ${data.period.label}*\n`];

  if (data.expenses.count > 0) {
    lines.push(`💰 *Расходы:* ${data.expenses.count} записей на ${data.expenses.totalAmount.toLocaleString("ru-RU")} ₽`);
    if (data.expenses.perUser.length > 0) {
      for (const u of data.expenses.perUser) {
        lines.push(`  • ${u.firstName}: ${u.count} записей, ${u.amount.toLocaleString("ru-RU")} ₽`);
      }
    }
    lines.push("");
  }

  if (data.calendarEvents.created > 0 || data.calendarEvents.deleted > 0) {
    lines.push(`📅 *Календарь:* создано ${data.calendarEvents.created}, удалено ${data.calendarEvents.deleted}`);
    lines.push("");
  }

  if (data.transcriptions.total > 0) {
    lines.push(`🎙 *Транскрибация:* ${data.transcriptions.total} (ошибок: ${data.transcriptions.errors})`);
    lines.push("");
  }

  if (data.gandalfEntries.count > 0) {
    lines.push(`📚 *База знаний:* ${data.gandalfEntries.count} записей`);
    lines.push("");
  }

  if (data.chatMessages.count > 0) {
    lines.push(`💬 *Нейро-чат:* ${data.chatMessages.count} сообщений`);
    lines.push("");
  }

  if (data.digestRuns.count > 0) {
    lines.push(`📰 *Дайджест:* ${data.digestRuns.count} запусков, ${data.digestRuns.postsFound} постов`);
    lines.push("");
  }

  if (data.wishlistItems.count > 0) {
    lines.push(`🎁 *Вишлист:* ${data.wishlistItems.count} новых`);
    lines.push("");
  }

  if (data.goals.created > 0) {
    lines.push(`🎯 *Цели:* создано ${data.goals.created}, выполнено ${data.goals.completed}`);
    lines.push("");
  }

  if (data.notableDates.count > 0) {
    lines.push(`🗓 *Памятные даты:* ${data.notableDates.count} добавлено`);
    lines.push("");
  }

  if (data.actionLogs.length > 0) {
    lines.push(`⚡️ *Топ действий:*`);
    for (const a of data.actionLogs.slice(0, 10)) {
      lines.push(`  • ${a.action}: ${a.count}`);
    }
  }

  return lines.join("\n");
}

// ─── AI summary generation ──────────────────────────────────────────────────

export async function generateAiSummary(data: UsageSummaryData): Promise<string> {
  try {
    const prompt = buildSummaryPrompt(data);
    const result = await callOpenRouter({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });
    if (result) return result;
  } catch (err) {
    log.error("AI summary failed, using fallback", err);
  }
  return formatFallbackSummary(data);
}
