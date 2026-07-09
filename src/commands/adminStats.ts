import type { Context } from "telegraf";
import { readdir } from "fs/promises";
import { count, eq, sql } from "drizzle-orm";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { db } from "../db/drizzle.js";
import {
  calendarEvents,
  digestPosts,
  digestRubrics,
  digestRuns,
  expenses,
  users,
  voiceTranscriptions,
} from "../db/schema.js";
import { DB_UNAVAILABLE_MSG } from "./expenseMode.js";
import { logAction } from "../logging/actionLogger.js";

const TOKENS_DIR = "./data/tokens";

interface GlobalStats {
  totalUsers: number;
  linkedCalendars: number;
  expenses: { total: number; textCount: number; voiceCount: number; totalAmount: number };
  calendarEvents: { created: number; deleted: number; textCount: number; voiceCount: number };
  transcriptions: { total: number; errors: number };
  digest: { activeRubrics: number; totalRuns: number; totalPosts: number };
}

interface UserStats {
  telegramId: string;
  firstName: string;
  username: string;
  role: string;
  expenseCount: number;
  eventCount: number;
  voiceCount: number;
}

async function countLinkedCalendars(): Promise<number> {
  try {
    const files = await readdir(TOKENS_DIR);
    return files.filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

async function getGlobalStats(): Promise<GlobalStats> {
  const [
    usersResult,
    expensesResult,
    eventsResult,
    transcriptionsResult,
    digestRubricsResult,
    digestRunsResult,
    digestPostsResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(users),
    db
      .select({
        total: count(),
        textCount: sql<string>`count(*) filter (where ${expenses.inputMethod} = 'text')`,
        voiceCount: sql<string>`count(*) filter (where ${expenses.inputMethod} = 'voice')`,
        totalAmount: sql<string>`coalesce(sum(${expenses.amount}), 0)`,
      })
      .from(expenses),
    db
      .select({
        created: sql<string>`count(*) filter (where ${calendarEvents.status} = 'created')`,
        deleted: sql<string>`count(*) filter (where ${calendarEvents.status} = 'deleted')`,
        textCount: sql<string>`count(*) filter (where ${calendarEvents.inputMethod} = 'text')`,
        voiceCount: sql<string>`count(*) filter (where ${calendarEvents.inputMethod} = 'voice')`,
      })
      .from(calendarEvents),
    db
      .select({
        total: count(),
        errors: sql<string>`count(*) filter (where ${voiceTranscriptions.status} = 'error')`,
      })
      .from(voiceTranscriptions),
    db.select({ count: count() }).from(digestRubrics).where(eq(digestRubrics.isActive, true)),
    db.select({ count: count() }).from(digestRuns),
    db.select({ count: count() }).from(digestPosts),
  ]);

  const linkedCalendars = await countLinkedCalendars();

  return {
    totalUsers: usersResult[0].count,
    linkedCalendars,
    expenses: {
      total: expensesResult[0].total,
      textCount: parseInt(expensesResult[0].textCount, 10),
      voiceCount: parseInt(expensesResult[0].voiceCount, 10),
      totalAmount: parseFloat(expensesResult[0].totalAmount),
    },
    calendarEvents: {
      created: parseInt(eventsResult[0].created, 10),
      deleted: parseInt(eventsResult[0].deleted, 10),
      textCount: parseInt(eventsResult[0].textCount, 10),
      voiceCount: parseInt(eventsResult[0].voiceCount, 10),
    },
    transcriptions: {
      total: transcriptionsResult[0].total,
      errors: parseInt(transcriptionsResult[0].errors, 10),
    },
    digest: {
      activeRubrics: digestRubricsResult[0].count,
      totalRuns: digestRunsResult[0].count,
      totalPosts: digestPostsResult[0].count,
    },
  };
}

async function getPerUserStats(): Promise<UserStats[]> {
  // Multi-subquery per-user dashboard: three correlated grouped-count LEFT JOINs.
  // Kept as a single statement via the db.execute escape hatch; column-object
  // interpolation keeps table/column renames compile-checked.
  const { rows } = await db.execute<{
    telegram_id: string;
    first_name: string;
    username: string;
    role: string;
    expense_count: string;
    event_count: string;
    voice_count: string;
  }>(sql`
    SELECT
      ${users.telegramId} AS telegram_id,
      ${users.firstName} AS first_name,
      COALESCE(${users.username}, '') AS username,
      ${users.role} AS role,
      COALESCE(e.cnt, 0) AS expense_count,
      COALESCE(ce.cnt, 0) AS event_count,
      COALESCE(vt.cnt, 0) AS voice_count
    FROM ${users}
    LEFT JOIN (SELECT ${expenses.userId} AS user_id, COUNT(*) AS cnt FROM ${expenses} GROUP BY ${expenses.userId}) e ON e.user_id = ${users.id}
    LEFT JOIN (SELECT ${calendarEvents.userId} AS user_id, COUNT(*) AS cnt FROM ${calendarEvents} GROUP BY ${calendarEvents.userId}) ce ON ce.user_id = ${users.id}
    LEFT JOIN (SELECT ${voiceTranscriptions.userId} AS user_id, COUNT(*) AS cnt FROM ${voiceTranscriptions} GROUP BY ${voiceTranscriptions.userId}) vt ON vt.user_id = ${users.id}
    ORDER BY ${users.role} DESC, ${users.firstName}
  `);

  return rows.map((r) => ({
    telegramId: r.telegram_id,
    firstName: r.first_name,
    username: r.username,
    role: r.role,
    expenseCount: parseInt(r.expense_count, 10),
    eventCount: parseInt(r.event_count, 10),
    voiceCount: parseInt(r.voice_count, 10),
  }));
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

function formatStats(global: GlobalStats, perUser: UserStats[]): string {
  const lines: string[] = [
    "📊 *Статистика бота*",
    "",
    `👥 Пользователи: ${global.totalUsers}`,
    `📅 Календарь привязан: ${global.linkedCalendars} из ${global.totalUsers}`,
    "",
    "💰 *Расходы:*",
    `  Всего записей: ${global.expenses.total} (текст: ${global.expenses.textCount}, голос: ${global.expenses.voiceCount})`,
    `  Сумма: ${formatAmount(global.expenses.totalAmount)} ₽`,
    "",
    "📅 *События календаря:*",
    `  Создано: ${global.calendarEvents.created} (текст: ${global.calendarEvents.textCount}, голос: ${global.calendarEvents.voiceCount})`,
    `  Отменено: ${global.calendarEvents.deleted}`,
    "",
    "🎙 *Транскрибация:*",
    `  Обработано: ${global.transcriptions.total}`,
    `  Ошибок: ${global.transcriptions.errors}`,
    "",
    "📰 *Дайджест:*",
    `  Активных рубрик: ${global.digest.activeRubrics}`,
    `  Прогонов всего: ${global.digest.totalRuns}`,
    `  Постов собрано: ${global.digest.totalPosts}`,
  ];

  if (perUser.length > 0) {
    lines.push("", "👤 *По пользователям:*");
    for (const u of perUser) {
      const icon = u.role === "admin" ? "👑" : "👤";
      const name = u.firstName || u.username || u.telegramId;
      lines.push(
        `  ${icon} ${name} (${u.telegramId}) — расходы: ${u.expenseCount}, события: ${u.eventCount}, голос: ${u.voiceCount}`
      );
    }
  }

  return lines.join("\n");
}

export async function handleStatsCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null || !isBootstrapAdmin(telegramId)) {
    await ctx.reply("Эта команда доступна только администратору.");
    return;
  }

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  logAction(null, telegramId, "admin_stats_view");

  try {
    const [global, perUser] = await Promise.all([
      getGlobalStats(),
      getPerUserStats(),
    ]);

    const text = formatStats(global, perUser);

    try {
      await ctx.replyWithMarkdown(text);
    } catch {
      await ctx.reply(text.replace(/[*_`\[\]\\]/g, ""));
    }
  } catch (err) {
    console.error("Stats error:", err);
    await ctx.reply("Ошибка при получении статистики.");
  }
}
