/**
 * Blogger mode command handler.
 * Create AI-powered posts for Telegram channels from collected sources.
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { ensureUser, getUserByTelegramId } from "../expenses/repository.js";
import { isBootstrapAdmin, getUserMenuContext } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import {
  createChannel,
  getChannelsByUser,
  getChannelById,
  updateChannel,
  deleteChannel,
  countChannelsByUser,
  createPost,
  getPostsByChannel,
  getPostsByUser,
  getPostById,
  updatePostStatus,
  updatePostGenerated,
  deletePost,
  addSource,
  getSourcesByPost,
  deleteSource,
  countSourcesByPost,
  updateChannelStyleSamples,
} from "../blogger/repository.js";
import type { BloggerChannel, BloggerPost } from "../blogger/repository.js";
import { generatePost, splitIntoMessages, searchForTopic } from "../blogger/postGenerator.js";
import { fetchUrlContent } from "../blogger/contentFetcher.js";
import { fetchStyleSamples } from "../blogger/styleFetcher.js";
import { BLOGGER_MODEL, MAX_POST_SOURCES } from "../constants.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import { escapeMarkdown } from "../utils/markdown.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("blogger-mode");

const PAGE_SIZE = 5;

// ─── State ──────────────────────────────────────────────────────────────

const channelCreationStates = new Map<number, { step: "title" | "niche"; title?: string }>();
const topicStates = new Map<number, number>(); // telegramId → channelId (waiting for topic text)
const collectingStates = new Map<number, number>(); // telegramId → postId
const editStates = new Map<number, { type: "edit_niche"; channelId: number }>();

// ─── Status icons ───────────────────────────────────────────────────────

function statusIcon(status: string): string {
  const icons: Record<string, string> = {
    draft: "📝",
    collecting: "📥",
    generating: "⏳",
    generated: "✅",
    published: "📢",
  };
  return icons[status] ?? "📝";
}

// ─── Keyboard ───────────────────────────────────────────────────────────

function getBloggerKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📝 Мои каналы", "➕ Новый канал"],
    ["📄 Мои посты"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

// ─── Helper: clear all states for a user ────────────────────────────────

function clearStates(telegramId: number): void {
  channelCreationStates.delete(telegramId);
  topicStates.delete(telegramId);
  collectingStates.delete(telegramId);
  editStates.delete(telegramId);
}

// ─── Helper: source collection UI ──────────────────────────────────────

async function showCollectingUI(ctx: Context, postId: number, userId: number): Promise<void> {
  const count = await countSourcesByPost(postId);
  const post = await getPostById(postId, userId);
  const topic = post ? escapeMarkdown(post.topic) : "Пост";

  await ctx.reply(
    `✍️ *Сбор материалов для поста*\nТема: ${topic}\n\n` +
    "Отправляйте материалы:\n" +
    "• Текст — заметки, тезисы\n" +
    "• Голосовые — мысли\n" +
    "• Ссылки — на статьи/посты\n" +
    "• Пересланные сообщения",
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Поиск по теме (Tavily)", `blog_search:${postId}`)],
        [Markup.button.callback(`📋 Источники (${count})`, `blog_sources:${postId}`)],
        [Markup.button.callback("✨ Сгенерировать пост", `blog_gen:${postId}`)],
        [Markup.button.callback("🗑 Отменить", `blog_post_del:${postId}`)],
      ]),
    }
  );
}

// ─── Main Command ──────────────────────────────────────────────────────

export async function handleBloggerCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("✍️ Блогер недоступен (нет подключения к базе данных).");
    return;
  }

  await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  await setUserMode(telegramId, "blogger");
  await setModeMenuCommands(ctx, "blogger");

  clearStates(telegramId);

  const isAdmin = isBootstrapAdmin(telegramId);

  await ctx.reply(
    "✍️ *Режим Блогер активирован*\n\n" +
    "Создавайте посты для Telegram-каналов с помощью AI.",
    { parse_mode: "Markdown", ...getBloggerKeyboard(isAdmin) }
  );
}

// ─── My Channels Button ────────────────────────────────────────────────

export async function handleMyChannelsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  try {
    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) {
      await ctx.reply("Пользователь не найден.");
      return;
    }

    const channels = await getChannelsByUser(dbUser.id);

    if (channels.length === 0) {
      await ctx.reply(
        "📺 У вас пока нет каналов.\nНажмите «➕ Новый канал» чтобы создать."
      );
      return;
    }

    const buttons = channels.map((ch) => {
      const postCount = ch.postCount ?? 0;
      return [
        Markup.button.callback(
          `📺 ${ch.channelTitle} — ${postCount} постов`,
          `blog_ch:${ch.id}`
        ),
      ];
    });

    await ctx.reply(`📺 *Мои каналы (${channels.length}):*`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (err) {
    log.error("handleMyChannelsButton error:", err);
    await ctx.reply("Ошибка при загрузке каналов.");
  }
}

// ─── New Channel Button ────────────────────────────────────────────────

export async function handleNewChannelButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  try {
    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) {
      await ctx.reply("Пользователь не найден.");
      return;
    }

    const count = await countChannelsByUser(dbUser.id);
    if (count >= 5) {
      await ctx.reply("📺 Максимум 5 каналов. Удалите один, чтобы создать новый.");
      return;
    }

    clearStates(telegramId);
    channelCreationStates.set(telegramId, { step: "title" });

    await ctx.reply("📺 Введите @username или название канала:");
  } catch (err) {
    log.error("handleNewChannelButton error:", err);
    await ctx.reply("Ошибка при создании канала.");
  }
}

// ─── My Posts Button ───────────────────────────────────────────────────

export async function handleMyPostsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  try {
    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) {
      await ctx.reply("Пользователь не найден.");
      return;
    }

    const posts = await getPostsByUser(dbUser.id, PAGE_SIZE, 0);

    if (posts.length === 0) {
      await ctx.reply("📄 У вас пока нет постов.\nСоздайте канал и начните новый пост.");
      return;
    }

    const buttons = posts.map((p) => {
      const icon = statusIcon(p.status);
      const topicSlice = p.topic.length > 40 ? p.topic.slice(0, 40) + "…" : p.topic;
      return [Markup.button.callback(`${icon} ${topicSlice}`, `blog_post:${p.id}`)];
    });

    await ctx.reply(`📄 *Мои посты:*`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (err) {
    log.error("handleMyPostsButton error:", err);
    await ctx.reply("Ошибка при загрузке постов.");
  }
}

// ─── Blog Callback Router ──────────────────────────────────────────────

export async function handleBlogCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  try {
    // blog_ch:<id> — show channel details
    if (data.startsWith("blog_ch:") && !data.startsWith("blog_ch_")) {
      const channelId = parseInt(data.split(":")[1], 10);
      await showChannelDetails(ctx, channelId, dbUser.id);
      return;
    }

    // blog_new_post:<id> — start new post for channel
    if (data.startsWith("blog_new_post:")) {
      const channelId = parseInt(data.split(":")[1], 10);
      const channel = await getChannelById(channelId, dbUser.id);
      if (!channel) {
        await ctx.editMessageText("Канал не найден.");
        return;
      }

      clearStates(telegramId);
      topicStates.set(telegramId, channelId);

      await ctx.editMessageText("✍️ Введите тему поста:");
      return;
    }

    // blog_ch_posts:<id>:<offset> — paginated posts for channel
    if (data.startsWith("blog_ch_posts:")) {
      const parts = data.split(":");
      const channelId = parseInt(parts[1], 10);
      const offset = parseInt(parts[2], 10);
      await showChannelPosts(ctx, channelId, dbUser.id, offset);
      return;
    }

    // blog_ch_del:<id> — confirm channel deletion
    if (data.startsWith("blog_ch_del:") && !data.startsWith("blog_ch_del_yes:")) {
      const channelId = parseInt(data.split(":")[1], 10);
      const channel = await getChannelById(channelId, dbUser.id);
      if (!channel) {
        await ctx.editMessageText("Канал не найден.");
        return;
      }

      await ctx.editMessageText(
        `🗑 Удалить канал «${escapeMarkdown(channel.channelTitle)}» и все его посты?`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback("✅ Да, удалить", `blog_ch_del_yes:${channelId}`),
              Markup.button.callback("❌ Отмена", `blog_ch:${channelId}`),
            ],
          ]),
        }
      );
      return;
    }

    // blog_ch_del_yes:<id> — delete channel
    if (data.startsWith("blog_ch_del_yes:")) {
      const channelId = parseInt(data.split(":")[1], 10);
      const deleted = await deleteChannel(channelId, dbUser.id);
      if (deleted) {
        await ctx.editMessageText("🗑 Канал удалён.");
      } else {
        await ctx.editMessageText("Не удалось удалить канал.");
      }
      return;
    }

    // blog_edit_niche:<id> — start editing niche
    if (data.startsWith("blog_edit_niche:")) {
      const channelId = parseInt(data.split(":")[1], 10);
      const channel = await getChannelById(channelId, dbUser.id);
      if (!channel) {
        await ctx.editMessageText("Канал не найден.");
        return;
      }

      clearStates(telegramId);
      editStates.set(telegramId, { type: "edit_niche", channelId });

      await ctx.editMessageText(
        `✏️ Введите новое описание ниши для канала «${escapeMarkdown(channel.channelTitle)}»:`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // blog_fetch_style:<id> — fetch style samples from channel
    if (data.startsWith("blog_fetch_style:")) {
      const channelId = parseInt(data.split(":")[1], 10);
      const channel = await getChannelById(channelId, dbUser.id);
      if (!channel) {
        await ctx.editMessageText("Канал не найден.");
        return;
      }

      const username = channel.channelUsername?.replace("@", "");
      if (!username) {
        await ctx.editMessageText("Укажите @username канала для загрузки стиля.");
        return;
      }

      await ctx.editMessageText("📖 Загружаю примеры постов из канала…");

      try {
        const samples = await fetchStyleSamples(username);
        if (samples.length === 0) {
          await ctx.reply("Не удалось загрузить посты. Проверьте @username и доступность канала.");
          return;
        }

        await updateChannelStyleSamples(channelId, dbUser.id, samples);
        await ctx.reply(`📖 Загружено ${samples.length} примеров стиля.`);
        await showChannelDetails(ctx, channelId, dbUser.id);
      } catch (err) {
        log.error("Failed to fetch style samples:", err);
        await ctx.reply("Ошибка при загрузке стиля. Попробуйте позже.");
      }
      return;
    }

    // blog_post:<id> — show post details
    if (data.startsWith("blog_post:") && !data.startsWith("blog_post_")) {
      const postId = parseInt(data.split(":")[1], 10);
      await showPostDetails(ctx, postId, dbUser.id);
      return;
    }

    // blog_search:<id> — search for topic via Tavily
    if (data.startsWith("blog_search:")) {
      const postId = parseInt(data.split(":")[1], 10);
      await handleSearchForPost(ctx, postId, dbUser.id);
      return;
    }

    // blog_sources:<id> — list sources
    if (data.startsWith("blog_sources:")) {
      const postId = parseInt(data.split(":")[1], 10);
      await showSources(ctx, postId, dbUser.id);
      return;
    }

    // blog_gen:<id> — generate post
    if (data.startsWith("blog_gen:")) {
      const postId = parseInt(data.split(":")[1], 10);
      await handleGeneratePost(ctx, postId, dbUser.id);
      return;
    }

    // blog_preview:<id> — preview published post
    if (data.startsWith("blog_preview:")) {
      const postId = parseInt(data.split(":")[1], 10);
      await handlePreviewPost(ctx, postId, dbUser.id);
      return;
    }

    // blog_regen:<id> — regenerate post
    if (data.startsWith("blog_regen:")) {
      const postId = parseInt(data.split(":")[1], 10);
      await handleGeneratePost(ctx, postId, dbUser.id);
      return;
    }

    // blog_publish:<id> — publish post to channel
    if (data.startsWith("blog_publish:")) {
      const postId = parseInt(data.split(":")[1], 10);
      await handlePublishPost(ctx, postId, dbUser.id);
      return;
    }

    // blog_post_del:<id> — delete post
    if (data.startsWith("blog_post_del:")) {
      const postId = parseInt(data.split(":")[1], 10);
      const deleted = await deletePost(postId, dbUser.id);
      collectingStates.delete(telegramId);
      if (deleted) {
        await ctx.editMessageText("🗑 Пост удалён.");
      } else {
        await ctx.editMessageText("Не удалось удалить пост.");
      }
      return;
    }

    // blog_post_done:<id> — acknowledge, clear states
    if (data.startsWith("blog_post_done:")) {
      clearStates(telegramId);
      await ctx.editMessageText("✅ Готово.");
      return;
    }

    // blog_src_del:<id> — delete a source
    if (data.startsWith("blog_src_del:")) {
      const sourceId = parseInt(data.split(":")[1], 10);
      await deleteSource(sourceId, dbUser.id);
      // Find the postId to refresh sources view
      const postId = collectingStates.get(telegramId);
      if (postId != null) {
        await showSources(ctx, postId, dbUser.id);
      } else {
        await ctx.editMessageText("Источник удалён.");
      }
      return;
    }
  } catch (err) {
    log.error("handleBlogCallback error:", err);
    try {
      await ctx.reply("Произошла ошибка. Попробуйте ещё раз.");
    } catch { /* ignore */ }
  }
}

// ─── Text Handler ──────────────────────────────────────────────────────

/** Handle text input in blogger mode. Returns true if consumed. */
export async function handleBloggerText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;
  const text = ctx.message.text;

  // Channel creation — title step
  const creationState = channelCreationStates.get(telegramId);
  if (creationState?.step === "title") {
    const title = text.trim();
    if (title.length === 0 || title.length > 200) {
      await ctx.reply("Название должно быть от 1 до 200 символов.");
      return true;
    }

    creationState.title = title;
    creationState.step = "niche";
    channelCreationStates.set(telegramId, creationState);

    await ctx.reply(
      `📺 Канал: «${escapeMarkdown(title)}»\n\nВведите описание ниши канала (тематика, стиль, целевая аудитория):`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  // Channel creation — niche step
  if (creationState?.step === "niche" && creationState.title) {
    const niche = text.trim();
    if (niche.length === 0 || niche.length > 1000) {
      await ctx.reply("Описание должно быть от 1 до 1000 символов.");
      return true;
    }

    try {
      const dbUser = await getUserByTelegramId(telegramId);
      if (!dbUser) {
        await ctx.reply("Пользователь не найден.");
        channelCreationStates.delete(telegramId);
        return true;
      }

      // Extract @username if present
      const title = creationState.title;
      const usernameMatch = title.match(/^@(\w+)$/);
      const channelUsername = usernameMatch ? title : undefined;
      const channelTitle = usernameMatch ? title : title;

      const channel = await createChannel(dbUser.id, channelTitle, channelUsername, niche);
      channelCreationStates.delete(telegramId);

      await showChannelDetails(ctx, channel.id, dbUser.id);
    } catch (err) {
      log.error("Channel creation error:", err);
      channelCreationStates.delete(telegramId);
      await ctx.reply("Ошибка при создании канала.");
    }
    return true;
  }

  // Topic input — waiting for post topic
  const channelIdForTopic = topicStates.get(telegramId);
  if (channelIdForTopic != null) {
    const topic = text.trim();
    if (topic.length === 0 || topic.length > 500) {
      await ctx.reply("Тема должна быть от 1 до 500 символов.");
      return true;
    }

    try {
      const dbUser = await getUserByTelegramId(telegramId);
      if (!dbUser) {
        await ctx.reply("Пользователь не найден.");
        topicStates.delete(telegramId);
        return true;
      }

      const post = await createPost(channelIdForTopic, dbUser.id, topic, "collecting");
      topicStates.delete(telegramId);
      collectingStates.set(telegramId, post.id);

      await showCollectingUI(ctx, post.id, dbUser.id);
    } catch (err) {
      log.error("Post creation error:", err);
      topicStates.delete(telegramId);
      await ctx.reply("Ошибка при создании поста.");
    }
    return true;
  }

  // Edit niche
  const edit = editStates.get(telegramId);
  if (edit?.type === "edit_niche") {
    const niche = text.trim();
    if (niche.length === 0 || niche.length > 1000) {
      await ctx.reply("Описание должно быть от 1 до 1000 символов.");
      return true;
    }

    try {
      const dbUser = await getUserByTelegramId(telegramId);
      if (!dbUser) {
        await ctx.reply("Пользователь не найден.");
        editStates.delete(telegramId);
        return true;
      }

      await updateChannel(edit.channelId, dbUser.id, { nicheDescription: niche });
      editStates.delete(telegramId);

      await ctx.reply("✅ Описание ниши обновлено.");
      await showChannelDetails(ctx, edit.channelId, dbUser.id);
    } catch (err) {
      log.error("Edit niche error:", err);
      editStates.delete(telegramId);
      await ctx.reply("Ошибка при обновлении ниши.");
    }
    return true;
  }

  // Collecting sources
  const collectingPostId = collectingStates.get(telegramId);
  if (collectingPostId != null) {
    try {
      const dbUser = await getUserByTelegramId(telegramId);
      if (!dbUser) return true;

      const currentCount = await countSourcesByPost(collectingPostId);
      if (currentCount >= MAX_POST_SOURCES) {
        await ctx.reply(`📋 Достигнут лимит источников (${MAX_POST_SOURCES}).`);
        return true;
      }

      // Check for URL
      const urlRegex = /https?:\/\/\S+/;
      const urlMatch = text.match(urlRegex);

      if (urlMatch) {
        const url = urlMatch[0];
        await ctx.reply("🔗 Загружаю содержимое ссылки…");

        const fetched = await fetchUrlContent(url);
        if (fetched) {
          await addSource(collectingPostId, "link", url, fetched.title, fetched.content);
          const count = await countSourcesByPost(collectingPostId);
          await ctx.reply(`✅ Ссылка добавлена: ${fetched.title}\n📋 Источников: ${count}/${MAX_POST_SOURCES}`);
        } else {
          // Save URL as text source if fetch failed
          await addSource(collectingPostId, "link", url, url);
          const count = await countSourcesByPost(collectingPostId);
          await ctx.reply(`✅ Ссылка сохранена (не удалось загрузить содержимое).\n📋 Источников: ${count}/${MAX_POST_SOURCES}`);
        }
        return true;
      }

      // Check for forwarded message
      const msg = ctx.message as unknown as Record<string, unknown>;
      if (msg.forward_origin || msg.forward_from || msg.forward_from_chat) {
        await addSource(collectingPostId, "forward", text, "Пересланное сообщение");
        const count = await countSourcesByPost(collectingPostId);
        await ctx.reply(`✅ Пересланное сообщение добавлено.\n📋 Источников: ${count}/${MAX_POST_SOURCES}`);
        return true;
      }

      // Plain text source
      await addSource(collectingPostId, "text", text);
      const count = await countSourcesByPost(collectingPostId);
      await ctx.reply(`✅ Текст добавлен.\n📋 Источников: ${count}/${MAX_POST_SOURCES}`);
      return true;
    } catch (err) {
      log.error("Collecting source error:", err);
      if (err instanceof Error && err.message.includes("Source limit")) {
        await ctx.reply(`📋 Достигнут лимит источников (${MAX_POST_SOURCES}).`);
      } else {
        await ctx.reply("Ошибка при добавлении материала.");
      }
      return true;
    }
  }

  return false;
}

// ─── Voice Handler ─────────────────────────────────────────────────────

/** Handle voice transcript in blogger mode. */
export async function handleBloggerVoice(
  ctx: Context,
  transcript: string,
  statusMsgId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const collectingPostId = collectingStates.get(telegramId);
  if (collectingPostId == null) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      "✍️ Голосовые материалы доступны только при сборе источников для поста.\nСоздайте пост и отправляйте голосовые."
    );
    return;
  }

  try {
    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) return;

    const currentCount = await countSourcesByPost(collectingPostId);
    if (currentCount >= MAX_POST_SOURCES) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        `📋 Достигнут лимит источников (${MAX_POST_SOURCES}).`
      );
      return;
    }

    const voiceText = transcript.trim();
    if (voiceText.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        "Не удалось распознать голосовое сообщение."
      );
      return;
    }

    await addSource(collectingPostId, "voice", voiceText, "Голосовая заметка");
    const count = await countSourcesByPost(collectingPostId);

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      `🎤 ✅ Голосовая заметка добавлена.\n📋 Источников: ${count}/${MAX_POST_SOURCES}`
    );
  } catch (err) {
    log.error("handleBloggerVoice error:", err);
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      "Ошибка при добавлении голосовой заметки."
    );
  }
}

// ─── Private helpers ───────────────────────────────────────────────────

async function showChannelDetails(ctx: Context, channelId: number, userId: number): Promise<void> {
  const channel = await getChannelById(channelId, userId);
  if (!channel) {
    try {
      await ctx.editMessageText("Канал не найден.");
    } catch {
      await ctx.reply("Канал не найден.");
    }
    return;
  }

  const nicheText = channel.nicheDescription
    ? escapeMarkdown(channel.nicheDescription)
    : "_не указана_";

  const usernameText = channel.channelUsername
    ? `Username: ${escapeMarkdown(channel.channelUsername)}\n`
    : "";

  let styleText: string;
  if (channel.styleSamples) {
    try {
      const count = (JSON.parse(channel.styleSamples) as string[]).length;
      styleText = `📖 Стиль: загружено ${count} примеров`;
    } catch {
      styleText = "📖 Стиль: загружен";
    }
  } else {
    styleText = "📖 Стиль: не загружен";
  }

  const text =
    `📺 *${escapeMarkdown(channel.channelTitle)}*\n` +
    usernameText +
    `Ниша: ${nicheText}\n` +
    styleText;

  const buttons = [
    [Markup.button.callback("✍️ Новый пост", `blog_new_post:${channelId}`)],
    [Markup.button.callback("📄 Посты канала", `blog_ch_posts:${channelId}:0`)],
    [Markup.button.callback("✏️ Изменить описание", `blog_edit_niche:${channelId}`)],
    [Markup.button.callback("📖 Загрузить стиль из канала", `blog_fetch_style:${channelId}`)],
    [Markup.button.callback("🗑 Удалить", `blog_ch_del:${channelId}`)],
  ];

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

async function showChannelPosts(
  ctx: Context,
  channelId: number,
  userId: number,
  offset: number
): Promise<void> {
  const channel = await getChannelById(channelId, userId);
  if (!channel) {
    try {
      await ctx.editMessageText("Канал не найден.");
    } catch {
      await ctx.reply("Канал не найден.");
    }
    return;
  }

  const posts = await getPostsByChannel(channelId, PAGE_SIZE, offset);

  if (posts.length === 0 && offset === 0) {
    try {
      await ctx.editMessageText(
        `📄 У канала «${escapeMarkdown(channel.channelTitle)}» пока нет постов.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("✍️ Новый пост", `blog_new_post:${channelId}`)],
            [Markup.button.callback("« Назад", `blog_ch:${channelId}`)],
          ]),
        }
      );
    } catch {
      await ctx.reply("Постов пока нет.");
    }
    return;
  }

  const buttons = posts.map((p) => {
    const icon = statusIcon(p.status);
    const topicSlice = p.topic.length > 40 ? p.topic.slice(0, 40) + "…" : p.topic;
    return [Markup.button.callback(`${icon} ${topicSlice}`, `blog_post:${p.id}`)];
  });

  // Pagination
  const navRow: ReturnType<typeof Markup.button.callback>[] = [];
  if (offset > 0) {
    navRow.push(Markup.button.callback("⬅️", `blog_ch_posts:${channelId}:${Math.max(0, offset - PAGE_SIZE)}`));
  }
  if (posts.length === PAGE_SIZE) {
    navRow.push(Markup.button.callback("➡️", `blog_ch_posts:${channelId}:${offset + PAGE_SIZE}`));
  }
  if (navRow.length > 0) buttons.push(navRow);

  buttons.push([Markup.button.callback("« Назад", `blog_ch:${channelId}`)]);

  try {
    await ctx.editMessageText(
      `📄 *Посты канала «${escapeMarkdown(channel.channelTitle)}»:*`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(buttons),
      }
    );
  } catch {
    await ctx.reply(`📄 *Посты канала «${escapeMarkdown(channel.channelTitle)}»:*`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  }
}

async function showPostDetails(ctx: Context, postId: number, userId: number): Promise<void> {
  const post = await getPostById(postId, userId);
  if (!post) {
    try {
      await ctx.editMessageText("Пост не найден.");
    } catch {
      await ctx.reply("Пост не найден.");
    }
    return;
  }

  const sourceCount = await countSourcesByPost(postId);
  const icon = statusIcon(post.status);

  const text =
    `${icon} *Пост*\n` +
    `Тема: ${escapeMarkdown(post.topic)}\n` +
    `Статус: ${post.status}\n` +
    `Источников: ${sourceCount}`;

  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

  if (post.status === "collecting") {
    buttons.push(
      [Markup.button.callback("🔍 Поиск по теме (Tavily)", `blog_search:${postId}`)],
      [Markup.button.callback(`📋 Источники (${sourceCount})`, `blog_sources:${postId}`)],
      [Markup.button.callback("✨ Сгенерировать пост", `blog_gen:${postId}`)],
      [Markup.button.callback("🗑 Отменить", `blog_post_del:${postId}`)]
    );
  } else if (post.status === "generated") {
    buttons.push(
      [Markup.button.callback("🔄 Перегенерировать", `blog_regen:${postId}`)],
      [Markup.button.callback("📢 Опубликовать", `blog_publish:${postId}`)],
      [Markup.button.callback("✅ Готово", `blog_post_done:${postId}`)]
    );
  } else if (post.status === "published") {
    buttons.push(
      [Markup.button.callback("👁 Просмотреть пост", `blog_preview:${postId}`)],
      [Markup.button.callback("🔄 Перегенерировать", `blog_regen:${postId}`)],
      [Markup.button.callback("🗑 Удалить", `blog_post_del:${postId}`)]
    );
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

async function showSources(ctx: Context, postId: number, userId: number): Promise<void> {
  const post = await getPostById(postId, userId);
  if (!post) {
    try {
      await ctx.editMessageText("Пост не найден.");
    } catch {
      await ctx.reply("Пост не найден.");
    }
    return;
  }

  const sources = await getSourcesByPost(postId);

  if (sources.length === 0) {
    try {
      await ctx.editMessageText("📋 Источников пока нет.", {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("« Назад к посту", `blog_post:${postId}`)],
        ]),
      });
    } catch {
      await ctx.reply("📋 Источников пока нет.");
    }
    return;
  }

  const typeLabels: Record<string, string> = {
    text: "📝 Текст",
    voice: "🎤 Голос",
    link: "🔗 Ссылка",
    forward: "↩️ Пересланное",
    web_search: "🌐 Поиск",
  };

  const lines = sources.map((s, i) => {
    const label = typeLabels[s.sourceType] ?? "📄 Источник";
    const title = s.title ? ` — ${s.title}` : "";
    const preview = s.content.length > 60 ? s.content.slice(0, 60) + "…" : s.content;
    return `${i + 1}. ${label}${title}\n   ${preview}`;
  });

  const buttons = sources.map((s, i) => [
    Markup.button.callback(`🗑 Удалить #${i + 1}`, `blog_src_del:${s.id}`),
  ]);
  buttons.push([Markup.button.callback("« Назад к посту", `blog_post:${postId}`)]);

  const text = `📋 *Источники (${sources.length}):*\n\n${lines.join("\n\n")}`;

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

async function handleSearchForPost(ctx: Context, postId: number, userId: number): Promise<void> {
  const post = await getPostById(postId, userId);
  if (!post) {
    await ctx.reply("Пост не найден.");
    return;
  }

  const currentCount = await countSourcesByPost(postId);
  if (currentCount >= MAX_POST_SOURCES) {
    await ctx.reply(`📋 Достигнут лимит источников (${MAX_POST_SOURCES}).`);
    return;
  }

  await ctx.reply("🔍 Ищу материалы по теме…");

  const results = await searchForTopic(post.topic);

  if (results.length === 0) {
    await ctx.reply("🔍 Ничего не найдено по теме.");
    return;
  }

  let added = 0;
  for (const result of results) {
    const count = await countSourcesByPost(postId);
    if (count >= MAX_POST_SOURCES) break;

    try {
      await addSource(
        postId,
        "web_search",
        result.url,
        result.title,
        result.content
      );
      added++;
    } catch (err) {
      if (err instanceof Error && err.message.includes("Source limit")) break;
      log.error("Failed to add search source:", err);
    }
  }

  const totalCount = await countSourcesByPost(postId);
  await ctx.reply(
    `🔍 Добавлено ${added} результатов поиска.\n📋 Источников: ${totalCount}/${MAX_POST_SOURCES}`
  );
}

async function handleGeneratePost(ctx: Context, postId: number, userId: number): Promise<void> {
  const post = await getPostById(postId, userId);
  if (!post) {
    await ctx.reply("Пост не найден.");
    return;
  }

  const channel = await getChannelById(post.channelId, userId);
  if (!channel) {
    await ctx.reply("Канал не найден.");
    return;
  }

  const sources = await getSourcesByPost(postId);
  if (sources.length === 0) {
    await ctx.reply("⚠️ Добавьте хотя бы один источник перед генерацией.");
    return;
  }

  await updatePostStatus(postId, userId, "generating");

  try {
    await ctx.reply("⏳ Генерирую пост… Это может занять минуту.");
  } catch { /* ignore */ }

  try {
    const generatedText = await generatePost(channel, post, sources);
    await updatePostGenerated(postId, userId, generatedText, BLOGGER_MODEL);

    const messages = splitIntoMessages(generatedText);
    for (const msgText of messages) {
      await ctx.reply(msgText, { parse_mode: "HTML" });
    }

    // Show post controls after generation
    await ctx.reply("✅ Пост сгенерирован.", {
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Перегенерировать", `blog_regen:${postId}`)],
        [Markup.button.callback("📢 Опубликовать", `blog_publish:${postId}`)],
        [Markup.button.callback("✅ Готово", `blog_post_done:${postId}`)],
      ]),
    });
  } catch (err) {
    log.error("Post generation error:", err);
    await updatePostStatus(postId, userId, "collecting");
    await ctx.reply("❌ Ошибка при генерации поста. Попробуйте ещё раз.");
  }
}

async function handlePreviewPost(ctx: Context, postId: number, userId: number): Promise<void> {
  const post = await getPostById(postId, userId);
  if (!post) {
    await ctx.reply("Пост не найден.");
    return;
  }

  if (!post.generatedText) {
    await ctx.reply("⚠️ У поста нет сгенерированного текста.");
    return;
  }

  const messages = splitIntoMessages(post.generatedText);
  for (const msgText of messages) {
    await ctx.reply(msgText, { parse_mode: "HTML" });
  }

  await ctx.reply("👁 Просмотр поста.", {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("🔄 Перегенерировать", `blog_regen:${postId}`)],
      [Markup.button.callback("📢 Опубликовать повторно", `blog_publish:${postId}`)],
      [Markup.button.callback("✅ Готово", `blog_post_done:${postId}`)],
    ]),
  });
}

async function handlePublishPost(ctx: Context, postId: number, userId: number): Promise<void> {
  const post = await getPostById(postId, userId);
  if (!post) {
    await ctx.reply("Пост не найден.");
    return;
  }

  if (!post.generatedText) {
    await ctx.reply("⚠️ Пост ещё не сгенерирован.");
    return;
  }

  const channel = await getChannelById(post.channelId, userId);
  if (!channel) {
    await ctx.reply("Канал не найден.");
    return;
  }

  // Determine channel target (must start with @)
  let channelTarget = channel.channelUsername ?? channel.channelTitle;
  if (!channelTarget.startsWith("@")) {
    channelTarget = `@${channelTarget}`;
  }

  try {
    const messages = splitIntoMessages(post.generatedText);
    for (const msgText of messages) {
      await ctx.telegram.sendMessage(channelTarget, msgText, { parse_mode: "HTML" });
    }

    await updatePostStatus(postId, userId, "published");
    await ctx.reply(`📢 Пост опубликован в ${escapeMarkdown(channelTarget)}!`, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    log.error("Publish error:", err);

    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("chat not found")) {
      await ctx.reply(
        "❌ Канал не найден. Проверьте, что @username указан верно и бот добавлен в канал как администратор."
      );
    } else if (errMsg.includes("not enough rights")) {
      await ctx.reply(
        "❌ У бота недостаточно прав для публикации. Добавьте бота администратором канала с правом отправки сообщений."
      );
    } else {
      await ctx.reply("❌ Ошибка при публикации. Проверьте настройки канала и права бота.");
    }
  }
}
