/**
 * Summarizer mode command handler.
 * Manage workplaces and work achievements, generate AI-powered summaries.
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { ensureUser, getUserByTelegramId } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import { escapeMarkdown } from "../utils/markdown.js";
import { createLogger } from "../utils/logger.js";
import {
  createWorkplace,
  getWorkplacesByUser,
  getWorkplaceById,
  updateWorkplace,
  deleteWorkplace,
  countWorkplacesByUser,
  createAchievement,
  getAchievementsByWorkplace,
  updateAchievement,
  deleteAchievement,
  getAllAchievementsForSummary,
} from "../summarizer/repository.js";
import { SUMMARIZER_MODEL, MAX_ACHIEVEMENT_LENGTH } from "../constants.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import { logAction } from "../logging/actionLogger.js";

const log = createLogger("summarizer-mode");

const PAGE_SIZE = 5;

// ─── State ──────────────────────────────────────────────────────────────

const creationStates = new Map<number, { step: "title" }>();
const addingStates = new Map<number, number>(); // telegramId → workplaceId
const editStates = new Map<number, { type: "rename_wp" | "edit_ach"; id: number }>();

// ─── Keyboard ───────────────────────────────────────────────────────────

function getSummarizerKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📋 Мои места работы", "➕ Новое место"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

// ─── Main Command ───────────────────────────────────────────────────────

export async function handleSummarizerCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("📝 Саммарайзер недоступен (нет подключения к базе данных).");
    return;
  }

  await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  await setUserMode(telegramId, "summarizer");
  await setModeMenuCommands(ctx, "summarizer");

  // Clear any pending states
  creationStates.delete(telegramId);
  addingStates.delete(telegramId);
  editStates.delete(telegramId);

  const isAdmin = isBootstrapAdmin(telegramId);

  await ctx.reply(
    "📝 *Режим Саммарайзер активирован*\n\n" +
    "Записывайте достижения по местам работы.\n" +
    "Генерируйте AI-саммари для резюме и LinkedIn.",
    { parse_mode: "Markdown", ...getSummarizerKeyboard(isAdmin) }
  );
}

// ─── My Workplaces ──────────────────────────────────────────────────────

export async function handleMyWorkplacesButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  try {
    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) {
      await ctx.reply("Пользователь не найден.");
      return;
    }

    const workplaces = await getWorkplacesByUser(dbUser.id);

    if (workplaces.length === 0) {
      await ctx.reply(
        "📝 У вас пока нет мест работы.\nНажмите «➕ Новое место» чтобы создать."
      );
      return;
    }

    const buttons = workplaces.map((wp) => [
      Markup.button.callback(
        `💼 ${wp.title} — ${wp.achievementCount ?? 0} записей`,
        `sum_wp:${wp.id}`
      ),
    ]);

    await ctx.reply(`📝 *Мои места работы (${workplaces.length}):*`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (err) {
    log.error("Error listing workplaces", err);
    await ctx.reply("Ошибка при загрузке мест работы.");
  }
}

// ─── New Workplace ──────────────────────────────────────────────────────

export async function handleNewWorkplaceButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  try {
    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) {
      await ctx.reply("Пользователь не найден.");
      return;
    }

    const count = await countWorkplacesByUser(dbUser.id);
    if (count >= 10) {
      await ctx.reply("📝 Максимум 10 мест работы. Удалите одно, чтобы создать новое.");
      return;
    }

    creationStates.set(telegramId, { step: "title" });
    addingStates.delete(telegramId);
    editStates.delete(telegramId);

    await ctx.reply("📝 Введите название места работы (должность или компания):");
  } catch (err) {
    log.error("Error starting workplace creation", err);
    await ctx.reply("Ошибка при создании места работы.");
  }
}

// ─── Callbacks ──────────────────────────────────────────────────────────

export async function handleSumCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  try {
    // sum_wp:{id} — view workplace
    if (data.startsWith("sum_wp:")) {
      const wpId = parseInt(data.split(":")[1], 10);
      await showWorkplace(ctx, wpId, dbUser.id);
      return;
    }

    // sum_add:{id} — enter achievement adding mode
    if (data.startsWith("sum_add:")) {
      const wpId = parseInt(data.split(":")[1], 10);
      const wp = await getWorkplaceById(wpId, dbUser.id);
      if (!wp) return;

      addingStates.set(telegramId, wpId);
      creationStates.delete(telegramId);
      editStates.delete(telegramId);

      await ctx.editMessageText(
        `💼 *${escapeMarkdown(wp.title)}*\n\n` +
        "Отправляйте достижения текстом или голосом.\n" +
        "По окончании нажмите Готово.",
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("✅ Готово", "sum_done")],
          ]),
        }
      );
      return;
    }

    // sum_done — finish adding achievements
    if (data === "sum_done") {
      const wpId = addingStates.get(telegramId);
      addingStates.delete(telegramId);
      if (wpId != null) {
        await showWorkplace(ctx, wpId, dbUser.id);
      } else {
        await ctx.editMessageText("Готово.");
      }
      return;
    }

    // sum_list:{id}:{offset} — paginated achievements
    if (data.startsWith("sum_list:")) {
      const parts = data.split(":");
      const wpId = parseInt(parts[1], 10);
      const offset = parseInt(parts[2], 10);
      await showAchievementsList(ctx, wpId, dbUser.id, offset);
      return;
    }

    // sum_gen:{id} — generate summary
    if (data.startsWith("sum_gen:")) {
      const wpId = parseInt(data.split(":")[1], 10);
      await ctx.editMessageText("⏳ Генерирую саммари...");
      const summary = await generateSummary(wpId, dbUser.id);
      logAction(dbUser.id, telegramId, "summarizer_generate", { workplaceId: wpId });
      await ctx.editMessageText(summary, { parse_mode: "Markdown" });
      return;
    }

    // sum_wp_del:{id} — confirm workplace deletion
    if (data.startsWith("sum_wp_del:") && !data.startsWith("sum_wp_del_yes:")) {
      const wpId = parseInt(data.split(":")[1], 10);
      const wp = await getWorkplaceById(wpId, dbUser.id);
      if (!wp) return;

      await ctx.editMessageText(
        `🗑 Удалить место работы «${escapeMarkdown(wp.title)}» и все достижения?`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback("✅ Да, удалить", `sum_wp_del_yes:${wpId}`),
              Markup.button.callback("❌ Отмена", `sum_wp:${wpId}`),
            ],
          ]),
        }
      );
      return;
    }

    // sum_wp_del_yes:{id} — actually delete workplace
    if (data.startsWith("sum_wp_del_yes:")) {
      const wpId = parseInt(data.split(":")[1], 10);
      const deleted = await deleteWorkplace(wpId, dbUser.id);
      if (deleted) {
        await ctx.editMessageText("🗑 Место работы удалено.");
      } else {
        await ctx.editMessageText("Не удалось удалить место работы.");
      }
      return;
    }

    // sum_rename:{id} — start rename
    if (data.startsWith("sum_rename:")) {
      const wpId = parseInt(data.split(":")[1], 10);
      const wp = await getWorkplaceById(wpId, dbUser.id);
      if (!wp) return;

      editStates.set(telegramId, { type: "rename_wp", id: wpId });
      creationStates.delete(telegramId);
      addingStates.delete(telegramId);

      await ctx.editMessageText(
        `✏️ Введите новое название для «${escapeMarkdown(wp.title)}»:`
      );
      return;
    }

    // sum_ach_edit:{id} — start editing achievement text
    if (data.startsWith("sum_ach_edit:")) {
      const achId = parseInt(data.split(":")[1], 10);
      editStates.set(telegramId, { type: "edit_ach", id: achId });
      creationStates.delete(telegramId);
      addingStates.delete(telegramId);

      await ctx.editMessageText("✏️ Введите новый текст достижения:");
      return;
    }

    // sum_ach_del:{id} — delete achievement
    if (data.startsWith("sum_ach_del:")) {
      const achId = parseInt(data.split(":")[1], 10);
      await deleteAchievement(achId);

      // Find which workplace this belongs to — refresh list
      // We need workplaceId; extract from the message or re-derive.
      // Since we can't easily get workplaceId from achId alone,
      // we attempt to find it from the addingStates or show a confirmation.
      await ctx.editMessageText("🗑 Запись удалена.");
      return;
    }
  } catch (err) {
    log.error("Error in sum callback", err);
    try {
      await ctx.editMessageText("Произошла ошибка. Попробуйте ещё раз.");
    } catch {
      await ctx.reply("Произошла ошибка. Попробуйте ещё раз.");
    }
  }
}

// ─── Text Handler ───────────────────────────────────────────────────────

/** Handle text input in summarizer mode. Returns true if consumed. */
export async function handleSummarizerText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;
  const text = ctx.message.text;

  // Creation wizard — title step
  const state = creationStates.get(telegramId);
  if (state?.step === "title") {
    const title = text.trim();
    if (title.length === 0 || title.length > 255) {
      await ctx.reply("Название должно быть от 1 до 255 символов.");
      return true;
    }

    try {
      const dbUser = await getUserByTelegramId(telegramId);
      if (!dbUser) {
        await ctx.reply("Пользователь не найден.");
        creationStates.delete(telegramId);
        return true;
      }

      const wp = await createWorkplace(dbUser.id, title);
      logAction(dbUser.id, telegramId, "summarizer_workplace_create", { workplaceId: wp.id, title });
      creationStates.delete(telegramId);

      await showWorkplace(ctx, wp.id, dbUser.id);
    } catch (err) {
      log.error("Error creating workplace", err);
      creationStates.delete(telegramId);
      await ctx.reply("Ошибка при создании места работы.");
    }
    return true;
  }

  // Achievement adding mode
  const wpId = addingStates.get(telegramId);
  if (wpId != null) {
    const achText = text.trim();
    if (achText.length === 0) return true;

    if (achText.length > MAX_ACHIEVEMENT_LENGTH) {
      await ctx.reply(
        `Текст слишком длинный (максимум ${MAX_ACHIEVEMENT_LENGTH} символов).`
      );
      return true;
    }

    try {
      await createAchievement(wpId, achText, "text");
      const dbUser = await getUserByTelegramId(telegramId);
      logAction(dbUser?.id ?? null, telegramId, "summarizer_entry_add", { workplaceId: wpId, inputMethod: "text" });
      await ctx.reply(`✅ Записано: ${escapeMarkdown(achText)}`, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      log.error("Error creating achievement", err);
      await ctx.reply("Ошибка при сохранении достижения.");
    }
    return true;
  }

  // Edit states
  const edit = editStates.get(telegramId);
  if (edit) {
    const newText = text.trim();

    if (edit.type === "rename_wp") {
      if (newText.length === 0 || newText.length > 255) {
        await ctx.reply("Название должно быть от 1 до 255 символов.");
        return true;
      }

      try {
        const dbUser = await getUserByTelegramId(telegramId);
        if (!dbUser) {
          await ctx.reply("Пользователь не найден.");
          editStates.delete(telegramId);
          return true;
        }

        const updated = await updateWorkplace(edit.id, dbUser.id, { title: newText });
        editStates.delete(telegramId);

        if (updated) {
          await ctx.reply(`✅ Переименовано: *${escapeMarkdown(newText)}*`, {
            parse_mode: "Markdown",
          });
        } else {
          await ctx.reply("Не удалось переименовать место работы.");
        }
      } catch (err) {
        log.error("Error renaming workplace", err);
        editStates.delete(telegramId);
        await ctx.reply("Ошибка при переименовании.");
      }
      return true;
    }

    if (edit.type === "edit_ach") {
      if (newText.length === 0 || newText.length > MAX_ACHIEVEMENT_LENGTH) {
        await ctx.reply(
          `Текст должен быть от 1 до ${MAX_ACHIEVEMENT_LENGTH} символов.`
        );
        return true;
      }

      try {
        const updated = await updateAchievement(edit.id, newText);
        editStates.delete(telegramId);

        if (updated) {
          await ctx.reply(`✅ Запись обновлена: ${escapeMarkdown(newText)}`, {
            parse_mode: "Markdown",
          });
        } else {
          await ctx.reply("Не удалось обновить запись.");
        }
      } catch (err) {
        log.error("Error editing achievement", err);
        editStates.delete(telegramId);
        await ctx.reply("Ошибка при редактировании записи.");
      }
      return true;
    }
  }

  return false;
}

// ─── Voice Handler ──────────────────────────────────────────────────────

/** Handle voice transcript in summarizer mode. */
export async function handleSummarizerVoice(
  ctx: Context,
  transcript: string,
  statusMsgId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const wpId = addingStates.get(telegramId);
  if (wpId == null) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      "📝 Голосовые записи доступны только при добавлении достижений.\nОткройте место работы и нажмите «➕ Добавить достижения»."
    );
    return;
  }

  const achText = transcript.trim();
  if (achText.length === 0) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      "Не удалось распознать текст."
    );
    return;
  }

  if (achText.length > MAX_ACHIEVEMENT_LENGTH) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      `Текст слишком длинный (максимум ${MAX_ACHIEVEMENT_LENGTH} символов).`
    );
    return;
  }

  try {
    await createAchievement(wpId, achText, "voice");
    const dbUser = await getUserByTelegramId(telegramId);
    logAction(dbUser?.id ?? null, telegramId, "summarizer_entry_add", { workplaceId: wpId, inputMethod: "voice" });
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      `🎤 ✅ Записано: ${escapeMarkdown(achText)}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    log.error("Error saving voice achievement", err);
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      "Ошибка при сохранении достижения."
    );
  }
}

// ─── Private helpers ────────────────────────────────────────────────────

async function showWorkplace(
  ctx: Context,
  workplaceId: number,
  userId: number
): Promise<void> {
  const wp = await getWorkplaceById(workplaceId, userId);
  if (!wp) {
    try {
      await ctx.editMessageText("Место работы не найдено.");
    } catch {
      await ctx.reply("Место работы не найдено.");
    }
    return;
  }

  const count = wp.achievementCount ?? 0;
  const header = `💼 *${escapeMarkdown(wp.title)}*` +
    (wp.company ? `\n🏢 ${escapeMarkdown(wp.company)}` : "") +
    `\n📊 Записей: ${count}`;

  const buttons: ReturnType<typeof Markup.button.callback>[][] = [
    [Markup.button.callback("➕ Добавить достижения", `sum_add:${wp.id}`)],
    [Markup.button.callback(`📋 Все записи (${count})`, `sum_list:${wp.id}:0`)],
    [Markup.button.callback("✨ Сгенерировать саммари", `sum_gen:${wp.id}`)],
    [
      Markup.button.callback("✏️ Переименовать", `sum_rename:${wp.id}`),
      Markup.button.callback("🗑 Удалить", `sum_wp_del:${wp.id}`),
    ],
  ];

  try {
    await ctx.editMessageText(header, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch {
    await ctx.reply(header, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  }
}

async function showAchievementsList(
  ctx: Context,
  workplaceId: number,
  userId: number,
  offset: number
): Promise<void> {
  const wp = await getWorkplaceById(workplaceId, userId);
  if (!wp) {
    try {
      await ctx.editMessageText("Место работы не найдено.");
    } catch {
      await ctx.reply("Место работы не найдено.");
    }
    return;
  }

  const totalCount = wp.achievementCount ?? 0;
  const achievements = await getAchievementsByWorkplace(workplaceId, PAGE_SIZE, offset);

  if (achievements.length === 0 && offset === 0) {
    try {
      await ctx.editMessageText(
        `💼 *${escapeMarkdown(wp.title)}*\n\n_Записей пока нет_`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("« Назад", `sum_wp:${workplaceId}`)],
          ]),
        }
      );
    } catch {
      await ctx.reply("Записей пока нет.");
    }
    return;
  }

  const lines = achievements.map((a, i) => {
    const num = offset + i + 1;
    return `${num}. ${escapeMarkdown(a.text)}`;
  });

  const header = `💼 *${escapeMarkdown(wp.title)}* — записи (${totalCount}):\n\n`;
  const text = header + lines.join("\n");

  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

  // Edit/delete buttons for each achievement
  for (const a of achievements) {
    buttons.push([
      Markup.button.callback("✏️", `sum_ach_edit:${a.id}`),
      Markup.button.callback("🗑", `sum_ach_del:${a.id}`),
    ]);
  }

  // Pagination
  const navRow: ReturnType<typeof Markup.button.callback>[] = [];
  if (offset > 0) {
    navRow.push(
      Markup.button.callback("⬅️", `sum_list:${workplaceId}:${Math.max(0, offset - PAGE_SIZE)}`)
    );
  }
  if (offset + PAGE_SIZE < totalCount) {
    navRow.push(
      Markup.button.callback("➡️", `sum_list:${workplaceId}:${offset + PAGE_SIZE}`)
    );
  }
  if (navRow.length > 0) buttons.push(navRow);

  // Back button
  buttons.push([Markup.button.callback("« Назад", `sum_wp:${workplaceId}`)]);

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

async function generateSummary(
  workplaceId: number,
  userId: number
): Promise<string> {
  const workplace = await getWorkplaceById(workplaceId, userId);
  if (!workplace) throw new Error("Место работы не найдено");

  const achievements = await getAllAchievementsForSummary(workplaceId);
  if (achievements.length === 0) return "Нет записей для генерации саммари.";

  const bulletList = achievements
    .map((a, i) => `${i + 1}. ${a.text}`)
    .join("\n");

  const position = workplace.company
    ? `${workplace.title} в ${workplace.company}`
    : workplace.title;

  const systemPrompt =
    "Ты — HR-консультант и копирайтер резюме. Создай краткий, выгодный пересказ " +
    "достижений для указанной позиции. Фокусируйся на конкретных результатах, " +
    "импакте, технологиях. Пиши на том же языке, что и входные данные. Избегай " +
    "шаблонных фраз. Результат должен быть готов для вставки в резюме или LinkedIn.";

  const result = await callOpenRouter({
    model: SUMMARIZER_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Позиция: ${position}\n\nДостижения:\n${bulletList}`,
      },
    ],
    temperature: 0.7,
  });

  return result || "Не удалось сгенерировать саммари.";
}
