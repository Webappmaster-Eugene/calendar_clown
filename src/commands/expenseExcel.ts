import type { Context } from "telegraf";
import {
  getCategoryTotals,
  getExpensesForExcel,
  getUserByTelegramId,
  getTribeName,
  getEffectiveMonthLimit,
  getMonthlyCategoryTotalsForYear,
} from "../expenses/repository.js";
import { generateMonthlyExcel, generateYearlyExcel } from "../expenses/excel.js";
import { monthName } from "../expenses/formatter.js";
import { getMskNow, getMonthLimit } from "../utils/date.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DB_UNAVAILABLE_MSG } from "./expenseMode.js";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";

const log = createLogger("expense");

export async function handleExcelButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /expenses.");
    return;
  }

  const { year, month } = getMskNow();
  logAction(null, telegramId, "expense_excel", { year, month });
  await sendExcel(ctx, dbUser.tribeId!, year, month);
}

export async function handleExcelCallback(ctx: Context): Promise<void> {
  if (!("data" in ctx.callbackQuery!)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.answerCbQuery();
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  const match = data.match(/^excel:(\d+):(\d+)$/);
  if (!match) {
    await ctx.answerCbQuery("Неизвестная команда");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден.");
    return;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  await ctx.answerCbQuery("Генерирую Excel...");
  logAction(null, telegramId, "expense_excel", { year, month });
  await sendExcel(ctx, dbUser.tribeId!, year, month);
}

async function sendExcel(
  ctx: Context,
  tribeId: number,
  year: number,
  month: number
): Promise<void> {
  try {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));

    const [categoryTotals, detailedRows] = await Promise.all([
      getCategoryTotals(tribeId, from, to),
      getExpensesForExcel(tribeId, from, to),
    ]);

    if (categoryTotals.length === 0) {
      await ctx.reply(`За ${monthName(month)} ${year} расходов нет.`);
      return;
    }

    const limit = await getEffectiveMonthLimit(tribeId, year, month, getMonthLimit());
    const tribeName = await getTribeName(tribeId);
    const buffer = await generateMonthlyExcel(
      categoryTotals,
      detailedRows,
      year,
      month,
      tribeName,
      limit
    );

    const filename = `Расходы_${monthName(month)}_${year}.xlsx`;
    await ctx.replyWithDocument(
      { source: buffer, filename },
      { caption: `📥 ${monthName(month)} ${year}` }
    );
  } catch (err) {
    log.error("Error generating Excel:", err);
    const msg = err instanceof Error ? err.message : "Ошибка";
    await ctx.reply(`❌ Ошибка генерации Excel: ${msg}`);
  }
}

export async function handleYearExcelCallback(ctx: Context): Promise<void> {
  if (!("data" in ctx.callbackQuery!)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.answerCbQuery();
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  const match = data.match(/^excel_year:(\d+)$/);
  if (!match) {
    await ctx.answerCbQuery("Неизвестная команда");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден.");
    return;
  }

  const year = parseInt(match[1], 10);

  await ctx.answerCbQuery("Генерирую Excel за год...");
  logAction(null, telegramId, "expense_excel_year", { year });
  await sendYearExcel(ctx, dbUser.tribeId!, year);
}

async function sendYearExcel(ctx: Context, tribeId: number, year: number): Promise<void> {
  try {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));

    const [categoryTotals, detailedRows, pivotCells, tribeName] = await Promise.all([
      getCategoryTotals(tribeId, from, to),
      getExpensesForExcel(tribeId, from, to),
      getMonthlyCategoryTotalsForYear(tribeId, year),
      getTribeName(tribeId),
    ]);

    if (categoryTotals.length === 0) {
      await ctx.reply(`За ${year} расходов нет.`);
      return;
    }

    const fallback = getMonthLimit();
    let yearLimit = 0;
    for (let m = 1; m <= 12; m++) {
      yearLimit += await getEffectiveMonthLimit(tribeId, year, m, fallback);
    }

    const buffer = await generateYearlyExcel(
      categoryTotals,
      pivotCells,
      detailedRows,
      year,
      tribeName,
      yearLimit
    );

    const filename = `Расходы_${year}_год.xlsx`;
    await ctx.replyWithDocument(
      { source: buffer, filename },
      { caption: `📥 За ${year}` }
    );
  } catch (err) {
    log.error("Error generating yearly Excel:", err);
    const msg = err instanceof Error ? err.message : "Ошибка";
    await ctx.reply(`❌ Ошибка генерации Excel: ${msg}`);
  }
}
