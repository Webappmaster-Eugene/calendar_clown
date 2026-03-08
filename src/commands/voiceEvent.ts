import type { Context } from "telegraf";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import { createEvent, NoCalendarLinkedError } from "../calendar/client.js";
import { extractCalendarEvent } from "../calendar/extractViaOpenRouter.js";
import { transcribeVoice } from "../voice/transcribe.js";
import { extractVoiceIntent } from "../voice/extractVoiceIntent.js";
import { isAdmin } from "../admin.js";
import { getChatIdByRecipient } from "../userChats.js";

const VOICE_DIR = "./data/voice";

function getUserId(ctx: Context): string | null {
  const id = ctx.from?.id ?? ctx.chat?.id;
  return id != null ? String(id) : null;
}

export async function handleVoice(ctx: Context) {
  const userId = getUserId(ctx);
  if (!userId) return;

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

    const intent = await extractVoiceIntent(transcript);

    if (intent.type === "send_message") {
      if (!isAdmin(ctx)) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          "Отправка сообщений по голосу доступна только доверенным пользователям."
        );
        return;
      }
      const chatId = await getChatIdByRecipient(intent.recipient);
      if (chatId == null) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          "Пользователь не найден или ещё не писал боту. Отправка возможна только тем, кто уже начал диалог с ботом."
        );
        return;
      }
      await ctx.telegram.sendMessage(chatId, intent.text);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        `Сообщение отправлено (${intent.recipient}).`
      );
      return;
    }

    if (intent.type === "unknown") {
      const fallback = await extractCalendarEvent(transcript);
      if (fallback) {
        const event = await createEvent(
          fallback.title,
          fallback.start,
          fallback.end,
          userId
        );
        const start = new Date(event.start);
        const end = new Date(event.end);
        const timeZone = "Europe/Moscow";
        const timeStr = start.toLocaleString("ru-RU", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone,
        });
        const endStr = end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone });
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
        return;
      }
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        "Не удалось разобрать запись. Опишите встречу подробнее: с кем, о чём и когда (день и время). Например: «Запись к Роману на ремонт во вторник в 10 утра» или «Встреча завтра в 15:00»."
      );
      return;
    }

    const event = await createEvent(
      intent.title,
      intent.start,
      intent.end,
      userId
    );
    const start = new Date(event.start);
    const end = new Date(event.end);
    const timeZone = "Europe/Moscow";
    const timeStr = start.toLocaleString("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone,
    });
    const endStr = end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone });
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
    if (err instanceof NoCalendarLinkedError) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        err.message
      );
      return;
    }
    const msg = err instanceof Error ? err.message : "Ошибка";
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      `Ошибка: ${msg}`
    );
  }
}
