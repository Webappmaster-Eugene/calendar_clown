import { TIMEZONE_MSK } from "../constants.js";

export function getMskYmd(date: Date): { year: number; month: number; day: number } {
  const mskStr = date.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
  const [year, month, day] = mskStr.split("-").map(Number);
  return { year, month, day };
}

export function getMskNow(): { year: number; month: number; day: number } {
  return getMskYmd(new Date());
}

export function getMonthRange(year: number, month: number): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 1)),
  };
}

export function getMonthLimit(): number {
  const raw = process.env.MONTHLY_EXPENSE_LIMIT?.trim();
  if (!raw) return 350_000;
  const parsed = parseFloat(raw);
  return isNaN(parsed) ? 350_000 : parsed;
}

export function parseMskCalendarDate(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) {
    throw new Error("Некорректная дата. Ожидается YYYY-MM-DD.");
  }
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);

  // 09:00 UTC on the same calendar day equals 12:00 MSK (UTC+3, no DST).
  // Storing at noon MSK keeps UTC/MSK day boundaries consistent for filtering.
  const date = new Date(Date.UTC(year, month - 1, day, 9, 0, 0));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Несуществующая дата.");
  }

  const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (date.getTime() < now - FIVE_YEARS_MS) {
    throw new Error("Дата слишком давняя (более 5 лет назад).");
  }
  if (date.getTime() > now + ONE_DAY_MS) {
    throw new Error("Дата не может быть в будущем.");
  }
  return date;
}
