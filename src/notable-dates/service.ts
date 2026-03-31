import type { NotableDate } from "./repository.js";

const MONTH_NAMES = [
  "", "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const DEFAULT_BIRTHDAY_GREETING = [
  "С днём рождения! 🎉🎂",
  "",
  "От всей души поздравляю с этим особенным днём! Пусть он станет началом самого светлого, насыщенного и счастливого года в твоей жизни.",
  "",
  "🏥 Здоровье — это фундамент, на котором строится всё остальное. Желаю крепкого, надёжного здоровья — и физического, и душевного. Пусть энергии хватает на всё: на работу и отдых, на заботу о близких и время для себя. Пусть каждое утро начинается с бодрости и хорошего самочувствия, а болезни обходят стороной тебя и всех, кто тебе дорог.",
  "",
  "👨‍👩‍👧‍👦 Семья — это главное богатство и самая надёжная опора. Пусть дома всегда царят тепло, взаимопонимание и настоящая любовь. Пусть дети растут здоровыми, счастливыми и уверенными в себе — радуют каждый день своими успехами, открытиями и искренними улыбками. Пусть между близкими людьми всегда будут доверие, поддержка и готовность прийти на помощь. Пусть семейные вечера наполняются смехом, а совместные воспоминания становятся самым ценным сокровищем.",
  "",
  "💰 Желаю финансовой стабильности и настоящего достатка. Пусть доходы растут, возможности расширяются, а материальные заботы отступают на задний план. Пусть хватает и на повседневные нужды, и на мечты — путешествия, образование детей, уютный дом и маленькие радости, которые делают жизнь ярче. Пусть труд приносит достойное вознаграждение, а финансовая подушка дарит спокойствие и уверенность в завтрашнем дне.",
  "",
  "🚀 Пусть каждый новый день приносит вдохновение, мотивацию и азарт к новым свершениям. Пусть цели покоряются одна за другой, проекты реализуются, а планы превращаются в реальность. Желаю смелости начинать новое, мудрости доводить начатое до конца и веры в свои силы — даже когда кажется, что задача невыполнима. Пусть профессиональный путь ведёт к признанию и самореализации.",
  "",
  "🌟 Пусть жизнь будет наполнена яркими событиями, интересными встречами и тёплыми моментами. Пусть рядом всегда будут верные друзья, с которыми можно разделить и радость, и трудности. Пусть увлечения приносят удовольствие, путешествия — новые впечатления, а тихие семейные вечера — покой и гармонию.",
  "",
  "☀️ Желаю душевного равновесия и внутренней гармонии. Пусть стрессы обходят стороной, а сложные периоды заканчиваются быстро и приносят ценный опыт. Пусть хватает времени на отдых и восстановление сил. Пусть каждый день дарит хотя бы один повод улыбнуться от души.",
  "",
  "С праздником! Пусть этот год станет по-настоящему особенным — полным любви, здоровья, достижений и счастья! 🥂✨",
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
