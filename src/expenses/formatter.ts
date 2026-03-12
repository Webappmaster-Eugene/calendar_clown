import type { CategoryTotal, MonthComparison, UserTotal } from "./types.js";

const TIMEZONE = "Europe/Moscow";

const RU_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const RU_MONTHS_GENITIVE = [
  "Января", "Февраля", "Марта", "Апреля", "Мая", "Июня",
  "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря",
];

export function monthName(month: number): string {
  return RU_MONTHS[month - 1] ?? `Месяц ${month}`;
}

export function monthNameGenitive(month: number): string {
  return RU_MONTHS_GENITIVE[month - 1] ?? `Месяц ${month}`;
}

export function formatMoney(amount: number): string {
  return Math.round(amount).toLocaleString("ru-RU") + " ₽";
}

export function formatMoneyShort(amount: number): string {
  return Math.round(amount).toLocaleString("ru-RU");
}

export function formatMonthReport(
  totals: CategoryTotal[],
  grandTotal: number,
  monthLimit: number,
  year: number,
  month: number,
  tribeName: string
): string {
  const header = `📊 *Расходы за ${monthName(month)} ${year}*\nТрайб: ${tribeName}`;
  const separator = "━━━━━━━━━━━━━━━━━━━━━━━";

  if (totals.length === 0) {
    return `${header}\n${separator}\nЗа этот период расходов нет.`;
  }

  const lines = totals.map((t) => {
    const name = truncate(t.categoryName, 22);
    return `${t.categoryEmoji} ${name}  ${formatMoney(t.total)}`;
  });

  const limitPercent = monthLimit > 0 ? ((grandTotal / monthLimit) * 100).toFixed(1) : "0";
  const limitIcon = grandTotal >= monthLimit ? "🚨" : grandTotal >= monthLimit * 0.9 ? "⚠️" : "✅";

  return [
    header,
    separator,
    ...lines,
    separator,
    `💰 *Итого:* ${formatMoney(grandTotal)}`,
    monthLimit > 0 ? `📊 *Лимит:* ${formatMoney(monthLimit)} (${limitPercent}%) ${limitIcon}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatComparisonReport(
  comparisons: MonthComparison[],
  year1: number,
  month1: number,
  year2: number,
  month2: number
): string {
  const m1 = monthName(month1);
  const m2 = monthName(month2);
  const header = `📈 *Сравнение: ${m1} → ${m2} ${year2}*`;
  const separator = "━━━━━━━━━━━━━━━━━━━━━━━";

  if (comparisons.length === 0) {
    return `${header}\n${separator}\nНет данных для сравнения.`;
  }

  const lines = comparisons.map((c) => {
    const arrow = c.diff > 0 ? "↗️" : c.diff < 0 ? "↘️" : "➡️";
    const diffStr = c.diff > 0 ? `+${formatMoneyShort(c.diff)}` : formatMoneyShort(c.diff);
    return `${c.categoryEmoji} ${truncate(c.categoryName, 16)}  ${formatMoneyShort(c.prevTotal)} → ${formatMoneyShort(c.currTotal)}  ${arrow} ${diffStr}`;
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
    timeZone: TIMEZONE,
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

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 1) + "…";
}
