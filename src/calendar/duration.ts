/**
 * chrono-node doesn't understand Russian duration suffixes ("на полчаса", "на 2 часа",
 * "1 час 30 минут"), so without this the event silently falls back to a 1-hour default.
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
  {
    re: /(?:на\s+)?(\d+)\s*час(?:а|ов)?\s*(?:и\s+)?(\d+)\s*мин(?:ут[аыу]?)?(?![а-яё])/i,
    ms: (m) => Number(m[1]) * HOUR_MS + Number(m[2]) * MIN_MS,
  },
  {
    re: /(?:на\s+)?пол(?:тора|торы)\s+час(?:а)?(?![а-яё])/i,
    ms: () => 1.5 * HOUR_MS,
  },
  {
    re: /(?:на\s+)?пол\s?часа(?![а-яё])/i,
    ms: () => 0.5 * HOUR_MS,
  },
  {
    re: /(?:на\s+)?(один|одна|два|две|три|четыре|пять|шесть)\s+час(?:а|ов)?(?![а-яё])/i,
    ms: (m) => WORD_HOURS[m[1].toLowerCase()] * HOUR_MS,
  },
  {
    re: /(?:на\s+)?(\d+)\s*час(?:а|ов)?(?![а-яё])/i,
    ms: (m) => Number(m[1]) * HOUR_MS,
  },
  {
    re: /(?:на\s+)?(\d+)\s*мин(?:ут[аыу]?)?(?![а-яё])/i,
    ms: (m) => Number(m[1]) * MIN_MS,
  },
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
