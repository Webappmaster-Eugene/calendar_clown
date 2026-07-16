/**
 * Extract an explicit meeting duration from a Russian phrase — "на полчаса",
 * "на 2 часа", "на 30 минут", "на полтора часа", "1 час 30 минут".
 *
 * chrono-node doesn't understand these duration suffixes, so without this the
 * event silently falls back to a 1-hour default. Returns the duration in ms and
 * the matched substring so the caller can strip it from the event title.
 */

export interface ParsedDuration {
  durationMs: number;
  /** Exact matched substring (original casing) — for removal from the title. */
  matched: string;
}

const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

const WORD_HOURS: Record<string, number> = {
  один: 1,
  одна: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
};

// `(?![а-яё])` marks a whole-word boundary — JS `\b` is ASCII-only and misfires on
// Cyrillic. Ordered most-specific-first so "1 час 30 минут" wins over "1 час".
const PATTERNS: Array<{ re: RegExp; ms: (m: RegExpMatchArray) => number }> = [
  // "1 час 30 минут", "2 часа 15 мин"
  {
    re: /(?:на\s+)?(\d+)\s*час(?:а|ов)?\s*(?:и\s+)?(\d+)\s*мин(?:ут[аыу]?)?(?![а-яё])/i,
    ms: (m) => Number(m[1]) * HOUR_MS + Number(m[2]) * MIN_MS,
  },
  // "полтора часа" / "полторы часа"
  {
    re: /(?:на\s+)?пол(?:тора|торы)\s+час(?:а)?(?![а-яё])/i,
    ms: () => 1.5 * HOUR_MS,
  },
  // "полчаса", "пол часа"
  {
    re: /(?:на\s+)?пол\s?часа(?![а-яё])/i,
    ms: () => 0.5 * HOUR_MS,
  },
  // "два часа", "три часа" (spelled-out number)
  {
    re: /(?:на\s+)?(один|одна|два|две|три|четыре|пять|шесть)\s+час(?:а|ов)?(?![а-яё])/i,
    ms: (m) => WORD_HOURS[m[1].toLowerCase()] * HOUR_MS,
  },
  // "2 часа", "5 часов", "1 час"
  {
    re: /(?:на\s+)?(\d+)\s*час(?:а|ов)?(?![а-яё])/i,
    ms: (m) => Number(m[1]) * HOUR_MS,
  },
  // "30 минут", "20 мин", "45 минуты"
  {
    re: /(?:на\s+)?(\d+)\s*мин(?:ут[аыу]?)?(?![а-яё])/i,
    ms: (m) => Number(m[1]) * MIN_MS,
  },
  // "на час" (bare word, no number)
  {
    re: /на\s+час(?![а-яё])/i,
    ms: () => HOUR_MS,
  },
];

export function parseRussianDuration(text: string): ParsedDuration | null {
  for (const { re, ms } of PATTERNS) {
    const m = text.match(re);
    if (m) {
      const durationMs = ms(m);
      if (durationMs > 0) return { durationMs, matched: m[0] };
    }
  }
  return null;
}
