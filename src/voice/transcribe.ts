/**
 * Transcribe audio file to text using Groq Whisper API.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3";

export async function transcribeVoice(filePath: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const { readFile } = await import("fs/promises");
  const fileBuffer = await readFile(filePath);
  const blob = new Blob([fileBuffer], { type: "audio/ogg" });
  const formData = new FormData();
  formData.append("file", blob, "voice.ogg");
  formData.append("model", MODEL);

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq transcription failed: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as { text?: string };
  const text = data?.text?.trim() ?? "";
  return text;
}
