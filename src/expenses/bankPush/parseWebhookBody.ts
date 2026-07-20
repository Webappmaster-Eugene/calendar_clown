/**
 * The forwarder (MacroDroid) fills the JSON template {"title":"…","text":"…"} but does
 * NOT JSON-escape the values, and Android notification text routinely contains raw
 * newlines/quotes — so the body is often invalid JSON. Hence the fallback chain: strict
 * parse → template-anchored extraction → plain text (first line = title, rest = text).
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
