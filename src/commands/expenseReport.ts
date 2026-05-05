import type { Context } from "telegraf";
import { Markup } from "telegraf";
import {
  getCategoryTotals,
  getUserTotals,
  getMonthTotal,
  getMonthComparison,
  getUserByTelegramId,
  getTribeName,
  getAllExpensesForReport,
  getEffectiveMonthLimit,
} from "../expenses/repository.js";
import {
  formatComparisonReport,
  formatUserStats,
  formatYearReport,
  formatDetailedMonthReport,
  monthName,
  type DetailedReportCategory,
} from "../expenses/formatter.js";
import { getMskNow, getMonthRange, getMonthLimit } from "../utils/date.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DB_UNAVAILABLE_MSG } from "./expenseMode.js";
import { logAction } from "../logging/actionLogger.js";

// ─── Report command / button ──────────────────────────────────────────

export async function handleReportButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  logAction(null, telegramId, "expense_report", {});

  const { year, month } = getMskNow();

  await ctx.reply("📊 Выберите период:", {
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback("📅 Текущий месяц", `report:${year}:${month}`),
        Markup.button.callback("📅 Прошлый месяц", `report:${month === 1 ? year - 1 : year}:${month === 1 ? 12 : month - 1}`),
      ],
      [
        Markup.button.callback("📆 За год", `report_year:${year}`),
      ],
      [
        Markup.button.callback("📈 Сравнение месяцев", `compare:${year}:${month}`),
        Markup.button.callback("👥 По пользователям", `stats:${year}:${month}`),
      ],
    ]),
  });
}

export async function handleReportCallback(ctx: Context): Promise<void> {
  if (!("data" in ctx.callbackQuery!)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.answerCbQuery();
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден. Отправьте /expenses.");
    return;
  }

  // report:<year>:<month> — detailed monthly report (every operation visible).
  const reportMatch = data.match(/^report:(\d+):(\d+)$/);
  if (reportMatch) {
    const year = parseInt(reportMatch[1], 10);
    const month = parseInt(reportMatch[2], 10);
    const { from, to } = getMonthRange(year, month);

    const [totals, allExpenses, tribeName] = await Promise.all([
      getCategoryTotals(dbUser.tribeId!, from, to),
      getAllExpensesForReport(dbUser.tribeId!, from, to),
      getTribeName(dbUser.tribeId!),
    ]);

    const grandTotal = totals.reduce((s, t) => s + t.total, 0);
    const limit = await getEffectiveMonthLimit(dbUser.tribeId!, year, month, getMonthLimit());

    // Group operations by category for the formatter (one ordered list per category).
    const expensesByCategory = new Map<number, DetailedReportCategory["expenses"]>();
    for (const e of allExpenses) {
      const list = expensesByCategory.get(e.categoryId);
      const dto = {
        subcategory: e.subcategory,
        amount: e.amount,
        firstName: e.firstName,
        createdAt: e.createdAt,
      };
      if (list) list.push(dto);
      else expensesByCategory.set(e.categoryId, [dto]);
    }
    const detailedCategories: DetailedReportCategory[] = totals.map((t) => ({
      categoryEmoji: t.categoryEmoji,
      categoryName: t.categoryName,
      total: t.total,
      expenses: expensesByCategory.get(t.categoryId) ?? [],
    }));

    const segments = formatDetailedMonthReport(
      detailedCategories,
      grandTotal,
      limit,
      year,
      month,
      tribeName
    );

    // Navigation buttons (period nav + Excel + comparison) attach only to the last segment.
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const navMarkup = Markup.inlineKeyboard([
      [
        Markup.button.callback(`◀️ ${monthName(prevMonth)}`, `report:${prevYear}:${prevMonth}`),
        Markup.button.callback(`${monthName(month)} ${year}`, `noop`),
        Markup.button.callback(`${monthName(nextMonth)} ▶️`, `report:${nextYear}:${nextMonth}`),
      ],
      [
        Markup.button.callback("📥 Скачать Excel", `excel:${year}:${month}`),
        Markup.button.callback("📈 Сравнение", `compare:${year}:${month}`),
      ],
    ]);

    // First segment replaces the originating menu message; further segments are
    // sent as new replies. Buttons live on the LAST segment so they remain
    // visible after Telegram scrolls past intermediate messages.
    for (let i = 0; i < segments.length; i++) {
      const isFirst = i === 0;
      const isLast = i === segments.length - 1;
      const extra = {
        parse_mode: "Markdown" as const,
        ...(isLast ? navMarkup : {}),
      };
      if (isFirst) {
        await ctx.editMessageText(segments[i], extra);
      } else {
        await ctx.reply(segments[i], extra);
      }
    }
    await ctx.answerCbQuery();
    return;
  }

  // report_year:<year>
  const yearMatch = data.match(/^report_year:(\d+)$/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    const monthlyData: Array<{ month: number; total: number }> = [];
    for (let m = 1; m <= 12; m++) {
      const total = await getMonthTotal(dbUser.tribeId!, year, m);
      monthlyData.push({ month: m, total });
    }

    const tribeName = await getTribeName(dbUser.tribeId!);
    const text = formatYearReport(monthlyData, year, tribeName);

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(`◀️ ${year - 1}`, `report_year:${year - 1}`),
          Markup.button.callback(`${year}`, `noop`),
          Markup.button.callback(`${year + 1} ▶️`, `report_year:${year + 1}`),
        ],
      ]),
    });
    await ctx.answerCbQuery();
    return;
  }

  // compare:<year>:<month> — current month vs previous
  const compareMatch = data.match(/^compare:(\d+):(\d+)$/);
  if (compareMatch) {
    const year2 = parseInt(compareMatch[1], 10);
    const month2 = parseInt(compareMatch[2], 10);
    const month1 = month2 === 1 ? 12 : month2 - 1;
    const year1 = month2 === 1 ? year2 - 1 : year2;

    const mskNow = getMskNow();
    const isCurrentMonth = year2 === mskNow.year && month2 === mskNow.month;
    const comparisonDay = isCurrentMonth ? mskNow.day : undefined;

    const comparisons = await getMonthComparison(dbUser.tribeId!, year1, month1, year2, month2, comparisonDay);
    const text = formatComparisonReport(comparisons, year1, month1, year2, month2, comparisonDay);

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("◀️ Назад к отчёту", `report:${year2}:${month2}`)],
      ]),
    });
    await ctx.answerCbQuery();
    return;
  }

  // stats:<year>:<month>
  const statsMatch = data.match(/^stats:(\d+):(\d+)$/);
  if (statsMatch) {
    const year = parseInt(statsMatch[1], 10);
    const month = parseInt(statsMatch[2], 10);
    const { from, to } = getMonthRange(year, month);

    const userTotals = await getUserTotals(dbUser.tribeId!, from, to);
    const categoryTotals = await getCategoryTotals(dbUser.tribeId!, from, to);
    const sorted = [...categoryTotals].sort((a, b) => b.total - a.total);

    const tribeName = await getTribeName(dbUser.tribeId!);
    const text = formatUserStats(userTotals, sorted, tribeName, year, month);

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("◀️ Назад к отчёту", `report:${year}:${month}`)],
      ]),
    });
    await ctx.answerCbQuery();
    return;
  }

  // noop
  if (data === "noop") {
    await ctx.answerCbQuery();
    return;
  }

  await ctx.answerCbQuery("Неизвестная команда");
}

// ─── Comparison button handler ────────────────────────────────────────

export async function handleComparisonButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  logAction(null, telegramId, "expense_comparison", {});

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /expenses.");
    return;
  }

  const { year, month, day } = getMskNow();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const comparisons = await getMonthComparison(dbUser.tribeId!, prevYear, prevMonth, year, month, day);
  const text = formatComparisonReport(comparisons, prevYear, prevMonth, year, month, day);

  await ctx.replyWithMarkdown(text);
}

// ─── User stats button handler ────────────────────────────────────────

export async function handleStatsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  logAction(null, telegramId, "expense_stats", {});

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /expenses.");
    return;
  }

  const { year, month } = getMskNow();
  const { from, to } = getMonthRange(year, month);

  const userTotals = await getUserTotals(dbUser.tribeId!, from, to);
  const categoryTotals = await getCategoryTotals(dbUser.tribeId!, from, to);
  const sorted = [...categoryTotals].sort((a, b) => b.total - a.total);

  const tribeName = await getTribeName(dbUser.tribeId!);
  const text = formatUserStats(userTotals, sorted, tribeName, year, month);

  await ctx.replyWithMarkdown(text);
}
