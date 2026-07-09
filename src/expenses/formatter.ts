import type { CategoryTotal, MonthComparison, UserTotal } from "./types.js";
import { TIMEZONE_MSK } from "../constants.js";
import { escapeMarkdown } from "../utils/markdown.js";

const RU_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const RU_MONTHS_SHORT = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

export function monthName(month: number): string {
  return RU_MONTHS[month - 1] ?? `Месяц ${month}`;
}

export function monthNameShort(month: number): string {
  return RU_MONTHS_SHORT[month - 1] ?? `М${month}`;
}

export function formatMoney(amount: number): string {
  return Math.round(amount).toLocaleString("ru-RU") + " ₽";
}

export function formatMoneyShort(amount: number): string {
  return Math.round(amount).toLocaleString("ru-RU");
}

export function formatComparisonReport(
  comparisons: MonthComparison[],
  _year1: number,
  month1: number,
  year2: number,
  month2: number,
  day?: number
): string {
  const m1 = monthName(month1);
  const m2 = monthName(month2);
  const periodSuffix = day ? ` (1–${day})` : "";
  const header = `📈 *Сравнение: ${m1} → ${m2} ${year2}${periodSuffix}*`;
  const separator = "━━━━━━━━━━━━━━━━━━━━━━━";

  if (comparisons.length === 0) {
    return `${header}\n${separator}\nНет данных для сравнения.`;
  }

  const lines = comparisons.map((c) => {
    const arrow = c.diff > 0 ? "↗️" : c.diff < 0 ? "↘️" : "➡️";
    const diffStr = c.diff > 0 ? `+${formatMoneyShort(c.diff)}` : formatMoneyShort(c.diff);
    return `${c.categoryEmoji} ${c.categoryName}  ${formatMoneyShort(c.prevTotal)} → ${formatMoneyShort(c.currTotal)}  ${arrow} ${diffStr}`;
  });

  const prevSum = comparisons.reduce((s, c) => s + c.prevTotal, 0);
  const currSum = comparisons.reduce((s, c) => s + c.currTotal, 0);
  const totalDiff = currSum - prevSum;
  const totalArrow = totalDiff > 0 ? "↗️" : totalDiff < 0 ? "↘️" : "➡️";
  const totalDiffStr = totalDiff > 0 ? `+${formatMoney(totalDiff)}` : formatMoney(totalDiff);

  return [
    header,
    separator,
    ...lines,
    separator,
    `💰 ${m1}: ${formatMoney(prevSum)} → ${m2}: ${formatMoney(currSum)} (${totalArrow} ${totalDiffStr})`,
  ].join("\n");
}

export function formatUserStats(
  userTotals: UserTotal[],
  topCategories: CategoryTotal[],
  tribeName: string,
  year: number,
  month: number
): string {
  const header = `📊 *Статистика трат: ${tribeName}*\nПериод: ${monthName(month)} ${year}`;
  const separator = "━━━━━━━━━━━━━━━━━━━━━━━";

  const grandTotal = userTotals.reduce((s, u) => s + u.total, 0);

  const userLines = userTotals.map((u) => {
    const pct = grandTotal > 0 ? ((u.total / grandTotal) * 100).toFixed(0) : "0";
    return `👤 ${u.firstName}: ${formatMoney(u.total)} (${pct}%)`;
  });

  const topLines = topCategories.slice(0, 5).map((c, i) =>
    `${i + 1}. ${c.categoryEmoji} ${c.categoryName} — ${formatMoney(c.total)}`
  );

  return [
    header,
    "",
    ...userLines,
    separator,
    `💰 *Итого:* ${formatMoney(grandTotal)}`,
    "",
    "Топ категории:",
    ...topLines,
  ].join("\n");
}

export function formatExpenseConfirmation(
  emoji: string,
  categoryName: string,
  subcategory: string | null,
  amount: number,
  date: Date,
  firstName: string,
  monthTotal: number,
  monthLimit: number,
  currentMonth: string
): string {
  const dateStr = date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE_MSK,
  });

  const parts = [
    "✅ *Записано:*",
    `${emoji} ${categoryName}${subcategory ? ` — ${subcategory}` : ""} — ${formatMoney(amount)}`,
    `📅 ${dateStr}`,
    `👤 ${firstName}`,
  ];

  if (monthLimit > 0) {
    const pct = ((monthTotal / monthLimit) * 100).toFixed(1);
    parts.push("");
    parts.push(`💰 Итого за ${currentMonth}: ${formatMoney(monthTotal)} / ${formatMoney(monthLimit)} (${pct}%)`);

    if (monthTotal >= monthLimit) {
      parts.push("🚨 *Лимит превышен!*");
    } else if (monthTotal >= monthLimit * 0.9) {
      parts.push("⚠️ *Приближаетесь к лимиту!*");
    }
  }

  return parts.join("\n");
}

export function formatYearReport(
  monthlyData: Array<{ month: number; total: number }>,
  year: number,
  tribeName: string
): string {
  const header = `📊 *Расходы за ${year} год*\nТрайб: ${tribeName}`;
  const separator = "━━━━━━━━━━━━━━━━━━━━━━━";

  const lines = monthlyData
    .filter((m) => m.total > 0)
    .map((m) => `📅 ${monthName(m.month)}: ${formatMoney(m.total)}`);

  const grandTotal = monthlyData.reduce((s, m) => s + m.total, 0);

  return [
    header,
    separator,
    ...(lines.length > 0 ? lines : ["Нет данных за этот год."]),
    separator,
    `💰 *Итого за год:* ${formatMoney(grandTotal)}`,
  ].join("\n");
}

/** Maximum length of a single Telegram message segment. Telegram allows 4096
 *  characters; we keep a comfortable margin for the «(продолжение N/M)» suffix
 *  and any client-specific quirks. */
const MAX_SEGMENT_LENGTH = 3800;

/** Subcategory text is truncated to this length to keep individual lines compact. */
const MAX_SUBCATEGORY_DISPLAY = 60;

/** Single detailed expense for the bot's per-category report block. */
export interface DetailedReportExpense {
  subcategory: string | null;
  amount: number;
  firstName: string;
  createdAt: Date;
}

/** Per-category block for the detailed monthly report. */
export interface DetailedReportCategory {
  categoryEmoji: string;
  categoryName: string;
  total: number;
  expenses: DetailedReportExpense[];
}

function truncateSubcategory(text: string): string {
  if (text.length <= MAX_SUBCATEGORY_DISPLAY) return text;
  return text.slice(0, MAX_SUBCATEGORY_DISPLAY - 1).trimEnd() + "…";
}

function formatDetailedExpenseLine(e: DetailedReportExpense): string {
  const date = e.createdAt.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE_MSK,
  });
  const sub = e.subcategory
    ? ` — ${escapeMarkdown(truncateSubcategory(e.subcategory))}`
    : "";
  return `  • ${formatMoney(e.amount)}${sub} · ${escapeMarkdown(e.firstName)} · ${date}`;
}

/**
 * Render the fully-detailed monthly expense report for the bot, splitting it
 * into one or more segments each fitting into a single Telegram message.
 *
 * Layout per segment:
 *   - Header: «📊 Расходы за <месяц> <год>» (with «(продолжение N/M)» on later parts)
 *   - Per-category blocks: «<emoji> <name> — <total>» followed by every operation
 *   - Trailing footer (only on the last segment): grand total and limit progress
 *
 * The function packs lines greedily, allowing a category block to span multiple
 * segments when it alone exceeds the per-message budget. Lines are atomic — a
 * single line is never split mid-string.
 */
export function formatDetailedMonthReport(
  categories: DetailedReportCategory[],
  grandTotal: number,
  monthLimit: number,
  year: number,
  month: number,
  tribeName: string
): string[] {
  const baseHeader = `📊 *Расходы за ${monthName(month)} ${year}*\nТрайб: ${escapeMarkdown(tribeName)}`;
  const separator = "━━━━━━━━━━━━━━━━━━━━━━━";

  if (categories.length === 0) {
    return [`${baseHeader}\n${separator}\nЗа этот период расходов нет.`];
  }

  const limitPercent = monthLimit > 0 ? ((grandTotal / monthLimit) * 100).toFixed(1) : "0";
  const limitIcon = grandTotal >= monthLimit ? "🚨" : grandTotal >= monthLimit * 0.9 ? "⚠️" : "✅";
  const footerLines: string[] = [
    separator,
    `💰 *Итого:* ${formatMoney(grandTotal)}`,
  ];
  if (monthLimit > 0) {
    footerLines.push(`📊 *Лимит:* ${formatMoney(monthLimit)} (${limitPercent}%) ${limitIcon}`);
  }
  const footerBlock = footerLines.join("\n");

  // Build a flat list of "atomic" lines, then pack them into segments.
  const lines: string[] = [];
  for (const cat of categories) {
    lines.push(`${cat.categoryEmoji} *${escapeMarkdown(cat.categoryName)}* — ${formatMoney(cat.total)}`);
    for (const e of cat.expenses) {
      lines.push(formatDetailedExpenseLine(e));
    }
  }

  // Reserve a worst-case continuation-header length so that even when the final
  // header gets long indices like «(продолжение 99/99)», segment length stays
  // within the budget. The actual header is computed after the total count is known.
  const continuationHeaderPlaceholder =
    `📊 *Расходы за ${monthName(month)} ${year}* _(продолжение 99/99)_`;
  const continuationHeaderLen = continuationHeaderPlaceholder.length;

  const PLACEHOLDER = " CONT_HEADER "; // sentinel that cannot appear in user data

  const segments: string[] = [];
  let current = `${baseHeader}\n${separator}`;
  // Per-segment budget for current = MAX_SEGMENT_LENGTH minus any expansion at finalize.
  // For segment 0 the header is final; for later segments we account for the
  // delta between the placeholder length and the worst-case continuation header.
  let placeholderDelta = 0;

  const pushAndReset = () => {
    segments.push(current);
    current = `${PLACEHOLDER}\n${separator}`;
    placeholderDelta = continuationHeaderLen - PLACEHOLDER.length;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const candidate = `${current}\n${line}`;
    const isLastLine = i === lines.length - 1;
    const reservedFooter = isLastLine ? `\n${footerBlock}`.length : 0;

    if (candidate.length + placeholderDelta + reservedFooter <= MAX_SEGMENT_LENGTH) {
      current = candidate;
    } else {
      pushAndReset();
      current = `${current}\n${line}`;
    }
  }

  // Append footer to the final (in-progress) segment before flushing it.
  current = `${current}\n${footerBlock}`;
  segments.push(current);

  // Resolve placeholders now that we know the total segment count.
  const total = segments.length;
  return segments.map((seg, idx) => {
    if (idx === 0) return seg;
    const contHeader = `📊 *Расходы за ${monthName(month)} ${year}* _(продолжение ${idx + 1}/${total})_`;
    return seg.replace(PLACEHOLDER, contHeader);
  });
}

