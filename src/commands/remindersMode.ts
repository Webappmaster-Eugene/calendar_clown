/**
 * Reminders mode command handler.
 * Flexible recurring reminders with schedule, tribe view, and subscriptions.
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { ensureUser, getUserByTelegramId, listTribeUsers } from "../expenses/repository.js";
import { isBootstrapAdmin, getUserMenuContext } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import {
  createReminder,
  getRemindersByUser,
  getReminderById,
  countActiveReminders,
  deleteReminder,
  toggleReminderActive,
  updateReminderText,
  updateReminderSchedule,
  updateReminderSound,
  getTribeReminders,
  getTribeUserReminders,
  addSubscriber,
  removeSubscriber,
  getSubscribers,
  isSubscribed,
} from "../reminders/repository.js";
import { getAvailableSounds, getSoundById } from "../reminders/soundRepository.js";
import type { ReminderSchedule, PendingReminderState } from "../reminders/types.js";
import {
  formatScheduleDescription,
  formatEndDate,
  validateSchedule,
} from "../reminders/service.js";
import { extractReminderIntent } from "../voice/extractReminderIntent.js";
import { MAX_REMINDERS_PER_USER } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import { escapeMarkdown } from "../utils/markdown.js";
import { truncateText } from "../utils/uiKit.js";

const log = createLogger("reminders-mode");

// ─── State ──────────────────────────────────────────────────────────────

/** In-memory creation wizard states (telegramId → state). */
const wizardStates = new Map<number, PendingReminderState>();

/** In-memory edit states (telegramId → { reminderId, field }). */
const editStates = new Map<number, { reminderId: number; field: "text" | "times" | "weekdays" | "endDate" }>();

// ─── Keyboard ───────────────────────────────────────────────────────────

function getRemindersKeyboard(isAdmin: boolean, hasTribe: boolean) {
  const rows: string[][] = [
    ["📋 Мои напоминания", "➕ Новое напоминание"],
  ];
  if (hasTribe) {
    rows.push(["👀 Напоминания семьи"]);
  }
  rows.push(...getModeButtons(isAdmin));
  return Markup.keyboard(rows).resize();
}

// ─── Main Command ───────────────────────────────────────────────────────

export async function handleRemindersCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⏰ Напоминания недоступны (нет подключения к базе данных).");
    return;
  }

  const dbUser = await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  await setUserMode(telegramId, "reminders");
  await setModeMenuCommands(ctx, "reminders");

  // Clear any pending states
  wizardStates.delete(telegramId);
  editStates.delete(telegramId);

  const isAdmin = isBootstrapAdmin(telegramId);
  const hasTribe = dbUser.tribeId != null;

  await ctx.reply(
    "⏰ *Режим Напоминатор активирован*\n\n" +
    "Создавайте гибкие напоминания с расписанием.\n" +
    "Текстом или голосом — бот пришлёт в нужное время.",
    { parse_mode: "Markdown", ...getRemindersKeyboard(isAdmin, hasTribe) }
  );
}

// ─── My Reminders ───────────────────────────────────────────────────────

export async function handleMyRemindersButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  const reminders = await getRemindersByUser(dbUser.id);

  if (reminders.length === 0) {
    await ctx.reply(
      "⏰ У вас пока нет напоминаний.\nНажмите «➕ Новое напоминание» чтобы создать."
    );
    return;
  }

  const buttons = reminders.map((r) => {
    const status = r.isActive ? "⏰" : "⏸";
    const schedDesc = formatScheduleDescription(r.schedule);
    const label = `${status} ${truncateText(r.text, 25)}`;
    return [Markup.button.callback(label, `rem_view:${r.id}`)];
  });

  await ctx.reply(`⏰ *Мои напоминания (${reminders.length}):*`, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
}

// ─── New Reminder (wizard start) ────────────────────────────────────────

export async function handleNewReminderButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  const count = await countActiveReminders(dbUser.id);
  if (count >= MAX_REMINDERS_PER_USER) {
    await ctx.reply(`⏰ Максимум ${MAX_REMINDERS_PER_USER} активных напоминаний. Удалите одно, чтобы создать новое.`);
    return;
  }

  wizardStates.set(telegramId, { step: "awaiting_text", inputMethod: "text" });
  editStates.delete(telegramId);

  await ctx.reply("⏰ Введите текст напоминания (что напомнить):");
}

// ─── Tribe Reminders ────────────────────────────────────────────────────

export async function handleTribeRemindersButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser || !dbUser.tribeId) {
    await ctx.reply("Вы не состоите в трайбе.");
    return;
  }

  const tribeMembers = await listTribeUsers(dbUser.tribeId);
  const otherMembers = tribeMembers.filter((m) => m.id !== dbUser.id);

  if (otherMembers.length === 0) {
    await ctx.reply("В вашем трайбе пока нет других участников.");
    return;
  }

  const buttons = otherMembers.map((m) => [
    Markup.button.callback(`👤 ${m.firstName}`, `rem_tribe_user:${m.id}`),
  ]);

  await ctx.reply("👀 *Выберите участника:*", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
}

// ─── Callback Handlers ──────────────────────────────────────────────────

export async function handleReminderViewCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  // rem_view:<id> — show reminder details
  if (data.startsWith("rem_view:")) {
    const reminderId = parseInt(data.split(":")[1], 10);
    await showReminder(ctx, reminderId, dbUser.id);
    return;
  }
}

export async function handleReminderActionCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  // rem_pause:<id> — toggle active
  if (data.startsWith("rem_pause:")) {
    const reminderId = parseInt(data.split(":")[1], 10);
    const updated = await toggleReminderActive(reminderId, dbUser.id);
    if (updated) {
      logAction(dbUser.id, telegramId, "reminder_toggle", {
        reminderId,
        isActive: updated.isActive,
      });
      await showReminder(ctx, reminderId, dbUser.id);
    }
    return;
  }

  // rem_del:<id> — delete
  if (data.startsWith("rem_del:")) {
    const reminderId = parseInt(data.split(":")[1], 10);
    const deleted = await deleteReminder(reminderId, dbUser.id);
    if (deleted) {
      logAction(dbUser.id, telegramId, "reminder_delete", { reminderId });
      await ctx.editMessageText("🗑 Напоминание удалено.");
    } else {
      await ctx.editMessageText("Не удалось удалить напоминание.");
    }
    return;
  }

  // rem_confirm:<telegramId> — confirm creation
  if (data.startsWith("rem_confirm:")) {
    const targetTelegramId = parseInt(data.split(":")[1], 10);
    if (targetTelegramId !== telegramId) return;
    await confirmCreateReminder(ctx, telegramId);
    return;
  }

  // rem_cancel_create:<telegramId> — cancel creation
  if (data.startsWith("rem_cancel_create:")) {
    const targetTelegramId = parseInt(data.split(":")[1], 10);
    if (targetTelegramId !== telegramId) return;
    wizardStates.delete(telegramId);
    await ctx.editMessageText("❌ Создание напоминания отменено.");
    return;
  }
}

export async function handleReminderEditCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  // rem_edit:<id> — show edit submenu
  if (data.startsWith("rem_edit:")) {
    const reminderId = parseInt(data.split(":")[1], 10);
    const reminder = await getReminderById(reminderId);
    if (!reminder || reminder.userId !== dbUser.id) return;

    await ctx.editMessageText(
      `✏️ *Редактирование напоминания*\n\n⏰ ${escapeMarkdown(reminder.text)}\n📅 ${formatScheduleDescription(reminder.schedule)}\n📆 До: ${formatEndDate(reminder.schedule.endDate)}\n\nЧто изменить?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✏️ Текст", `rem_edit_text:${reminderId}`),
            Markup.button.callback("⏰ Время", `rem_edit_times:${reminderId}`),
          ],
          [
            Markup.button.callback("📅 Дни", `rem_edit_days:${reminderId}`),
            Markup.button.callback("📆 Срок", `rem_edit_end:${reminderId}`),
          ],
          [
            Markup.button.callback("🔊 Звук", `rem_edit_sound:${reminderId}`),
          ],
          [Markup.button.callback("◀️ Назад", `rem_view:${reminderId}`)],
        ]),
      }
    );
    return;
  }

  // rem_edit_text:<id>, rem_edit_times:<id>, rem_edit_days:<id>, rem_edit_end:<id>
  const editActions: Record<string, "text" | "times" | "weekdays" | "endDate"> = {
    "rem_edit_text:": "text",
    "rem_edit_times:": "times",
    "rem_edit_days:": "weekdays",
    "rem_edit_end:": "endDate",
  };

  for (const [prefix, field] of Object.entries(editActions)) {
    if (data.startsWith(prefix)) {
      const reminderId = parseInt(data.split(":")[1], 10);
      editStates.set(telegramId, { reminderId, field });
      wizardStates.delete(telegramId);

      const prompts: Record<string, string> = {
        text: "Введите новый текст напоминания:",
        times: "Введите новое время (через запятую, формат HH:MM):\nНапример: 10:00, 13:35, 18:30",
        weekdays: "Введите дни недели (числами через запятую, 1=Пн..7=Вс):\nНапример: 1,2,3,4,5 (будни)",
        endDate: "Введите дату окончания (ГГГГ-ММ-ДД) или «нет» для бессрочного:",
      };

      await ctx.editMessageText(prompts[field]);
      return;
    }
  }
}

export async function handleReminderTribeCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser || !dbUser.tribeId) return;

  // rem_tribe_user:<userId> — show user's reminders
  if (data.startsWith("rem_tribe_user:")) {
    const targetUserId = parseInt(data.split(":")[1], 10);
    const reminders = await getTribeUserReminders(targetUserId);

    if (reminders.length === 0) {
      await ctx.editMessageText("У этого участника нет активных напоминаний.");
      return;
    }

    const buttons = reminders.map((r) => {
      const label = `⏰ ${truncateText(r.text, 30)}`;
      return [Markup.button.callback(label, `rem_tribe_view:${r.id}`)];
    });

    await ctx.editMessageText(`⏰ *Напоминания участника (${reminders.length}):*`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
    return;
  }

  // rem_tribe_view:<reminderId> — view tribe member's reminder (with subscribe option)
  if (data.startsWith("rem_tribe_view:")) {
    const reminderId = parseInt(data.split(":")[1], 10);
    const reminder = await getReminderById(reminderId);
    if (!reminder) {
      await ctx.editMessageText("Напоминание не найдено.");
      return;
    }

    const schedDesc = formatScheduleDescription(reminder.schedule);
    const endDateDesc = formatEndDate(reminder.schedule.endDate);
    const subscribed = await isSubscribed(reminderId, dbUser.id);

    const subButton = subscribed
      ? Markup.button.callback("🔕 Отписаться", `rem_unsub:${reminderId}`)
      : Markup.button.callback("🔔 Подписаться", `rem_sub:${reminderId}`);

    await ctx.editMessageText(
      `⏰ *${escapeMarkdown(reminder.text)}*\n\n📅 ${schedDesc}\n📆 До: ${endDateDesc}`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([[subButton]]),
      }
    );
    return;
  }

  // rem_sub:<reminderId> — subscribe
  if (data.startsWith("rem_sub:")) {
    const reminderId = parseInt(data.split(":")[1], 10);
    await addSubscriber(reminderId, dbUser.id);
    logAction(dbUser.id, telegramId, "reminder_subscribe", { reminderId });

    const reminder = await getReminderById(reminderId);
    if (reminder) {
      const schedDesc = formatScheduleDescription(reminder.schedule);
      const endDateDesc = formatEndDate(reminder.schedule.endDate);
      await ctx.editMessageText(
        `✅ Вы подписались на напоминание\n\n⏰ *${escapeMarkdown(reminder.text)}*\n📅 ${schedDesc}\n📆 До: ${endDateDesc}`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🔕 Отписаться", `rem_unsub:${reminderId}`)],
          ]),
        }
      );
    }
    return;
  }

  // rem_unsub:<reminderId> — unsubscribe
  if (data.startsWith("rem_unsub:")) {
    const reminderId = parseInt(data.split(":")[1], 10);
    await removeSubscriber(reminderId, dbUser.id);
    logAction(dbUser.id, telegramId, "reminder_unsubscribe", { reminderId });

    const reminder = await getReminderById(reminderId);
    if (reminder) {
      const schedDesc = formatScheduleDescription(reminder.schedule);
      const endDateDesc = formatEndDate(reminder.schedule.endDate);
      await ctx.editMessageText(
        `🔕 Вы отписались от напоминания\n\n⏰ *${escapeMarkdown(reminder.text)}*\n📅 ${schedDesc}\n📆 До: ${endDateDesc}`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🔔 Подписаться", `rem_sub:${reminderId}`)],
          ]),
        }
      );
    }
    return;
  }
}

// ─── Sound Callbacks ───────────────────────────────────────────────────

export async function handleReminderSoundCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  // rem_sound_pick:<telegramId> — show sound list during creation wizard
  if (data.startsWith("rem_sound_pick:")) {
    const targetId = parseInt(data.split(":")[1], 10);
    if (targetId !== telegramId) return;

    const state = wizardStates.get(telegramId);
    if (!state || state.step !== "confirming") return;

    const sounds = await getAvailableSounds();
    if (sounds.length === 0) {
      await ctx.editMessageText("Нет доступных звуков. Создаём без звука...");
      return;
    }

    const buttons = sounds.map((s) => [
      Markup.button.callback(`${s.emoji} ${s.name}`, `rem_sound_set:${s.id}`),
    ]);
    buttons.push([Markup.button.callback("🔕 Без звука", `rem_sound_none:${telegramId}`)]);

    await ctx.editMessageText("🔊 *Выберите звук для напоминания:*\n\nЗвук будет воспроизводиться в Mini App.", {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
    return;
  }

  // rem_sound_set:<soundId> — select sound during wizard
  if (data.startsWith("rem_sound_set:")) {
    const soundId = parseInt(data.split(":")[1], 10);
    const state = wizardStates.get(telegramId);
    if (!state || !state.text || !state.schedule) return;

    const sound = await getSoundById(soundId);
    if (!sound) return;

    state.soundId = soundId;
    state.soundEnabled = true;
    state.step = "confirming";
    wizardStates.set(telegramId, state);

    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await showConfirmation(ctx, telegramId, state.text, state.schedule, `${sound.emoji} ${sound.name}`);
    return;
  }

  // rem_sound_none:<telegramId> — no sound during wizard
  if (data.startsWith("rem_sound_none:")) {
    const targetId = parseInt(data.split(":")[1], 10);
    if (targetId !== telegramId) return;

    const state = wizardStates.get(telegramId);
    if (!state || !state.text || !state.schedule) return;

    state.soundId = undefined;
    state.soundEnabled = false;
    state.step = "confirming";
    wizardStates.set(telegramId, state);

    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await showConfirmation(ctx, telegramId, state.text, state.schedule);
    return;
  }

  // rem_edit_sound:<reminderId> — show sound list for editing existing reminder
  if (data.startsWith("rem_edit_sound:")) {
    const reminderId = parseInt(data.split(":")[1], 10);
    const reminder = await getReminderById(reminderId);
    if (!reminder || reminder.userId !== dbUser.id) return;

    const sounds = await getAvailableSounds();
    if (sounds.length === 0) {
      await ctx.editMessageText("Нет доступных звуков.");
      return;
    }

    const buttons = sounds.map((s) => {
      const selected = reminder.soundEnabled && reminder.soundId === s.id ? " ✓" : "";
      return [Markup.button.callback(`${s.emoji} ${s.name}${selected}`, `rem_set_sound:${reminderId}:${s.id}`)];
    });
    buttons.push([Markup.button.callback("🔕 Без звука", `rem_set_sound:${reminderId}:0`)]);
    buttons.push([Markup.button.callback("◀️ Назад", `rem_edit:${reminderId}`)]);

    await ctx.editMessageText("🔊 *Выберите звук:*\n\nЗвук воспроизводится в Mini App при срабатывании.", {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
    return;
  }

  // rem_set_sound:<reminderId>:<soundId> — set/remove sound on existing reminder
  if (data.startsWith("rem_set_sound:")) {
    const parts = data.split(":");
    const reminderId = parseInt(parts[1], 10);
    const soundId = parseInt(parts[2], 10);

    if (soundId === 0) {
      // Remove sound
      await updateReminderSound(reminderId, dbUser.id, null, false);
      logAction(dbUser.id, telegramId, "reminder_edit", { reminderId, field: "sound", soundId: null });
    } else {
      // Set sound
      await updateReminderSound(reminderId, dbUser.id, soundId, true);
      logAction(dbUser.id, telegramId, "reminder_edit", { reminderId, field: "sound", soundId });
    }

    await showReminder(ctx, reminderId, dbUser.id);
    return;
  }
}

// ─── Text Handler ───────────────────────────────────────────────────────

/** Handle text input in reminders mode. Returns true if consumed. */
export async function handleRemindersText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;
  const text = ctx.message.text;

  // Edit state — handle field editing
  const edit = editStates.get(telegramId);
  if (edit) {
    return await handleEditInput(ctx, telegramId, edit, text);
  }

  // Creation wizard
  const state = wizardStates.get(telegramId);
  if (!state) return false;

  if (state.step === "awaiting_text") {
    const reminderText = text.trim();
    if (reminderText.length === 0 || reminderText.length > 500) {
      await ctx.reply("Текст напоминания должен быть от 1 до 500 символов.");
      return true;
    }

    state.text = reminderText;
    state.step = "awaiting_schedule";
    wizardStates.set(telegramId, state);

    await ctx.reply(
      "📅 Теперь опишите расписание.\n\n" +
      "Например:\n" +
      "• «каждый день в 10:00 и 18:30»\n" +
      "• «по будням в 9:00 до августа 2026»\n" +
      "• «каждую пятницу в 17:00»\n\n" +
      "Или отправьте голосовое сообщение с полным описанием."
    );
    return true;
  }

  if (state.step === "awaiting_schedule") {
    // Use DeepSeek to parse the schedule from NL
    const fullText = `напомни ${state.text}. ${text}`;
    try {
      const intent = await extractReminderIntent(fullText);
      if (intent.type !== "create_reminder") {
        await ctx.reply("Не удалось разобрать расписание. Попробуйте описать иначе, например: «каждый день в 10:00».");
        return true;
      }

      const validationError = validateSchedule(intent.schedule);
      if (validationError) {
        await ctx.reply(`⚠️ ${validationError}`);
        return true;
      }

      state.schedule = intent.schedule;
      state.step = "confirming";
      wizardStates.set(telegramId, state);

      await showConfirmation(ctx, telegramId, state.text!, intent.schedule);
    } catch (err) {
      log.error("Failed to extract schedule:", err);
      await ctx.reply("Ошибка при разборе расписания. Попробуйте ещё раз.");
    }
    return true;
  }

  return false;
}

// ─── Voice Handler ──────────────────────────────────────────────────────

/** Handle voice transcript in reminders mode. */
export async function handleRemindersVoice(
  ctx: Context,
  transcript: string,
  statusMsgId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const safeTranscript = escapeMarkdown(truncateText(transcript, 300));

  try {
    // If in awaiting_schedule step, use transcript as schedule input
    const state = wizardStates.get(telegramId);
    if (state?.step === "awaiting_schedule" && state.text) {
      const fullText = `напомни ${state.text}. ${transcript}`;
      const intent = await extractReminderIntent(fullText);
      if (intent.type !== "create_reminder") {
        await ctx.telegram.editMessageText(
          ctx.chat!.id, statusMsgId, undefined,
          `🎤 "${safeTranscript}"\n\nНе удалось разобрать расписание. Попробуйте описать иначе.`
        );
        return;
      }

      const validationError = validateSchedule(intent.schedule);
      if (validationError) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id, statusMsgId, undefined,
          `🎤 "${safeTranscript}"\n\n⚠️ ${validationError}`
        );
        return;
      }

      state.schedule = intent.schedule;
      state.step = "confirming";
      wizardStates.set(telegramId, state);

      await ctx.telegram.deleteMessage(ctx.chat!.id, statusMsgId).catch(() => {});
      await showConfirmation(ctx, telegramId, state.text, intent.schedule);
      return;
    }

    // Full voice: extract everything in one shot
    const intent = await extractReminderIntent(transcript);

    if (intent.type === "list_reminders") {
      await ctx.telegram.deleteMessage(ctx.chat!.id, statusMsgId).catch(() => {});
      await handleMyRemindersButton(ctx);
      return;
    }

    if (intent.type === "delete_reminder") {
      const dbUser = await getUserByTelegramId(telegramId);
      if (!dbUser) return;

      const reminders = await getRemindersByUser(dbUser.id);
      const query = intent.query.toLowerCase();
      const matches = query
        ? reminders.filter((r) => r.text.toLowerCase().includes(query))
        : reminders;

      if (matches.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id, statusMsgId, undefined,
          `🎤 "${safeTranscript}"\n\nНапоминание не найдено.`
        );
        return;
      }

      if (matches.length === 1) {
        await deleteReminder(matches[0].id, dbUser.id);
        await ctx.telegram.editMessageText(
          ctx.chat!.id, statusMsgId, undefined,
          `🎤 "${safeTranscript}"\n\n🗑 Удалено напоминание: ${matches[0].text}`
        );
        return;
      }

      const listText = matches.slice(0, 5).map((r, i) =>
        `${i + 1}. ${r.text}`
      ).join("\n");
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsgId, undefined,
        `🎤 "${safeTranscript}"\n\nНайдено несколько напоминаний. Уточните:\n\n${listText}`
      );
      return;
    }

    if (intent.type === "create_reminder") {
      const dbUser = await getUserByTelegramId(telegramId);
      if (!dbUser) return;

      const count = await countActiveReminders(dbUser.id);
      if (count >= MAX_REMINDERS_PER_USER) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id, statusMsgId, undefined,
          `🎤 "${safeTranscript}"\n\n⏰ Максимум ${MAX_REMINDERS_PER_USER} активных напоминаний.`
        );
        return;
      }

      const validationError = validateSchedule(intent.schedule);
      if (validationError) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id, statusMsgId, undefined,
          `🎤 "${safeTranscript}"\n\n⚠️ ${validationError}`
        );
        return;
      }

      wizardStates.set(telegramId, {
        step: "confirming",
        text: intent.text,
        schedule: intent.schedule,
        inputMethod: "voice",
      });

      await ctx.telegram.deleteMessage(ctx.chat!.id, statusMsgId).catch(() => {});
      await showConfirmation(ctx, telegramId, intent.text, intent.schedule);
      return;
    }

    // unknown
    await ctx.telegram.editMessageText(
      ctx.chat!.id, statusMsgId, undefined,
      `🎤 "${safeTranscript}"\n\nНе удалось разобрать. Скажите что-то вроде: «напомни проверить почту каждый день в 10».`
    );
  } catch (err) {
    log.error("Error in reminders voice handler:", err);
    try {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsgId, undefined,
        "Ошибка при обработке голосового сообщения."
      );
    } catch { /* ignore */ }
  }
}

// ─── Private helpers ────────────────────────────────────────────────────

async function showConfirmation(
  ctx: Context,
  telegramId: number,
  text: string,
  schedule: ReminderSchedule,
  soundName?: string
): Promise<void> {
  const schedDesc = formatScheduleDescription(schedule);
  const endDateDesc = formatEndDate(schedule.endDate);
  const soundLine = soundName ? `\n🔊 Звук: ${soundName}` : "";

  await ctx.reply(
    `⏰ *Напоминание:* ${escapeMarkdown(text)}\n` +
    `📅 ${schedDesc}\n` +
    `📆 До: ${endDateDesc}` +
    soundLine + "\n\n" +
    `Всё верно?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Создать", `rem_confirm:${telegramId}`),
          Markup.button.callback("🔊 Звук", `rem_sound_pick:${telegramId}`),
        ],
        [
          Markup.button.callback("❌ Отмена", `rem_cancel_create:${telegramId}`),
        ],
      ]),
    }
  );
}

async function confirmCreateReminder(ctx: Context, telegramId: number): Promise<void> {
  const state = wizardStates.get(telegramId);
  if (!state || state.step !== "confirming" || !state.text || !state.schedule) {
    await ctx.editMessageText("Состояние создания потеряно. Начните заново.");
    wizardStates.delete(telegramId);
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.editMessageText("Пользователь не найден.");
    wizardStates.delete(telegramId);
    return;
  }

  try {
    const reminder = await createReminder(
      dbUser.id,
      dbUser.tribeId,
      state.text,
      state.schedule,
      state.inputMethod,
      state.soundId ?? null,
      state.soundEnabled ?? false
    );

    logAction(dbUser.id, telegramId, "reminder_create", {
      reminderId: reminder.id,
      text: state.text,
      inputMethod: state.inputMethod,
      soundEnabled: state.soundEnabled ?? false,
    });

    const schedDesc = formatScheduleDescription(state.schedule);
    const endDateDesc = formatEndDate(state.schedule.endDate);
    const soundLine = state.soundEnabled && state.soundId
      ? await getSoundById(state.soundId).then((s) => s ? `\n🔊 Звук: ${s.emoji} ${s.name}` : "")
      : "";

    await ctx.editMessageText(
      `✅ *Напоминание создано!*\n\n` +
      `⏰ ${escapeMarkdown(reminder.text)}\n` +
      `📅 ${schedDesc}\n` +
      `📆 До: ${endDateDesc}` +
      soundLine,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    log.error("Failed to create reminder:", err);
    await ctx.editMessageText("Ошибка при создании напоминания.");
  }

  wizardStates.delete(telegramId);
}

async function showReminder(ctx: Context, reminderId: number, userId: number): Promise<void> {
  const reminder = await getReminderById(reminderId);
  if (!reminder) {
    try { await ctx.editMessageText("Напоминание не найдено."); } catch { /* ok */ }
    return;
  }

  const isOwner = reminder.userId === userId;
  const schedDesc = formatScheduleDescription(reminder.schedule);
  const endDateDesc = formatEndDate(reminder.schedule.endDate);
  const statusIcon = reminder.isActive ? "✅ Активно" : "⏸ На паузе";

  const subscribers = await getSubscribers(reminderId);
  const subsText = subscribers.length > 0
    ? `\n👥 Подписчики: ${subscribers.map((s) => s.subscriberName ?? "?").join(", ")}`
    : "";

  let soundLine = "";
  if (reminder.soundEnabled && reminder.soundId) {
    const sound = await getSoundById(reminder.soundId);
    if (sound) soundLine = `\n🔊 Звук: ${sound.emoji} ${sound.name}`;
  }

  const text =
    `⏰ *${escapeMarkdown(reminder.text)}*\n\n` +
    `📅 ${schedDesc}\n` +
    `📆 До: ${endDateDesc}\n` +
    `Статус: ${statusIcon}\n` +
    `Способ: ${reminder.inputMethod === "voice" ? "🎤 голос" : "⌨️ текст"}` +
    soundLine +
    subsText;

  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

  if (isOwner) {
    buttons.push([
      Markup.button.callback("✏️ Редактировать", `rem_edit:${reminderId}`),
      Markup.button.callback(reminder.isActive ? "⏸ Пауза" : "▶️ Возобновить", `rem_pause:${reminderId}`),
    ]);
    buttons.push([
      Markup.button.callback("🗑 Удалить", `rem_del:${reminderId}`),
    ]);
  }

  try {
    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  }
}

async function handleEditInput(
  ctx: Context,
  telegramId: number,
  edit: { reminderId: number; field: string },
  text: string
): Promise<boolean> {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return true;

  const reminder = await getReminderById(edit.reminderId);
  if (!reminder || reminder.userId !== dbUser.id) {
    editStates.delete(telegramId);
    await ctx.reply("Напоминание не найдено.");
    return true;
  }

  try {
    if (edit.field === "text") {
      const newText = text.trim();
      if (newText.length === 0 || newText.length > 500) {
        await ctx.reply("Текст должен быть от 1 до 500 символов.");
        return true;
      }
      await updateReminderText(edit.reminderId, dbUser.id, newText);
      logAction(dbUser.id, telegramId, "reminder_edit", { reminderId: edit.reminderId, field: "text" });
      editStates.delete(telegramId);
      await ctx.reply(`✅ Текст обновлён: ${newText}`);
      return true;
    }

    if (edit.field === "times") {
      const times = text.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
      const normalized = times.map((t) => {
        const parts = t.split(":");
        if (parts.length === 2) {
          return parts[0].padStart(2, "0") + ":" + parts[1].padStart(2, "0");
        }
        return t;
      });

      const newSchedule: ReminderSchedule = { ...reminder.schedule, times: normalized };
      const error = validateSchedule(newSchedule);
      if (error) {
        await ctx.reply(`⚠️ ${error}`);
        return true;
      }

      await updateReminderSchedule(edit.reminderId, dbUser.id, newSchedule);
      logAction(dbUser.id, telegramId, "reminder_edit", { reminderId: edit.reminderId, field: "times" });
      editStates.delete(telegramId);
      await ctx.reply(`✅ Время обновлено: ${normalized.join(", ")}`);
      return true;
    }

    if (edit.field === "weekdays") {
      const days = text.split(/[,;\s]+/).map((d) => parseInt(d.trim(), 10)).filter((d) => !isNaN(d));

      const newSchedule: ReminderSchedule = { ...reminder.schedule, weekdays: days };
      const error = validateSchedule(newSchedule);
      if (error) {
        await ctx.reply(`⚠️ ${error}`);
        return true;
      }

      await updateReminderSchedule(edit.reminderId, dbUser.id, newSchedule);
      logAction(dbUser.id, telegramId, "reminder_edit", { reminderId: edit.reminderId, field: "weekdays" });
      editStates.delete(telegramId);
      await ctx.reply(`✅ Дни обновлены: ${formatScheduleDescription(newSchedule)}`);
      return true;
    }

    if (edit.field === "endDate") {
      const input = text.trim().toLowerCase();
      let endDate: string | null = null;

      if (input !== "нет" && input !== "no" && input !== "-") {
        endDate = input;
      }

      const newSchedule: ReminderSchedule = { ...reminder.schedule, endDate };
      const error = validateSchedule(newSchedule);
      if (error) {
        await ctx.reply(`⚠️ ${error}`);
        return true;
      }

      await updateReminderSchedule(edit.reminderId, dbUser.id, newSchedule);
      logAction(dbUser.id, telegramId, "reminder_edit", { reminderId: edit.reminderId, field: "endDate" });
      editStates.delete(telegramId);
      await ctx.reply(`✅ Срок обновлён: ${formatEndDate(endDate)}`);
      return true;
    }
  } catch (err) {
    log.error("Failed to update reminder:", err);
    await ctx.reply("Ошибка при обновлении напоминания.");
  }

  editStates.delete(telegramId);
  return true;
}
