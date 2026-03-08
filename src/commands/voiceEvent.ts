import type { Context } from "telegraf";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import { createEvent } from "../calendar/client.js";
import { transcribeVoice } from "../voice/transcribe.js";
import { extractCalendarEvent } from "../calendar/extractViaOpenRouter.js";

const VOICE_DIR = "./data/voice";

export async function handleVoice(ctx: Context) {
  const voice = "voice" in ctx.message ? ctx.message.voice : null;
  if (!voice?.file_id) return;

  const statusMsg = await ctx.reply("Обрабатываю голосовое…");

  let filePath: string | null = null;
  try {
    const link = await ctx.telegram.getFileLink(voice.file_id);
    const res = await fetch(link.toString());
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir(VOICE_DIR, { recursive: true });
    filePath = join(VOICE_DIR, `voice_${voice.file_unique_id}.ogg`);
    const { writeFile } = await import("fs/promises");
    await writeFile(filePath, buffer);
  } catch (e) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      "Не удалось скачать голосовое сообщение."
    );
    return;
  }

  try {
    const transcript = await transcribeVoice(filePath);
    await unlink(filePath).catch(() => {});
    filePath = null;

    if (!transcript) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        "Не удалось распознать речь."
      );
      return;
    }

    const extracted = await extractCalendarEvent(transcript);
    if (!extracted) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        'Не удалось понять событие из фразы. Попробуйте: «Встреча завтра в 15:00».'
      );
      return;
    }

    const event = await createEvent(
      extracted.title,
      extracted.start,
      extracted.end
    );
    const start = new Date(event.start);
    const end = new Date(event.end);
    const timeStr = start.toLocaleString("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
    });
    const endStr = end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const text =
      `✅ Создано: *${event.summary}*\n${timeStr} – ${endStr}` +
      (event.htmlLink ? `\n[Открыть в календаре](${event.htmlLink})` : "");

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      text,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    if (filePath) await unlink(filePath).catch(() => {});
    const msg = err instanceof Error ? err.message : "Ошибка";
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      `Ошибка: ${msg}`
    );
  }
}
