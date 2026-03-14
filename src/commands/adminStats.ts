import type { Context } from "telegraf";
import { readdir } from "fs/promises";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { query } from "../db/connection.js";
import { DB_UNAVAILABLE_MSG } from "./expenseMode.js";

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
    query<{ count: string }>("SELECT COUNT(*) AS count FROM users"),
    query<{ total: string; text_count: string; voice_count: string; total_amount: string }>(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE input_method = 'text') AS text_count,
        COUNT(*) FILTER (WHERE input_method = 'voice') AS voice_count,
        COALESCE(SUM(amount), 0) AS total_amount
      FROM expenses`
    ),
    query<{ created: string; deleted: string; text_count: string; voice_count: string }>(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'created') AS created,
        COUNT(*) FILTER (WHERE status = 'deleted') AS deleted,
        COUNT(*) FILTER (WHERE input_method = 'text') AS text_count,
        COUNT(*) FILTER (WHERE input_method = 'voice') AS voice_count
      FROM calendar_events`
    ),
    query<{ total: string; errors: string }>(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'error') AS errors
      FROM voice_transcriptions`
    ),
    query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM digest_rubrics WHERE is_active = true"
    ),
    query<{ count: string }>("SELECT COUNT(*) AS count FROM digest_runs"),
    query<{ count: string }>("SELECT COUNT(*) AS count FROM digest_posts"),
  ]);

  const linkedCalendars = await countLinkedCalendars();

  return {
    totalUsers: parseInt(usersResult.rows[0].count, 10),
    linkedCalendars,
    expenses: {
      total: parseInt(expensesResult.rows[0].total, 10),
      textCount: parseInt(expensesResult.rows[0].text_count, 10),
      voiceCount: parseInt(expensesResult.rows[0].voice_count, 10),
      totalAmount: parseFloat(expensesResult.rows[0].total_amount),
    },
    calendarEvents: {
      created: parseInt(eventsResult.rows[0].created, 10),
      deleted: parseInt(eventsResult.rows[0].deleted, 10),
      textCount: parseInt(eventsResult.rows[0].text_count, 10),
      voiceCount: parseInt(eventsResult.rows[0].voice_count, 10),
    },
    transcriptions: {
      total: parseInt(transcriptionsResult.rows[0].total, 10),
      errors: parseInt(transcriptionsResult.rows[0].errors, 10),
    },
    digest: {
      activeRubrics: parseInt(digestRubricsResult.rows[0].count, 10),
      totalRuns: parseInt(digestRunsResult.rows[0].count, 10),
      totalPosts: parseInt(digestPostsResult.rows[0].count, 10),
    },
  };
}

async function getPerUserStats(): Promise<UserStats[]> {
  const result = await query<{
    telegram_id: string;
    first_name: string;
    username: string;
    role: string;
    expense_count: string;
    event_count: string;
    voice_count: string;
  }>(
    `SELECT
      u.telegram_id,
      u.first_name,
      COALESCE(u.username, '') AS username,
      u.role,
      COALESCE(e.cnt, 0) AS expense_count,
      COALESCE(ce.cnt, 0) AS event_count,
      COALESCE(vt.cnt, 0) AS voice_count
    FROM users u
    LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM expenses GROUP BY user_id) e ON e.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM calendar_events GROUP BY user_id) ce ON ce.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM voice_transcriptions GROUP BY user_id) vt ON vt.user_id = u.id
    ORDER BY u.role DESC, u.first_name`
  );

  return result.rows.map((r) => ({
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
