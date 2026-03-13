import { TIMEZONE_MSK } from "../constants.js";

/** Get current year and month in Moscow timezone. */
export function getMskNow(): { year: number; month: number } {
  const now = new Date();
  const mskStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
  const [year, month] = mskStr.split("-").map(Number);
  return { year, month };
}

/** Get Date range for a given month: [from, to). */
export function getMonthRange(year: number, month: number): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 1)),
  };
}

/** Get monthly expense limit from env. */
export function getMonthLimit(): number {
  const raw = process.env.MONTHLY_EXPENSE_LIMIT?.trim();
  if (!raw) return 350_000;
  const parsed = parseFloat(raw);
  return isNaN(parsed) ? 350_000 : parsed;
}
