/**
 * Single OpenRouter call: detect voice intent (calendar/cancel_event/unknown) and extract fields.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-chat-v3.1";
const TIMEZONE_MSK = "Europe/Moscow";

const WEEKDAY_TO_NUM: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/** Tomorrow's date (YYYY-MM-DD) in Moscow. */
function tomorrowDateStrInMSK(dateStr: string): string {
  const midnightMsk = new Date(dateStr + "T00:00:00+03:00");
  const tomorrowMsk = new Date(midnightMsk.getTime() + 24 * 60 * 60 * 1000);
  return tomorrowMsk.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
}

/** Next Tuesday's date (YYYY-MM-DD) in Moscow. Uses weekday in MSK, not server time. */
function nextTuesdayDateStrInMSK(dateStr: string): string {
  return nextWeekdayDateStrInMSK(dateStr, 2); // 2 = Tuesday
}

/** Next occurrence of weekday (0=Sun..6=Sat) in MSK. Returns YYYY-MM-DD. */
function nextWeekdayDateStrInMSK(dateStr: string, targetWeekdayNum: number): string {
  const midnightMsk = new Date(dateStr + "T00:00:00+03:00");
  const currentWeekdayNum = getWeekdayInMSK(midnightMsk);
  let daysUntil = (targetWeekdayNum - currentWeekdayNum + 7) % 7;
  if (daysUntil === 0) daysUntil = 7;
  const nextMsk = new Date(midnightMsk.getTime() + daysUntil * 24 * 60 * 60 * 1000);
  return nextMsk.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
}

/** Day of week (0=Sun..6=Sat) for the given date in Moscow. */
function getWeekdayInMSK(date: Date): number {
  const name = date.toLocaleDateString("en-GB", { weekday: "long", timeZone: TIMEZONE_MSK });
  return WEEKDAY_TO_NUM[name] ?? 0;
}

/** Russian weekday names to getDay() number (0=Sun..6=Sat). First match in transcript wins. */
const RU_WEEKDAY_MENTIONS: [RegExp, number][] = [
  [/понедельник/i, 1],
  [/вторник/i, 2],
  [/сред[ау]/i, 3],
  [/четверг/i, 4],
  [/пятниц/i, 5],
  [/суббот/i, 6],
  [/воскресень/i, 0],
];

function getMentionedWeekdayRu(transcript: string): number | null {
  const t = transcript.trim();
  for (const [re, num] of RU_WEEKDAY_MENTIONS) {
    if (re.test(t)) return num;
  }
  return null;
}

function buildSystemPrompt(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long", timeZone: TIMEZONE_MSK });
  const year = now.getFullYear();
  const tomorrowStr = tomorrowDateStrInMSK(dateStr);
  const tueStr = nextTuesdayDateStrInMSK(dateStr);

  return `Determine the user's intent from their message. Reply with ONLY a valid JSON object, no other text.

Options:

1) Creating a calendar meeting/event. Use type "calendar" for ANY phrase where the user asks to schedule, record, or create something AND mentions a date or time (explicit or from context). This includes:
   - Short: "встреча завтра в 15:00", "создай событие в понедельник в 10"
   - Rich context: "запиши меня к Роману на ремонт автомобиля во вторник в 10 утра", "встреча завтра, ремонт Романа автомобиль в 10 утра", "приём у врача в понедельник в 9"
   {"type":"calendar","title":"event title","start":"ISO8601","end":"ISO8601"} or with optional "recurrence":["RRULE:..."] for repeating events.
   title: short descriptive title for the calendar event, preserving who and what (e.g. "Ремонт автомобиля у Романа", "Запись к Роману: ремонт авто"). Do not reduce to a single word.
   Timezone: Europe/Moscow (UTC+3). Always use +03:00 in start/end (e.g. ${year}-03-09T10:00:00+03:00).
   Today is ${dateStr} (${weekday}). Use year ${year}. No date → today. No time → 10:00. Default duration 1 hour.
   Weekday-to-date (all in ${TIMEZONE_MSK}): вторник (Tuesday) = ${tueStr}, завтра (tomorrow) = ${tomorrowStr}.
   Recurring events: if the user says "каждую пятницу", "каждую неделю", "еженедельно", "по понедельникам" etc., add "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=XX"] where XX is MO,TU,WE,TH,FR,SA,SU (one or comma-separated). Set start/end to the first occurrence (e.g. next Friday 17:30).
   Examples:
   - "Запиши меня к Роману на ремонт автомобиля во вторник в 10 утра" → {"type":"calendar","title":"Ремонт автомобиля у Романа","start":"${tueStr}T10:00:00+03:00","end":"${tueStr}T11:00:00+03:00"}
   - "Встреча завтра, ремонт Романа автомобиль в 10 утра" → {"type":"calendar","title":"Ремонт автомобиля у Романа","start":"${tomorrowStr}T10:00:00+03:00","end":"${tomorrowStr}T11:00:00+03:00"}
   - "Встреча завтра в 15:00" → {"type":"calendar","title":"Встреча","start":"${tomorrowStr}T15:00:00+03:00","end":"${tomorrowStr}T16:00:00+03:00"}
   - "запиши что каждую пятницу в 17:30 мы ходим на массаж" → {"type":"calendar","title":"Массаж всей семьёй","start":"<next Friday>T17:30:00+03:00","end":"<next Friday>T18:30:00+03:00","recurrence":["RRULE:FREQ=WEEKLY;BYDAY=FR"]}

2) Cancelling/deleting a calendar event (e.g. "отмени встречу с Романом завтра", "удали встречу в 15:00", "отмени запись к врачу на вторник", "убери встречу завтра"):
   {"type":"cancel_event","query":"search keywords","date":"YYYY-MM-DD or null"}
   query: keywords to search in event title (e.g. "Роман", "врач", "массаж"). Extract the most specific words from the user's phrase that identify the event. If user says just "отмени встречу завтра" without specifics, use empty string "".
   date: the target date in YYYY-MM-DD format (${TIMEZONE_MSK}), or null if no date mentioned. Use the same date rules: "завтра" = ${tomorrowStr}, "вторник" = ${tueStr}, "сегодня" = ${dateStr}, etc.
   Trigger words: отмени, удали, убери, отменить, удалить, убрать, cancel, delete, remove — applied to встреча, событие, запись, приём.

3) Listing today's events (e.g. "что сегодня", "встречи на сегодня", "расписание на сегодня", "какие встречи сегодня"):
   {"type":"list_today"}

4) Listing this week's events (e.g. "что на этой неделе", "встречи на неделю", "расписание на неделю", "какие планы на неделю"):
   {"type":"list_week"}

5) Broadcasting a message to all users (admin only). Trigger: "отправь всем", "напиши всем", "рассылка", "сообщение всем", "передай всем". Extract the message text to broadcast:
   {"type":"broadcast","message":"the message text to send to all users"}
   Example: "Отправь всем: завтра офис закрыт" → {"type":"broadcast","message":"Завтра офис закрыт"}
   Example: "Рассылка напоминание что в пятницу встреча в 10" → {"type":"broadcast","message":"Напоминание: в пятницу встреча в 10"}

6) Anything else or unclear:
   {"type":"unknown"}`;
}

export type VoiceIntent =
  | { type: "calendar"; title: string; start: Date; end: Date; recurrence?: string[] }
  | { type: "cancel_event"; query: string; date: Date | null }
  | { type: "list_today" }
  | { type: "list_week" }
  | { type: "broadcast"; message: string }
  | { type: "unknown" };

function tryParseJson(raw: string): Record<string, unknown> | null {
  const stripped = raw
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function extractVoiceIntent(transcript: string): Promise<VoiceIntent> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/telegram-google-calendar-bot",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: transcript },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter request failed: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) return { type: "unknown" };

  const json = tryParseJson(content);
  if (!json || typeof json.type !== "string") return { type: "unknown" };

  if (json.type === "list_today") {
    return { type: "list_today" };
  }

  if (json.type === "list_week") {
    return { type: "list_week" };
  }

  if (json.type === "broadcast") {
    const message = typeof json.message === "string" ? json.message.trim() : "";
    if (message) {
      return { type: "broadcast", message };
    }
    return { type: "unknown" };
  }

  if (json.type === "cancel_event") {
    const query = typeof json.query === "string" ? json.query.trim() : "";
    const dateStr = typeof json.date === "string" ? json.date.trim() : null;
    let date: Date | null = null;
    if (dateStr) {
      const parsed = new Date(dateStr + "T00:00:00+03:00");
      if (!Number.isNaN(parsed.getTime())) {
        date = parsed;
      }
    }
    return { type: "cancel_event", query, date };
  }

  if (json.type === "calendar") {
    const title = typeof json.title === "string" ? json.title.trim() : "";
    const startStr = typeof json.start === "string" ? json.start : "";
    const endStr = typeof json.end === "string" ? json.end : "";
    if (title && startStr && endStr) {
      const start = new Date(startStr);
      const end = new Date(endStr);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        let recurrence: string[] | undefined;
        if (Array.isArray(json.recurrence) && json.recurrence.every((r): r is string => typeof r === "string") && json.recurrence.length > 0) {
          recurrence = json.recurrence;
        }
        const intent: VoiceIntent = { type: "calendar", title, start, end, recurrence };
        return correctCalendarIntentWeekday(transcript, intent);
      }
    }
  }

  return { type: "unknown" };
}

/** If transcript mentions a weekday and LLM returned a different day in MSK, fix start/end to that weekday. */
function correctCalendarIntentWeekday(transcript: string, intent: VoiceIntent): VoiceIntent {
  if (intent.type !== "calendar") return intent;
  const mentioned = getMentionedWeekdayRu(transcript);
  if (mentioned === null) return intent;
  const startWeekday = getWeekdayInMSK(intent.start);
  if (startWeekday === mentioned) return intent;

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
  const correctDateStr = nextWeekdayDateStrInMSK(dateStr, mentioned);
  const timeOpt: Intl.DateTimeFormatOptions = { timeZone: TIMEZONE_MSK, hour12: false, hour: "2-digit", minute: "2-digit" };
  const timePart = intent.start.toLocaleTimeString("en-CA", timeOpt);
  const durationMs = intent.end.getTime() - intent.start.getTime();
  const newStart = new Date(correctDateStr + "T" + timePart + ":00+03:00");
  const newEnd = new Date(newStart.getTime() + durationMs);
  return { type: "calendar", title: intent.title, start: newStart, end: newEnd, recurrence: intent.recurrence };
}
