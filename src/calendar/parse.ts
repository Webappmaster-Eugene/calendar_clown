import * as chrono from "chrono-node";
import { parseRussianDuration } from "./duration.js";

const ru = (chrono as unknown as { ru: typeof chrono }).ru ?? chrono;

/** Reference for parsing: "10:00" means 10:00 MSK. */
function mskRef() {
  return { instant: new Date(), timezone: "MSK" as const };
}

export interface ParsedEvent {
  title: string;
  start: Date;
  end: Date;
}

/**
 * Parse natural language like "Встреча завтра в 15:00" or "Созвон в понедельник 10:00".
 * Uses chrono-node (Russian locale). Times are interpreted in Europe/Moscow (MSK).
 */
export function parseEventText(text: string): ParsedEvent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const parsed = ru.parse(trimmed, mskRef(), { forwardDate: true });
  const first = parsed[0];
  if (!first) return null;

  const start = first.date();
  let title = first.text ? trimmed.replace(first.text, "").trim() : trimmed;

  let end: Date;
  if (first.end) {
    end = first.end.date();
  } else {
    // chrono ignores duration suffixes ("на полчаса") — honour them here, else default 1h.
    const duration = parseRussianDuration(title);
    if (duration) {
      end = new Date(start.getTime() + duration.durationMs);
      title = title.replace(duration.matched, "").replace(/\s{2,}/g, " ").trim();
    } else {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }
  }

  const summary = title || "Встреча";

  return { title: summary, start, end };
}
