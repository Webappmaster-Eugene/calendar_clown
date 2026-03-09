import type { Context } from "telegraf";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import { hasToken } from "../calendar/auth.js";
import { createEvent, NoCalendarLinkedError } from "../calendar/client.js";
import { extractCalendarEvent } from "../calendar/extractViaOpenRouter.js";
import { transcribeVoice } from "../voice/transcribe.js";
import { extractVoiceIntent } from "../voice/extractVoiceIntent.js";
import { isAdmin } from "../admin.js";
import { getChatIdByRecipient } from "../userChats.js";
import { updateMessageTranscript } from "../db/client.js";
import { getMode, setMode } from "../chatMode.js";
import { sendChat } from "../openclaw/chat.js";
import * as sessions from "../openclaw/sessions.js";
import { getOpenClawSystemPrompt, formatOpenClawError } from "./openclawChat.js";

const VOICE_DIR = "./data/voice";

function getUserId(ctx: Context): string | null {
  const id = ctx.from?.id ?? ctx.chat?.id;
  return id != null ? String(id) : null;
}

function getChatId(ctx: Context): string | null {
  const id = ctx.chat?.id;
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

    const chatId = getChatId(ctx);
    const hasOpenClaw = Boolean(process.env.OPENCLAW_GATEWAY_TOKEN?.trim());
    if (hasOpenClaw && chatId && getMode(chatId) === "openclaw") {
      const linked = await hasToken(userId);
      if (!linked) {
        setMode(chatId, "calendar");
        sessions.clear(chatId);
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          "Режим OpenClaw доступен только после привязки календаря. Отправьте /start и войдите через Google."
        );
        return;
      }
      sessions.appendUser(chatId, transcript);
      const history = sessions.getOrCreate(chatId);
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: getOpenClawSystemPrompt() },
        ...history,
      ];
      await ctx.telegram.sendChatAction(ctx.chat!.id, "typing");
      try {
        const reply = await sendChat(messages);
        sessions.appendAssistant(chatId, reply);
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          reply || "—"
        );
      } catch (err) {
        sessions.clear(chatId);
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          formatOpenClawError(err) + " Режим чата сброшен."
        );
      }
      return;
    }

    if (chatId && getMode(chatId) === "send_message") {
      if (!isAdmin(ctx)) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          "Режим отправки сообщений доступен только доверенным пользователям."
        );
        return;
      }
      const intent = await extractVoiceIntent(transcript);
      if (intent.type === "send_message") {
        const recipientChatId = await getChatIdByRecipient(intent.recipient);
        if (recipientChatId == null) {
          await ctx.telegram.editMessageText(
            ctx.chat!.id,
            statusMsg.message_id,
            undefined,
            "Пользователь не найден или ещё не писал боту. Отправка возможна только тем, кто уже начал диалог с ботом."
          );
          return;
        }
        await ctx.telegram.sendMessage(recipientChatId, intent.text);
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          `Сообщение отправлено (${intent.recipient}).`
        );
        return;
      }
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        "В этом режиме только отправка сообщений. Скажите кому и что отправить (например: «Отправь Ивану что завтра встреча»)."
      );
      return;
    }

    const intent = await extractVoiceIntent(transcript);

    void updateMessageTranscript(
      ctx.chat!.id,
      ctx.message.message_id,
      transcript,
      intent.type
    ).catch((err) => console.error("updateMessageTranscript:", err));

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
          userId,
          undefined,
          fallback.recurrence
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
        const recurringHint = fallback.recurrence?.length ? " (еженедельно)" : "";
        const text =
          `✅ Создано: *${event.summary}*${recurringHint}\n${timeStr} – ${endStr}` +
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
      userId,
      undefined,
      intent.recurrence
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
    const recurringHint = intent.recurrence?.length ? " (еженедельно)" : "";
    const text =
      `✅ Создано: *${event.summary}*${recurringHint}\n${timeStr} – ${endStr}` +
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
