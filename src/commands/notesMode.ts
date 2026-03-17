/**
 * Notes mode command handler.
 * Provides note-taking with topics, importance/urgency flags, voice input.
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/expenseMode.js";
import { ensureUser, getUserByTelegramId } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import {
  createTopic,
  getTopicsByUser,
  deleteTopic,
  createNote,
  getNotesByUser,
  getNotesByTopic,
  getNotesByFlag,
  countNotesByUser,
  countNotesByFlag,
  deleteNote,
  toggleNoteFlag,
  toggleNoteVisibility,
  getNoteById,
  updateNote,
  getPublicNotesByTribe,
  countPublicNotesByTribe,
} from "../notes/repository.js";
import type { Note, NoteVisibility } from "../notes/repository.js";
import { createLogger } from "../utils/logger.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import { logAction } from "../logging/actionLogger.js";

const log = createLogger("notes-mode");

const NOTES_PAGE_SIZE = 5;

/** State for note creation flow. */
interface NoteCreationState {
  step: "topic" | "visibility" | "content";
  topicId: number | null;
  visibility: NoteVisibility;
}

const creationStates = new Map<number, NoteCreationState>();

/** State for topic creation. */
const topicCreationWaiting = new Set<number>();

function getNotesKeyboard(isAdmin: boolean, hasTribe: boolean = false) {
  const rows = [
    ["📝 Новая заметка", "📂 Мои рубрики"],
    ["⭐ Важное", "🔥 Срочное"],
    ["📋 Все заметки"],
  ];
  if (hasTribe) {
    rows.push(["🌐 Публичные заметки"]);
  }
  rows.push(...getModeButtons(isAdmin));
  return Markup.keyboard(rows).resize();
}

/** Handle /notes command — enter notes mode. */
export async function handleNotesCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("Заметки недоступны (нет подключения к базе данных).");
    return;
  }

  const dbUser = await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  await setUserMode(telegramId, "notes");
  await setModeMenuCommands(ctx, "notes");

  const isAdmin = isBootstrapAdmin(telegramId);
  const hasTribe = dbUser.tribeId != null;
  await ctx.reply(
    "📝 *Режим заметок активирован*\n\n" +
    "Создавайте заметки текстом или голосом.\n" +
    "Организуйте по рубрикам, отмечайте важное и срочное.\n" +
    (hasTribe ? "Делитесь публичными заметками с трайбом.\n" : "") +
    "\nИспользуйте кнопки ниже для навигации.",
    { parse_mode: "Markdown", ...getNotesKeyboard(isAdmin, hasTribe) }
  );
}

/** Handle "📝 Новая заметка" button. */
export async function handleNewNoteButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /start.");
    return;
  }

  const topics = await getTopicsByUser(dbUser.id);

  const buttons = topics.map((t) => [
    Markup.button.callback(`${t.emoji} ${t.name}`, `note_topic:${t.id}`),
  ]);
  buttons.push([Markup.button.callback("📄 Без рубрики", "note_topic:0")]);
  buttons.push([Markup.button.callback("➕ Новая рубрика", "note_new_topic")]);

  await ctx.reply("Выберите рубрику для заметки:", {
    ...Markup.inlineKeyboard(buttons),
  });
}

/** Handle topic selection for new note. */
export async function handleNoteTopicCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = data.match(/^note_topic:(\d+)$/);
  if (!match) {
    await ctx.answerCbQuery();
    return;
  }

  const topicId = parseInt(match[1], 10);

  // Check if user has tribe — if yes, ask visibility
  const dbUser = await getUserByTelegramId(telegramId);
  if (dbUser?.tribeId) {
    creationStates.set(telegramId, {
      step: "visibility",
      topicId: topicId === 0 ? null : topicId,
      visibility: "private",
    });
    await ctx.answerCbQuery();
    await ctx.editMessageText("Выберите видимость заметки:", {
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔒 Приватная (только для меня)", "note_vis:private")],
        [Markup.button.callback("🌐 Публичная (для трайба)", "note_vis:public")],
      ]),
    });
    return;
  }

  creationStates.set(telegramId, {
    step: "content",
    topicId: topicId === 0 ? null : topicId,
    visibility: "private",
  });

  await ctx.answerCbQuery();
  await ctx.editMessageText("Отправьте текст заметки (или голосовое сообщение):");
}

/** Handle visibility selection for new note. */
export async function handleNoteVisibilityCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = data.match(/^note_vis:(private|public)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const visibility = match[1] as NoteVisibility;
  const state = creationStates.get(telegramId);
  if (!state || state.step !== "visibility") {
    await ctx.answerCbQuery();
    return;
  }

  creationStates.set(telegramId, {
    step: "content",
    topicId: state.topicId,
    visibility,
  });

  await ctx.answerCbQuery();
  const visLabel = visibility === "public" ? "🌐 Публичная" : "🔒 Приватная";
  await ctx.editMessageText(`${visLabel}\n\nОтправьте текст заметки (или голосовое сообщение):`);
}

/** Handle "🌐 Публичные заметки" button. */
export async function handlePublicNotesButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) {
    await ctx.reply("Публичные заметки доступны только участникам трайба.");
    return;
  }

  const total = await countPublicNotesByTribe(dbUser.tribeId);
  if (total === 0) {
    await ctx.reply("В трайбе пока нет публичных заметок.");
    return;
  }

  const notes = await getPublicNotesByTribe(dbUser.tribeId, NOTES_PAGE_SIZE, 0);
  const totalPages = Math.ceil(total / NOTES_PAGE_SIZE);

  const buttons = buildNoteButtons(notes);
  if (total > NOTES_PAGE_SIZE) {
    const navButtons = [Markup.button.callback("Вперёд ➡️", `pub_notes_page:${NOTES_PAGE_SIZE}`)];
    buttons.reply_markup.inline_keyboard.push(navButtons);
  }

  await ctx.reply(`🌐 *Публичные заметки трайба (1/${totalPages}, всего: ${total}):*\n\n` + formatNotesList(notes, true), {
    parse_mode: "Markdown",
    ...buttons,
  });
}

/** Handle public notes pagination. */
export async function handlePublicNotesPageCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^pub_notes_page:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const offset = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) { await ctx.answerCbQuery(); return; }

  const total = await countPublicNotesByTribe(dbUser.tribeId);
  const notes = await getPublicNotesByTribe(dbUser.tribeId, NOTES_PAGE_SIZE, offset);
  const totalPages = Math.ceil(total / NOTES_PAGE_SIZE);
  const currentPage = Math.floor(offset / NOTES_PAGE_SIZE) + 1;

  const buttons = buildNoteButtons(notes);
  const navButtons: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (offset > 0) {
    navButtons.push(Markup.button.callback("⬅️ Назад", `pub_notes_page:${offset - NOTES_PAGE_SIZE}`));
  }
  if (offset + NOTES_PAGE_SIZE < total) {
    navButtons.push(Markup.button.callback("Вперёд ➡️", `pub_notes_page:${offset + NOTES_PAGE_SIZE}`));
  }
  if (navButtons.length > 0) {
    buttons.reply_markup.inline_keyboard.push(navButtons);
  }

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `🌐 *Публичные заметки (${currentPage}/${totalPages}, всего: ${total}):*\n\n` + formatNotesList(notes, true),
    { parse_mode: "Markdown", ...buttons }
  );
}

/** Handle new topic creation request. */
export async function handleNewTopicCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  topicCreationWaiting.add(telegramId);
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    "Отправьте название новой рубрики.\nМожно добавить эмодзи в начале, например: «🏠 Дом»"
  );
}

/** Handle "📂 Мои рубрики" button. */
export async function handleTopicsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const topics = await getTopicsByUser(dbUser.id);

  if (topics.length === 0) {
    await ctx.reply("У вас пока нет рубрик. Нажмите «📝 Новая заметка» и создайте первую.");
    return;
  }

  const buttons = topics.map((t) => [
    Markup.button.callback(`${t.emoji} ${t.name}`, `note_view_topic:${t.id}`),
    Markup.button.callback("🗑", `note_del_topic:${t.id}`),
  ]);

  await ctx.reply(`📂 *Ваши рубрики (${topics.length}):*`, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
}

/** Handle viewing notes in a topic. */
export async function handleViewTopicCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^note_view_topic:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const topicId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const notes = await getNotesByTopic(dbUser.id, topicId, NOTES_PAGE_SIZE, 0);
  await ctx.answerCbQuery();

  if (notes.length === 0) {
    await ctx.editMessageText("В этой рубрике пока нет заметок.");
    return;
  }

  await ctx.editMessageText(formatNotesList(notes), {
    parse_mode: "Markdown",
    ...buildNoteButtons(notes),
  });
}

/** Handle deleting a topic. */
export async function handleDeleteTopicCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^note_del_topic:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const topicId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  await deleteTopic(topicId, dbUser.id);
  await ctx.answerCbQuery("Рубрика удалена");
  await ctx.editMessageText("✅ Рубрика удалена. Заметки перемещены в «Без рубрики».");
}

/** Handle "⭐ Важное" button. */
export async function handleImportantButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const count = await countNotesByFlag(dbUser.id, "important");
  if (count === 0) {
    await ctx.reply("Нет заметок, отмеченных как важные.");
    return;
  }

  const notes = await getNotesByFlag(dbUser.id, "important", NOTES_PAGE_SIZE, 0);
  await ctx.reply(`⭐ *Важные заметки (${count}):*\n\n` + formatNotesList(notes), {
    parse_mode: "Markdown",
    ...buildNoteButtons(notes),
  });
}

/** Handle "🔥 Срочное" button. */
export async function handleUrgentButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const count = await countNotesByFlag(dbUser.id, "urgent");
  if (count === 0) {
    await ctx.reply("Нет заметок, отмеченных как срочные.");
    return;
  }

  const notes = await getNotesByFlag(dbUser.id, "urgent", NOTES_PAGE_SIZE, 0);
  await ctx.reply(`🔥 *Срочные заметки (${count}):*\n\n` + formatNotesList(notes), {
    parse_mode: "Markdown",
    ...buildNoteButtons(notes),
  });
}

/** Handle "📋 Все заметки" button. */
export async function handleAllNotesButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const total = await countNotesByUser(dbUser.id);
  if (total === 0) {
    await ctx.reply("У вас пока нет заметок. Нажмите «📝 Новая заметка» чтобы создать первую.");
    return;
  }

  const notes = await getNotesByUser(dbUser.id, NOTES_PAGE_SIZE, 0);
  const totalPages = Math.ceil(total / NOTES_PAGE_SIZE);

  const buttons = buildNoteButtons(notes);

  // Add pagination
  if (total > NOTES_PAGE_SIZE) {
    const navButtons = [Markup.button.callback("Вперёд ➡️", `notes_page:${NOTES_PAGE_SIZE}`)];
    buttons.reply_markup.inline_keyboard.push(navButtons);
  }

  await ctx.reply(`📋 *Все заметки (1/${totalPages}, всего: ${total}):*\n\n` + formatNotesList(notes), {
    parse_mode: "Markdown",
    ...buttons,
  });
}

/** Handle notes pagination callback. */
export async function handleNotesPageCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^notes_page:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const offset = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const total = await countNotesByUser(dbUser.id);
  const notes = await getNotesByUser(dbUser.id, NOTES_PAGE_SIZE, offset);
  const totalPages = Math.ceil(total / NOTES_PAGE_SIZE);
  const currentPage = Math.floor(offset / NOTES_PAGE_SIZE) + 1;

  const buttons = buildNoteButtons(notes);

  // Pagination nav
  const navButtons: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (offset > 0) {
    navButtons.push(Markup.button.callback("⬅️ Назад", `notes_page:${offset - NOTES_PAGE_SIZE}`));
  }
  if (offset + NOTES_PAGE_SIZE < total) {
    navButtons.push(Markup.button.callback("Вперёд ➡️", `notes_page:${offset + NOTES_PAGE_SIZE}`));
  }
  if (navButtons.length > 0) {
    buttons.reply_markup.inline_keyboard.push(navButtons);
  }

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `📋 *Все заметки (${currentPage}/${totalPages}, всего: ${total}):*\n\n` + formatNotesList(notes),
    { parse_mode: "Markdown", ...buttons }
  );
}

/** Handle note action callbacks (delete, toggle flags). */
export async function handleNoteActionCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  // Delete note
  const delMatch = data.match(/^note_del:(\d+)$/);
  if (delMatch) {
    const noteId = parseInt(delMatch[1], 10);
    await deleteNote(noteId, dbUser.id);
    logAction(dbUser.id, telegramId, "note_delete", { noteId });
    await ctx.answerCbQuery("Заметка удалена");
    await ctx.editMessageText("✅ Заметка удалена.");
    return;
  }

  // Toggle important
  const impMatch = data.match(/^note_imp:(\d+)$/);
  if (impMatch) {
    const noteId = parseInt(impMatch[1], 10);
    await toggleNoteFlag(noteId, dbUser.id, "important");
    await ctx.answerCbQuery("⭐ Флаг обновлён");
    // Refresh the note view
    const note = await getNoteById(noteId, dbUser.id);
    if (note) {
      await ctx.editMessageText(formatSingleNote(note), {
        parse_mode: "Markdown",
        ...buildSingleNoteButtons(note),
      });
    }
    return;
  }

  // Toggle urgent
  const urgMatch = data.match(/^note_urg:(\d+)$/);
  if (urgMatch) {
    const noteId = parseInt(urgMatch[1], 10);
    await toggleNoteFlag(noteId, dbUser.id, "urgent");
    await ctx.answerCbQuery("🔥 Флаг обновлён");
    const note = await getNoteById(noteId, dbUser.id);
    if (note) {
      await ctx.editMessageText(formatSingleNote(note), {
        parse_mode: "Markdown",
        ...buildSingleNoteButtons(note),
      });
    }
    return;
  }

  // Toggle visibility
  const visMatch = data.match(/^note_vis_toggle:(\d+)$/);
  if (visMatch) {
    const noteId = parseInt(visMatch[1], 10);
    const newVis = await toggleNoteVisibility(noteId, dbUser.id);
    if (newVis) {
      await ctx.answerCbQuery(newVis === "public" ? "🌐 Публичная" : "🔒 Приватная");
      const note = await getNoteById(noteId, dbUser.id);
      if (note) {
        await ctx.editMessageText(formatSingleNote(note), {
          parse_mode: "Markdown",
          ...buildSingleNoteButtons(note),
        });
      }
    } else {
      await ctx.answerCbQuery("Ошибка");
    }
    return;
  }

  // View note detail
  const viewMatch = data.match(/^note_view:(\d+)$/);
  if (viewMatch) {
    const noteId = parseInt(viewMatch[1], 10);
    const note = await getNoteById(noteId, dbUser.id);
    if (!note) {
      await ctx.answerCbQuery("Заметка не найдена");
      return;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(formatSingleNote(note), {
      parse_mode: "Markdown",
      ...buildSingleNoteButtons(note),
    });
    return;
  }

  await ctx.answerCbQuery();
}

/** Handle note_move callback — show topic selection for moving a note. */
export async function handleNoteMoveCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^note_move:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const noteId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const topics = await getTopicsByUser(dbUser.id);

  const buttons = topics.map((t) => [
    Markup.button.callback(`${t.emoji} ${t.name}`, `note_move_to:${noteId}:${t.id}`),
  ]);
  buttons.push([Markup.button.callback("📄 Без рубрики", `note_move_to:${noteId}:0`)]);

  await ctx.answerCbQuery();
  await ctx.editMessageText("Выберите рубрику для переноса:", {
    ...Markup.inlineKeyboard(buttons),
  });
}

/** Handle note_move_to callback — move note to selected topic. */
export async function handleNoteMoveToCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^note_move_to:(\d+):(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const noteId = parseInt(match[1], 10);
  const topicId = parseInt(match[2], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  try {
    await updateNote(noteId, dbUser.id, { topicId: topicId === 0 ? null : topicId });
    const note = await getNoteById(noteId, dbUser.id);
    if (note) {
      await ctx.answerCbQuery("Заметка перемещена");
      await ctx.editMessageText(formatSingleNote(note), {
        parse_mode: "Markdown",
        ...buildSingleNoteButtons(note),
      });
    } else {
      await ctx.answerCbQuery("Заметка не найдена");
    }
  } catch (err) {
    log.error("Error moving note:", err);
    await ctx.answerCbQuery("Ошибка при перемещении");
  }
}

/**
 * Handle text input in notes mode.
 * Returns true if the message was consumed.
 */
export async function handleNotesText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;

  const text = ctx.message.text.trim();
  if (!text) return false;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return false;

  // Topic creation flow
  if (topicCreationWaiting.has(telegramId)) {
    topicCreationWaiting.delete(telegramId);
    try {
      // Extract emoji from beginning if present
      const emojiMatch = text.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*/u);
      let name = text;
      let emoji = "📁";
      if (emojiMatch) {
        emoji = emojiMatch[1];
        name = text.slice(emojiMatch[0].length).trim();
      }
      if (!name) name = text;

      const topic = await createTopic(dbUser.id, name, emoji);
      logAction(dbUser.id, telegramId, "note_topic_create", { topicId: topic.id, name });

      // After creating topic, start note creation in this topic
      creationStates.set(telegramId, { step: "content", topicId: topic.id, visibility: "private" });
      await ctx.reply(
        `${topic.emoji} Рубрика «${topic.name}» создана!\n\nТеперь отправьте текст заметки:`
      );
    } catch (err) {
      log.error("Error creating topic:", err);
      await ctx.reply("Ошибка при создании рубрики. Возможно, такая уже существует.");
    }
    return true;
  }

  // Note content creation flow
  const state = creationStates.get(telegramId);
  if (state?.step === "content") {
    creationStates.delete(telegramId);
    try {
      const note = await createNote({
        userId: dbUser.id,
        topicId: state.topicId,
        content: text,
        inputMethod: "text",
        visibility: state.visibility,
        tribeId: state.visibility === "public" ? dbUser.tribeId : null,
      });
      logAction(dbUser.id, telegramId, "note_create", { noteId: note.id, inputMethod: "text", visibility: state.visibility });

      const topicLabel = note.topicName ? `${note.topicEmoji ?? "📁"} ${note.topicName}` : "Без рубрики";
      await ctx.reply(
        `✅ Заметка сохранена\n📂 ${topicLabel}\n\n` +
        `Предпросмотр: ${text.length > 100 ? text.slice(0, 100) + "..." : text}`,
        {
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(note.isImportant ? "⭐ Убрать важное" : "⭐ Важное", `note_imp:${note.id}`),
              Markup.button.callback(note.isUrgent ? "🔥 Убрать срочное" : "🔥 Срочное", `note_urg:${note.id}`),
            ],
          ]),
        }
      );
    } catch (err) {
      log.error("Error creating note:", err);
      await ctx.reply("Ошибка при сохранении заметки.");
    }
    return true;
  }

  return false;
}

/**
 * Handle voice input in notes mode.
 * Saves transcribed text as a note.
 */
export async function handleNotesVoice(
  ctx: Context,
  transcript: string,
  statusMsgId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  try {
    const state = creationStates.get(telegramId);
    const topicId = state?.step === "content" ? state.topicId : null;
    if (state) creationStates.delete(telegramId);

    const note = await createNote({
      userId: dbUser.id,
      topicId,
      content: transcript,
      inputMethod: "voice",
    });
    logAction(dbUser.id, telegramId, "note_create", { noteId: note.id, inputMethod: "voice" });

    const topicLabel = note.topicName ? `${note.topicEmoji ?? "📁"} ${note.topicName}` : "Без рубрики";
    const preview = transcript.length > 200 ? transcript.slice(0, 200) + "..." : transcript;

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      `✅ Заметка из голосового сохранена\n📂 ${topicLabel}\n\n${preview}`
    );
  } catch (err) {
    log.error("Error saving voice note:", err);
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      "Ошибка при сохранении голосовой заметки."
    );
  }
}

// ─── Formatting helpers ─────────────────────────────────────────────────

function formatNotesList(notes: Note[], showAuthor: boolean = false): string {
  return notes.map((n, i) => {
    const flags = [
      n.isImportant ? "⭐" : "",
      n.isUrgent ? "🔥" : "",
      n.visibility === "public" ? "🌐" : "",
    ].filter(Boolean).join(" ");
    const topic = n.topicName ? `${n.topicEmoji ?? "📁"} ${n.topicName}` : "";
    const author = showAuthor && n.authorName ? ` 👤 ${n.authorName}` : "";
    const date = n.createdAt.toLocaleDateString("ru-RU", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const preview = n.content.length > 80 ? n.content.slice(0, 80) + "..." : n.content;
    return `*${i + 1}.* ${flags} ${topic}${author}\n${preview}\n_${date}_`;
  }).join("\n\n");
}

function formatSingleNote(note: Note): string {
  const flags = [
    note.isImportant ? "⭐ Важное" : "",
    note.isUrgent ? "🔥 Срочное" : "",
  ].filter(Boolean).join(" | ");
  const topic = note.topicName ? `📂 ${note.topicEmoji ?? "📁"} ${note.topicName}` : "📂 Без рубрики";
  const visLabel = note.visibility === "public" ? "🌐 Публичная" : "🔒 Приватная";
  const date = note.createdAt.toLocaleDateString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const method = note.inputMethod === "voice" ? "🎤 Голосом" : "⌨️ Текстом";

  const parts = [`📝 *Заметка #${note.id}*`, topic, visLabel];
  if (flags) parts.push(flags);
  parts.push(`📅 ${date} | ${method}`);
  parts.push("");
  parts.push(note.content);

  return parts.join("\n");
}

function buildNoteButtons(notes: Note[]) {
  const buttons = notes.map((n) => [
    Markup.button.callback(`📝 #${n.id}`, `note_view:${n.id}`),
    Markup.button.callback("🗑", `note_del:${n.id}`),
  ]);
  return Markup.inlineKeyboard(buttons);
}

function buildSingleNoteButtons(note: Note) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(note.isImportant ? "⭐ Убрать" : "⭐ Важное", `note_imp:${note.id}`),
      Markup.button.callback(note.isUrgent ? "🔥 Убрать" : "🔥 Срочное", `note_urg:${note.id}`),
    ],
    [
      Markup.button.callback(
        note.visibility === "public" ? "🔒 Сделать приватной" : "🌐 Сделать публичной",
        `note_vis_toggle:${note.id}`
      ),
    ],
    [
      Markup.button.callback("📂 Переместить", `note_move:${note.id}`),
      Markup.button.callback("🗑 Удалить", `note_del:${note.id}`),
    ],
  ]);
}
