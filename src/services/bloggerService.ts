/**
 * Blogger business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
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
} from "../blogger/repository.js";
import type { BloggerChannel, BloggerPost, BloggerSource } from "../blogger/repository.js";
import { generatePost } from "../blogger/postGenerator.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { MAX_POST_SOURCES } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type {
  BloggerChannelDto,
  BloggerPostDto,
  BloggerSourceDto,
} from "../shared/types.js";

const log = createLogger("blogger-service");

// ─── Helpers ──────────────────────────────────────────────────

function requireDb(): void {
  if (!isDatabaseAvailable()) {
    throw new Error("База данных недоступна.");
  }
}

async function requireDbUser(telegramId: number) {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) throw new Error("Пользователь не найден.");
  return dbUser;
}

function channelToDto(c: BloggerChannel): BloggerChannelDto {
  return {
    id: c.id,
    channelUsername: c.channelUsername,
    channelTitle: c.channelTitle,
    nicheDescription: c.nicheDescription,
    isActive: c.isActive,
    postCount: c.postCount ?? 0,
    createdAt: c.createdAt.toISOString(),
  };
}

function postToDto(p: BloggerPost): BloggerPostDto {
  return {
    id: p.id,
    channelId: p.channelId,
    topic: p.topic,
    status: p.status,
    generatedText: p.generatedText,
    sourceCount: p.sourceCount ?? 0,
    createdAt: p.createdAt.toISOString(),
    generatedAt: p.generatedAt?.toISOString() ?? null,
  };
}

function sourceToDto(s: BloggerSource): BloggerSourceDto {
  return {
    id: s.id,
    postId: s.postId,
    sourceType: s.sourceType,
    title: s.title,
    content: s.content,
  };
}

// ─── Service Functions ────────────────────────────────────────

/**
 * Get all channels for a user.
 */
export async function getUserChannels(telegramId: number): Promise<BloggerChannelDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const channels = await getChannelsByUser(dbUser.id);
  return channels.map(channelToDto);
}

/**
 * Get a single channel by ID.
 */
export async function getChannel(
  telegramId: number,
  channelId: number
): Promise<BloggerChannelDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const c = await getChannelById(channelId, dbUser.id);
  if (!c) return null;
  return channelToDto(c);
}

/**
 * Create a new channel.
 */
export async function createNewChannel(
  telegramId: number,
  params: { channelTitle: string; channelUsername?: string; nicheDescription?: string }
): Promise<BloggerChannelDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const c = await createChannel(
    dbUser.id,
    params.channelTitle,
    params.channelUsername,
    params.nicheDescription
  );

  return channelToDto(c);
}

/**
 * Delete a channel.
 */
export async function removeChannel(telegramId: number, channelId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return deleteChannel(channelId, dbUser.id);
}

/**
 * Get posts for a channel.
 */
export async function getChannelPosts(
  telegramId: number,
  channelId: number,
  limit: number = 5,
  offset: number = 0
): Promise<BloggerPostDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Verify ownership
  const c = await getChannelById(channelId, dbUser.id);
  if (!c) throw new Error("Канал не найден.");

  const posts = await getPostsByChannel(channelId, limit, offset);
  return posts.map(postToDto);
}

/**
 * Get all posts for a user.
 */
export async function getUserPosts(
  telegramId: number,
  limit: number = 10,
  offset: number = 0
): Promise<BloggerPostDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const posts = await getPostsByUser(dbUser.id, limit, offset);
  return posts.map(postToDto);
}

/**
 * Create a new post (draft) for a channel.
 */
export async function createNewPost(
  telegramId: number,
  channelId: number,
  topic: string
): Promise<BloggerPostDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Verify ownership
  const c = await getChannelById(channelId, dbUser.id);
  if (!c) throw new Error("Канал не найден.");

  const post = await createPost(channelId, dbUser.id, topic);

  return postToDto(post);
}

/**
 * Get a single post by ID.
 */
export async function getPost(
  telegramId: number,
  postId: number
): Promise<BloggerPostDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const p = await getPostById(postId, dbUser.id);
  if (!p) return null;
  return postToDto(p);
}

/**
 * Delete a post.
 */
export async function removePost(telegramId: number, postId: number): Promise<boolean> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return deletePost(postId, dbUser.id);
}

/**
 * Get sources for a post.
 */
export async function getPostSources(
  telegramId: number,
  postId: number
): Promise<BloggerSourceDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Verify ownership via post
  const p = await getPostById(postId, dbUser.id);
  if (!p) throw new Error("Пост не найден.");

  const sources = await getSourcesByPost(postId);
  return sources.map(sourceToDto);
}

/**
 * Add a text source to a post.
 */
export async function addTextSource(
  telegramId: number,
  postId: number,
  content: string,
  title?: string
): Promise<BloggerSourceDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const p = await getPostById(postId, dbUser.id);
  if (!p) throw new Error("Пост не найден.");

  const count = await countSourcesByPost(postId);
  if (count >= MAX_POST_SOURCES) {
    throw new Error(`Достигнут лимит: максимум ${MAX_POST_SOURCES} источников.`);
  }

  const source = await addSource(postId, "text", content, title);

  return sourceToDto(source);
}

/**
 * Generate post text from collected sources.
 */
export async function generatePostText(
  telegramId: number,
  postId: number
): Promise<BloggerPostDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const p = await getPostById(postId, dbUser.id);
  if (!p) throw new Error("Пост не найден.");

  const c = await getChannelById(p.channelId, dbUser.id);
  if (!c) throw new Error("Канал не найден.");

  const sources = await getSourcesByPost(postId);
  if (sources.length === 0) {
    throw new Error("Нет источников для генерации. Добавьте хотя бы один.");
  }

  await updatePostStatus(postId, dbUser.id, "generating");

  try {
    const generated = await generatePost(c, p, sources);

    await updatePostGenerated(postId, dbUser.id, generated, "blogger");
    const updated = await getPostById(postId, dbUser.id);
    return postToDto(updated!);
  } catch (err) {
    await updatePostStatus(postId, dbUser.id, "draft");
    throw err;
  }
}
