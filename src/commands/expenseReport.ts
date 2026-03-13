import type { Context } from "telegraf";
import { Markup } from "telegraf";
import {
  getCategoryTotals,
  getUserTotals,
  getMonthTotal,
  getMonthComparison,
  getUserByTelegramId,
  getTribeName,
} from "../expenses/repository.js";
import {
  formatMonthReport,
  formatComparisonReport,
  formatUserStats,
  formatYearReport,
  monthName,
} from "../expenses/formatter.js";
import { getMskNow, getMonthRange, getMonthLimit } from "../utils/date.js";

// ─── Report command / button ──────────────────────────────────────────

export async function handleReportButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

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

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден. Отправьте /expenses.");
    return;
  }

  // report:<year>:<month>
  const reportMatch = data.match(/^report:(\d+):(\d+)$/);
  if (reportMatch) {
    const year = parseInt(reportMatch[1], 10);
    const month = parseInt(reportMatch[2], 10);
    const { from, to } = getMonthRange(year, month);

    const totals = await getCategoryTotals(dbUser.tribeId, from, to);
    const grandTotal = totals.reduce((s, t) => s + t.total, 0);
    const limit = getMonthLimit();

    const tribeName = await getTribeName(dbUser.tribeId);
    const text = formatMonthReport(totals, grandTotal, limit, year, month, tribeName);

    // Navigation buttons
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(`◀️ ${monthName(prevMonth)}`, `report:${prevYear}:${prevMonth}`),
          Markup.button.callback(`${monthName(month)} ${year}`, `noop`),
          Markup.button.callback(`${monthName(nextMonth)} ▶️`, `report:${nextYear}:${nextMonth}`),
        ],
        [
          Markup.button.callback("📥 Скачать Excel", `excel:${year}:${month}`),
          Markup.button.callback("📈 Сравнение", `compare:${year}:${month}`),
        ],
      ]),
    });
    await ctx.answerCbQuery();
    return;
  }

  // report_year:<year>
  const yearMatch = data.match(/^report_year:(\d+)$/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    const monthlyData: Array<{ month: number; total: number }> = [];
    for (let m = 1; m <= 12; m++) {
      const total = await getMonthTotal(dbUser.tribeId, year, m);
      monthlyData.push({ month: m, total });
    }

    const tribeName = await getTribeName(dbUser.tribeId);
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

    const comparisons = await getMonthComparison(dbUser.tribeId, year1, month1, year2, month2);
    const text = formatComparisonReport(comparisons, year1, month1, year2, month2);

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

    const userTotals = await getUserTotals(dbUser.tribeId, from, to);
    const categoryTotals = await getCategoryTotals(dbUser.tribeId, from, to);
    const sorted = [...categoryTotals].sort((a, b) => b.total - a.total);

    const tribeName = await getTribeName(dbUser.tribeId);
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

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /expenses.");
    return;
  }

  const { year, month } = getMskNow();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const comparisons = await getMonthComparison(dbUser.tribeId, prevYear, prevMonth, year, month);
  const text = formatComparisonReport(comparisons, prevYear, prevMonth, year, month);

  await ctx.replyWithMarkdown(text);
}

// ─── User stats button handler ────────────────────────────────────────

export async function handleStatsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /expenses.");
    return;
  }

  const { year, month } = getMskNow();
  const { from, to } = getMonthRange(year, month);

  const userTotals = await getUserTotals(dbUser.tribeId, from, to);
  const categoryTotals = await getCategoryTotals(dbUser.tribeId, from, to);
  const sorted = [...categoryTotals].sort((a, b) => b.total - a.total);

  const tribeName = await getTribeName(dbUser.tribeId);
  const text = formatUserStats(userTotals, sorted, tribeName, year, month);

  await ctx.replyWithMarkdown(text);
}
