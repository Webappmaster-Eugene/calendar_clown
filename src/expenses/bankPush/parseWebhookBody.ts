/**
 * Parse a bank-push webhook body into {title, text}.
 *
 * The forwarder (MacroDroid) sends the JSON template {"title":"…","text":"…"}, but does
 * NOT JSON-escape the notification values — and Android notification text routinely
 * contains raw newlines and quotes, which make the body invalid JSON. So after a strict
 * parse we fall back to a template-anchored extraction (tolerant of newlines/quotes
 * inside the values) and, last, to plain text (first line = title, rest = text).
 */
export function parseBankWebhookBody(body: string): { title: string; text: string } {
  const trimmed = body.trim();

  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed) as { title?: unknown; text?: unknown };
      return {
        title: typeof json.title === "string" ? json.title : "",
        text: typeof json.text === "string" ? json.text : "",
      };
    } catch {
      // Anchor on the literal template separators so raw newlines/quotes inside the
      // values don't matter; title is non-greedy to stop at the first `","text":"`.
      const m = trimmed.match(
        /^\{\s*"title"\s*:\s*"([\s\S]*?)"\s*,\s*"text"\s*:\s*"([\s\S]*)"\s*\}$/
      );
      if (m) return { title: m[1].trim(), text: m[2].trim() };
    }
  }

  const nl = trimmed.indexOf("\n");
  if (nl === -1) return { title: "", text: trimmed };
  return { title: trimmed.slice(0, nl).trim(), text: trimmed.slice(nl + 1).trim() };
}
