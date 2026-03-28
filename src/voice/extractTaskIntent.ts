/**
 * Extract task data from voice transcript using OpenRouter (DeepSeek).
 * Used when bot is in tasks mode.
 */

import { DEEPSEEK_MODEL } from "../constants.js";
import { tryParseJson } from "../utils/parseJson.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import { TIMEZONE_MSK } from "../shared/constants.js";

function buildTaskSystemPrompt(workNames: string[], nowIso: string): string {
  const worksList = workNames.length > 0
    ? workNames.map((n) => `- ${n}`).join("\n")
    : "(нет проектов)";

  return `You are a task tracking assistant. Extract task information from the user's voice message (in Russian).
Reply with ONLY a valid JSON object, no other text.

Available projects/works (exact names):
${worksList}

Current date/time (Moscow): ${nowIso}

Output format:
{"type":"task","work":"exact work name from list above or null","text":"task description","deadline":"ISO 8601 datetime string or null"}

Rules:
- "work" MUST be one of the exact work names from the list above. If the user mentions a project name, match it (case-insensitive). If unclear or no match, set to null.
- "text" is the task description — what needs to be done.
- "deadline" must be an ISO 8601 datetime string with timezone offset +03:00 (Moscow). Parse Russian date/time expressions relative to the current date/time above.
  Examples of Russian date expressions:
  - "завтра в 18:00" → next day 18:00 MSK
  - "в понедельник" → next Monday 09:00 MSK (default time if not specified)
  - "через 3 дня к 15:00" → current date + 3 days at 15:00 MSK
  - "вторник 18:00" → next Tuesday 18:00 MSK
  - "послезавтра" → day after tomorrow 09:00 MSK
  If deadline cannot be parsed, set to null.
- If this is clearly NOT about creating a task, return {"type":"not_task"}

Examples:
- "Добавь задачу в 9RED сдать отчёт до завтра 18:00" → {"type":"task","work":"9RED","text":"сдать отчёт","deadline":"...T18:00:00+03:00"}
- "Росатом подготовить презентацию к понедельнику" → {"type":"task","work":"Росатом","text":"подготовить презентацию","deadline":"...T09:00:00+03:00"}
- "задача 9483 Росатом вторник 18:00" → {"type":"task","work":"Росатом","text":"задача 9483","deadline":"...T18:00:00+03:00"}`;
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
  // Format current time in MSK for the prompt
  const now = new Date();
  const nowMsk = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE_MSK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);

  const content = await callOpenRouter({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: buildTaskSystemPrompt(workNames, nowMsk) },
      { role: "user", content: transcript },
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

    // Validate work name against known list (case-insensitive)
    let matchedWork: string | null = null;
    if (work) {
      matchedWork = workNames.find(
        (wn) => wn.toLowerCase() === work.toLowerCase(),
      ) ?? null;
    }

    return { type: "task", work: matchedWork, text, deadline };
  }

  return { type: "not_task" };
}
