import * as chrono from "chrono-node";

const ru = (chrono as unknown as { ru: typeof chrono }).ru ?? chrono;

export interface ParsedEvent {
  title: string;
  start: Date;
  end: Date;
}

/**
 * Parse natural language like "Встреча завтра в 15:00" or "Созвон в понедельник 10:00".
 * Uses chrono-node (Russian locale when available).
 */
export function parseEventText(text: string): ParsedEvent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const parsed = ru.parse(trimmed, new Date(), { forwardDate: true });
  const first = parsed[0];
  if (!first) return null;

  const start = first.date();
  const end = first.end?.date() ?? new Date(start.getTime() + 60 * 60 * 1000);
  const title = first.text
    ? trimmed.replace(first.text, "").trim()
    : trimmed;
  const summary = title || "Встреча";

  return { title: summary, start, end };
}

/**
 * Parse only date/time from string (e.g. "завтра 15:00") — returns start date and optional end (default +1h).
 */
export function parseDateTime(text: string): { start: Date; end: Date } | null {
  const parsed = ru.parse(text, new Date(), { forwardDate: true });
  const first = parsed[0];
  if (!first) return null;
  const start = first.date();
  const end = first.end?.date() ?? new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}
