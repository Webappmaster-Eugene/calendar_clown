/**
 * Send chat messages to OpenClaw Gateway and return the assistant reply.
 */

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:18789";
const REQUEST_TIMEOUT_MS = 60_000;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function sendChat(
  messages: ChatMessage[]
): Promise<string> {
  const baseUrl = (process.env.OPENCLAW_GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(/\/$/, "");
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!token) {
    throw new Error("OPENCLAW_GATEWAY_TOKEN is not set");
  }

  const agentId = process.env.OPENCLAW_AGENT_ID?.trim() || "main";
  const url = `${baseUrl}/v1/chat/completions`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-openclaw-agent-id": agentId,
      },
      body: JSON.stringify({
        model: "openclaw",
        messages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenClaw request failed: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content?.trim();
    return content ?? "";
  } finally {
    clearTimeout(timeoutId);
  }
}
