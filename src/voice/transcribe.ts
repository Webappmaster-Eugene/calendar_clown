/**
 * Transcribe audio file to text using OpenRouter (model with audio input).
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TRANSCRIBE_MODEL = "openai/gpt-audio-mini";

export async function transcribeVoice(filePath: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const { readFile } = await import("fs/promises");
  const fileBuffer = await readFile(filePath);
  const base64Audio = fileBuffer.toString("base64");

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/telegram-google-calendar-bot",
    },
    body: JSON.stringify({
      model: TRANSCRIBE_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe this audio to text. Output only the transcribed text in the same language, nothing else.",
            },
            {
              type: "input_audio",
              input_audio: {
                data: base64Audio,
                format: "ogg",
              },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter transcription failed: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
  return text;
}
