import type { NotableDate } from "./repository.js";

const MONTH_NAMES = [
  "", "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const DEFAULT_BIRTHDAY_GREETING = [
  "С днём рождения! 🎉",
  "",
  "От всей души желаю крепкого здоровья и неиссякаемой энергии — чтобы сил хватало на всё задуманное и ещё оставалось на радости жизни.",
  "",
  "Пусть семья будет надёжным тылом и главным источником тепла. Пусть дети радуют, близкие поддерживают, а дом всегда наполнен смехом и любовью.",
  "",
  "Желаю финансового благополучия и стабильности — чтобы возможности росли, а достаток позволял воплощать мечты в реальность.",
  "",
  "Пусть каждый новый день приносит вдохновение, мотивацию и азарт к новым свершениям. Пусть цели покоряются, планы сбываются, а впереди ждут только лучшие главы твоей истории.",
  "",
  "Гармонии, уверенности в завтрашнем дне и побольше поводов для искренней улыбки! 🥂",
].join("\n");

/** Format a notable date as a reminder message. */
export function formatNotableDateReminder(date: NotableDate): string {
  const lines: string[] = [];

  if (date.eventType === "birthday") {
    lines.push(`${date.emoji} День рождения: ${date.name}`);
  } else if (date.eventType === "holiday") {
    lines.push(`${date.emoji} ${date.name}`);
  } else {
    lines.push(`${date.emoji} ${date.name}`);
  }

  lines.push(`📅 ${date.dateDay} ${MONTH_NAMES[date.dateMonth]}`);

  if (date.description) {
    lines.push(`📝 ${date.description}`);
  }

  const greeting = date.greetingTemplate ?? (date.eventType === "birthday" ? DEFAULT_BIRTHDAY_GREETING : null);
  if (greeting) {
    lines.push(`💌 ${greeting}`);
  }

  return lines.join("\n");
}

/** Format multiple notable dates for a single day into a broadcast message. */
export function formatDayReminders(dates: NotableDate[]): string {
  if (dates.length === 0) return "";

  const today = new Date();
  const dayStr = `${today.getDate()} ${MONTH_NAMES[today.getMonth() + 1]}`;
  const header = `📆 *Знаменательные даты — ${dayStr}*\n`;

  const blocks = dates.map((d) => formatNotableDateReminder(d));
  return header + "\n" + blocks.join("\n\n");
}

/** Parse a text input like "Иванов Иван 15.03 Коллега" into notable date params. */
export function parseNotableDateInput(text: string): {
  name: string;
  dateMonth: number;
  dateDay: number;
  description: string | null;
} | null {
  // Try format: "Name DD.MM Description" or "Name DD.MM"
  const match = text.match(/^(.+?)\s+(\d{1,2})\.(\d{1,2})(?:\s+(.+))?$/);
  if (!match) return null;

  const name = match[1].trim();
  const day = parseInt(match[2], 10);
  const month = parseInt(match[3], 10);
  const description = match[4]?.trim() || null;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (!name) return null;

  return { name, dateMonth: month, dateDay: day, description };
}
