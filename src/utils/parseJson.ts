/** Strip markdown code fences and parse JSON. Returns null on failure. */
export function tryParseJson(raw: string): Record<string, unknown> | null {
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
