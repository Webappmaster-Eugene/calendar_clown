/**
 * Transcribe audio file to text using OpenRouter (model with audio input).
 * OpenAI/gpt-audio-mini accepts only wav and mp3; Telegram sends OGG, so we convert OGG→WAV first.
 */

import { spawn } from "child_process";
import { readFile, unlink } from "fs/promises";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TRANSCRIBE_MODEL = "openai/gpt-audio-mini";

async function oggToWav(oggPath: string): Promise<string> {
  const wavPath = oggPath.replace(/\.ogg$/i, ".wav");
  await new Promise<void>((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-i", oggPath,
      "-acodec", "pcm_s16le",
      "-ar", "16000",
      "-ac", "1",
      wavPath,
    ], { stdio: "pipe" });
    let stderr = "";
    ff.stderr?.on("data", (c) => { stderr += c; });
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`))));
  });
  return wavPath;
}

export async function transcribeVoice(filePath: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const isOgg = filePath.toLowerCase().endsWith(".ogg");
  let wavPath: string | null = null;
  try {
    const pathToSend = isOgg ? await oggToWav(filePath) : filePath;
    if (isOgg) wavPath = pathToSend;
    const fileBuffer = await readFile(pathToSend);
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
                  format: "wav",
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
  } finally {
    if (wavPath) await unlink(wavPath).catch(() => {});
  }
}
