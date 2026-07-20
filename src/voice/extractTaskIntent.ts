import { DEEPSEEK_MODEL } from "../constants.js";
import { tryParseJson } from "../utils/parseJson.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import { TIMEZONE_MSK } from "../shared/constants.js";
import { INSTRUCTION_GUARD, wrapUserContent } from "./promptSafety.js";

function buildTaskSystemPrompt(workNames: string[], dateStr: string, weekday: string, tomorrowStr: string): string {
  const worksList = workNames.length > 0
    ? workNames.map((n) => `- ${n}`).join("\n")
    : "(нет проектов)";

  return `You are a task-tracking assistant. The user is in TASK-CREATION mode and is dictating (in Russian) a task to add. Extract it.
Reply with ONLY a valid JSON object, no other text.

Available projects/works (exact names):
${worksList}

Current date: ${dateStr} (${weekday}), timezone Europe/Moscow (UTC+3). Tomorrow = ${tomorrowStr}.

Output format:
{"type":"task","work":"exact work name from the list or null","text":"task description","deadline":"ISO 8601 datetime with +03:00 offset or null"}

Rules:
- Assume the message IS a task. Return {"type":"not_task"} ONLY if it is clearly a question, a command unrelated to adding a task, or unintelligible noise.
- "work": match the mentioned project to one from the list (case-insensitive, tolerate minor mishearings). If no project is mentioned or none plausibly matches, set null.
- "text": what needs to be done. Never empty for a task.
- "deadline": parse the Russian date/time relative to the current date above; always +03:00. A date without a time → 09:00. If no deadline is mentioned or it can't be parsed, set null.
  Examples: "завтра в 18:00" → ${tomorrowStr}T18:00:00+03:00; "в понедельник" → next Monday 09:00; "через 3 дня к 15:00" → +3 days 15:00; "к концу недели" → nearest upcoming Friday 18:00.

Examples:
- "Добавь в 9RED сдать отчёт до завтра 18:00" → {"type":"task","work":"9RED","text":"сдать отчёт","deadline":"${tomorrowStr}T18:00:00+03:00"}
- "Росатом подготовить презентацию к понедельнику" → {"type":"task","work":"Росатом","text":"подготовить презентацию","deadline":"<next Monday>T09:00:00+03:00"}
- "напомни позвонить маме" → {"type":"task","work":null,"text":"позвонить маме","deadline":null}`;
}

function normalizeWork(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`.,!?:;()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Conservative: exact (normalized) match, else a UNIQUE containment match
 * (guards against short fragments matching everything). Returns null when
 * ambiguous or unmatched, so the caller falls back to asking the user to pick.
 */
export function matchWorkName(candidate: string | null, workNames: string[]): string | null {
  if (!candidate) return null;
  const norm = normalizeWork(candidate);
  if (!norm) return null;

  const exact = workNames.find((w) => normalizeWork(w) === norm);
  if (exact) return exact;

  if (norm.length < 3) return null;
  const contained = workNames.filter((w) => {
    const nw = normalizeWork(w);
    return nw.length >= 3 && (nw.includes(norm) || norm.includes(nw));
  });
  return contained.length === 1 ? contained[0] : null;
}

export interface TaskVoiceResult {
  type: "task";
  work: string | null;
  text: string;
  deadline: string | null;
}

export interface NotTaskResult {
  type: "not_task";
}

export type TaskIntentResult = TaskVoiceResult | NotTaskResult;

export async function extractTaskIntent(
  transcript: string,
  workNames: string[],
): Promise<TaskIntentResult> {
  // Date context in MSK: today + weekday + tomorrow, so the model resolves
  // relative expressions ("в понедельник", "завтра") to the right calendar date.
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long", timeZone: TIMEZONE_MSK });
  const tomorrowStr = new Date(new Date(`${dateStr}T00:00:00+03:00`).getTime() + 86_400_000)
    .toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });

  const content = await callOpenRouter({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: `${buildTaskSystemPrompt(workNames, dateStr, weekday, tomorrowStr)}\n\n${INSTRUCTION_GUARD}` },
      { role: "user", content: wrapUserContent(transcript) },
    ],
  });
  if (!content) return { type: "not_task" };

  const json = tryParseJson(content);
  if (!json || typeof json.type !== "string") return { type: "not_task" };

  if (json.type === "not_task") {
    return { type: "not_task" };
  }

  if (json.type === "task") {
    const work = typeof json.work === "string" ? json.work.trim() || null : null;
    const text = typeof json.text === "string" ? json.text.trim() : "";
    const deadline = typeof json.deadline === "string" ? json.deadline.trim() || null : null;

    if (!text) return { type: "not_task" };

    return { type: "task", work: matchWorkName(work, workNames), text, deadline };
  }

  return { type: "not_task" };
}
