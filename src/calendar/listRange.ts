// The model's natural-language range comes back as untyped JSON — clamp and
// back-fill it so handlers always get a sane, bounded range.

const MAX_RANGE_DAYS = 31;
const MAX_LABEL_LEN = 40;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ListRange {
  /** Midnight MSK of the first day in the range. */
  from: Date;
  /** Number of whole days in the range (>= 1). */
  days: number;
  /** Short Russian header, e.g. "Сегодня", "Завтра", "Неделя". */
  label: string;
}

function mskMidnight(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00+03:00");
}

export function normalizeListRange(
  raw: { from?: unknown; days?: unknown; label?: unknown },
  todayMskStr: string,
  legacyType?: string,
): ListRange {
  const fromStr =
    typeof raw.from === "string" && ISO_DATE.test(raw.from.trim()) ? raw.from.trim() : todayMskStr;
  let from = mskMidnight(fromStr);
  if (Number.isNaN(from.getTime())) from = mskMidnight(todayMskStr);

  let days = typeof raw.days === "number" && Number.isFinite(raw.days) ? Math.floor(raw.days) : NaN;
  if (Number.isNaN(days)) days = legacyType === "list_week" ? 7 : 1;
  days = Math.min(Math.max(days, 1), MAX_RANGE_DAYS);

  let label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!label) label = legacyType === "list_week" ? "Неделя" : days > 1 ? `Ближайшие ${days} дн.` : "События";
  if (label.length > MAX_LABEL_LEN) label = label.slice(0, MAX_LABEL_LEN).trim();

  return { from, days, label };
}
