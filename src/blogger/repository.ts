import { and, count, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle.js";
import { bloggerChannels, bloggerPosts, bloggerSources, users } from "../db/schema.js";
import { MAX_BLOGGER_CHANNELS, MAX_POST_SOURCES } from "../constants.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface BloggerChannel {
  id: number;
  userId: number;
  channelUsername: string | null;
  channelTitle: string;
  nicheDescription: string | null;
  styleSamples: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  postCount?: number;
}

export interface BloggerPost {
  id: number;
  channelId: number;
  userId: number;
  topic: string;
  status: string;
  generatedText: string | null;
  modelUsed: string | null;
  createdAt: Date;
  updatedAt: Date;
  generatedAt: Date | null;
  sourceCount?: number;
}

export interface BloggerSource {
  id: number;
  postId: number;
  sourceType: string;
  content: string;
  title: string | null;
  parsedContent: string | null;
  createdAt: Date;
}

// ─── Channels ───────────────────────────────────────────────────────────

export async function createChannel(
  userId: number,
  channelTitle: string,
  channelUsername?: string,
  nicheDescription?: string
): Promise<BloggerChannel> {
  const count = await countChannelsByUser(userId);
  if (count >= MAX_BLOGGER_CHANNELS) {
    throw new Error(`Channel limit reached (max ${MAX_BLOGGER_CHANNELS})`);
  }

  const [row] = await db
    .insert(bloggerChannels)
    .values({
      userId,
      channelTitle,
      channelUsername: channelUsername ?? null,
      nicheDescription: nicheDescription ?? null,
    })
    .returning();
  return mapChannel(row);
}

export async function getChannelsByUser(userId: number): Promise<BloggerChannel[]> {
  const rows = await db
    .select({
      ...getTableColumns(bloggerChannels),
      postCount: sql<number>`count(${bloggerPosts.id})`.mapWith(Number),
    })
    .from(bloggerChannels)
    .leftJoin(bloggerPosts, eq(bloggerPosts.channelId, bloggerChannels.id))
    .where(and(eq(bloggerChannels.userId, userId), eq(bloggerChannels.isActive, true)))
    .groupBy(bloggerChannels.id)
    .orderBy(desc(bloggerChannels.createdAt));
  return rows.map((r) => ({
    ...mapChannel(r),
    postCount: r.postCount,
  }));
}

export async function getChannelById(
  channelId: number,
  userId: number
): Promise<BloggerChannel | null> {
  const [row] = await db
    .select()
    .from(bloggerChannels)
    .where(
      and(
        eq(bloggerChannels.id, channelId),
        eq(bloggerChannels.userId, userId),
        eq(bloggerChannels.isActive, true)
      )
    );
  if (!row) return null;
  return mapChannel(row);
}

export async function updateChannel(
  channelId: number,
  userId: number,
  updates: { channelTitle?: string; channelUsername?: string | null; nicheDescription?: string | null }
): Promise<BloggerChannel | null> {
  const set: PgUpdateSetSource<typeof bloggerChannels> = {};
  if (updates.channelTitle !== undefined) set.channelTitle = updates.channelTitle;
  if (updates.channelUsername !== undefined) set.channelUsername = updates.channelUsername;
  if (updates.nicheDescription !== undefined) set.nicheDescription = updates.nicheDescription;

  if (Object.keys(set).length === 0) return getChannelById(channelId, userId);

  set.updatedAt = sql`now()`;
  const [row] = await db
    .update(bloggerChannels)
    .set(set)
    .where(
      and(
        eq(bloggerChannels.id, channelId),
        eq(bloggerChannels.userId, userId),
        eq(bloggerChannels.isActive, true)
      )
    )
    .returning();
  if (!row) return null;
  return mapChannel(row);
}

export async function deleteChannel(
  channelId: number,
  userId: number
): Promise<boolean> {
  const rows = await db
    .update(bloggerChannels)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(
      and(
        eq(bloggerChannels.id, channelId),
        eq(bloggerChannels.userId, userId),
        eq(bloggerChannels.isActive, true)
      )
    )
    .returning({ id: bloggerChannels.id });
  return rows.length > 0;
}

export async function countChannelsByUser(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(bloggerChannels)
    .where(and(eq(bloggerChannels.userId, userId), eq(bloggerChannels.isActive, true)));
  return row.value;
}

export async function updateChannelStyleSamples(
  channelId: number,
  userId: number,
  samples: string[]
): Promise<void> {
  const serialized = JSON.stringify(samples);
  await db
    .update(bloggerChannels)
    .set({ styleSamples: serialized, updatedAt: sql`now()` })
    .where(
      and(
        eq(bloggerChannels.id, channelId),
        eq(bloggerChannels.userId, userId),
        eq(bloggerChannels.isActive, true)
      )
    );
}

// ─── Posts ───────────────────────────────────────────────────────────────

export async function createPost(
  channelId: number,
  userId: number,
  topic: string,
  status: string = "collecting"
): Promise<BloggerPost> {
  const [row] = await db
    .insert(bloggerPosts)
    .values({ channelId, userId, topic, status })
    .returning();
  return mapPost(row);
}

export async function getPostsByChannel(
  channelId: number,
  limit: number = 5,
  offset: number = 0
): Promise<BloggerPost[]> {
  const rows = await db
    .select({
      ...getTableColumns(bloggerPosts),
      sourceCount: sql<number>`count(${bloggerSources.id})`.mapWith(Number),
    })
    .from(bloggerPosts)
    .leftJoin(bloggerSources, eq(bloggerSources.postId, bloggerPosts.id))
    .where(eq(bloggerPosts.channelId, channelId))
    .groupBy(bloggerPosts.id)
    .orderBy(desc(bloggerPosts.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    ...mapPost(r),
    sourceCount: r.sourceCount,
  }));
}

export async function getPostsByUser(
  userId: number,
  limit: number = 5,
  offset: number = 0
): Promise<BloggerPost[]> {
  const rows = await db
    .select({
      ...getTableColumns(bloggerPosts),
      sourceCount: sql<number>`count(${bloggerSources.id})`.mapWith(Number),
    })
    .from(bloggerPosts)
    .leftJoin(bloggerSources, eq(bloggerSources.postId, bloggerPosts.id))
    .where(eq(bloggerPosts.userId, userId))
    .groupBy(bloggerPosts.id)
    .orderBy(desc(bloggerPosts.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    ...mapPost(r),
    sourceCount: r.sourceCount,
  }));
}

export async function getPostById(
  postId: number,
  userId: number
): Promise<BloggerPost | null> {
  const [row] = await db
    .select()
    .from(bloggerPosts)
    .where(and(eq(bloggerPosts.id, postId), eq(bloggerPosts.userId, userId)));
  if (!row) return null;
  return mapPost(row);
}

export async function updatePostStatus(
  postId: number,
  userId: number,
  status: string
): Promise<void> {
  await db
    .update(bloggerPosts)
    .set({ status, updatedAt: sql`now()` })
    .where(and(eq(bloggerPosts.id, postId), eq(bloggerPosts.userId, userId)));
}

export async function updatePostGenerated(
  postId: number,
  userId: number,
  generatedText: string,
  modelUsed: string
): Promise<void> {
  await db
    .update(bloggerPosts)
    .set({
      generatedText,
      modelUsed,
      status: "generated",
      generatedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(bloggerPosts.id, postId), eq(bloggerPosts.userId, userId)));
}

export async function deletePost(
  postId: number,
  userId: number
): Promise<boolean> {
  const rows = await db
    .delete(bloggerPosts)
    .where(and(eq(bloggerPosts.id, postId), eq(bloggerPosts.userId, userId)))
    .returning({ id: bloggerPosts.id });
  return rows.length > 0;
}

// ─── Sources ────────────────────────────────────────────────────────────

export async function addSource(
  postId: number,
  sourceType: string,
  content: string,
  title?: string,
  parsedContent?: string
): Promise<BloggerSource> {
  const count = await countSourcesByPost(postId);
  if (count >= MAX_POST_SOURCES) {
    throw new Error(`Source limit reached (max ${MAX_POST_SOURCES})`);
  }

  const [row] = await db
    .insert(bloggerSources)
    .values({
      postId,
      sourceType,
      content,
      title: title ?? null,
      parsedContent: parsedContent ?? null,
    })
    .returning();
  return mapSource(row);
}

export async function getSourcesByPost(postId: number): Promise<BloggerSource[]> {
  const rows = await db
    .select()
    .from(bloggerSources)
    .where(eq(bloggerSources.postId, postId))
    .orderBy(bloggerSources.createdAt);
  return rows.map(mapSource);
}

export async function deleteSource(sourceId: number, userId: number): Promise<boolean> {
  const rows = await db
    .delete(bloggerSources)
    .where(
      and(
        eq(bloggerSources.id, sourceId),
        inArray(
          bloggerSources.postId,
          db.select({ id: bloggerPosts.id }).from(bloggerPosts).where(eq(bloggerPosts.userId, userId))
        )
      )
    )
    .returning({ id: bloggerSources.id });
  return rows.length > 0;
}

export async function countSourcesByPost(postId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(bloggerSources)
    .where(eq(bloggerSources.postId, postId));
  return row.value;
}

// ─── Admin functions ────────────────────────────────────────────────────

export async function getAllChannelsPaginated(
  limit: number,
  offset: number
): Promise<Array<BloggerChannel & { firstName: string; postCount: number }>> {
  const rows = await db
    .select({
      ...getTableColumns(bloggerChannels),
      firstName: users.firstName,
      postCount: sql<number>`count(${bloggerPosts.id})`.mapWith(Number),
    })
    .from(bloggerChannels)
    .innerJoin(users, eq(users.id, bloggerChannels.userId))
    .leftJoin(bloggerPosts, eq(bloggerPosts.channelId, bloggerChannels.id))
    .groupBy(bloggerChannels.id, users.firstName)
    .orderBy(desc(bloggerChannels.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    ...mapChannel(r),
    firstName: r.firstName,
    postCount: r.postCount,
  }));
}

export async function countAllChannels(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(bloggerChannels);
  return row.value;
}

export async function bulkDeleteChannels(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .delete(bloggerChannels)
    .where(inArray(bloggerChannels.id, ids))
    .returning({ id: bloggerChannels.id });
  return rows.length;
}

export async function deleteAllChannels(): Promise<number> {
  const rows = await db.delete(bloggerChannels).returning({ id: bloggerChannels.id });
  return rows.length;
}

// ─── Mappers ────────────────────────────────────────────────────────────

function mapChannel(r: typeof bloggerChannels.$inferSelect): BloggerChannel {
  return {
    id: r.id,
    userId: r.userId,
    channelUsername: r.channelUsername,
    channelTitle: r.channelTitle,
    nicheDescription: r.nicheDescription,
    styleSamples: r.styleSamples,
    isActive: r.isActive,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapPost(r: typeof bloggerPosts.$inferSelect): BloggerPost {
  return {
    id: r.id,
    channelId: r.channelId,
    userId: r.userId,
    topic: r.topic,
    status: r.status,
    generatedText: r.generatedText,
    modelUsed: r.modelUsed,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    generatedAt: r.generatedAt,
  };
}

function mapSource(r: typeof bloggerSources.$inferSelect): BloggerSource {
  return {
    id: r.id,
    postId: r.postId,
    sourceType: r.sourceType,
    content: r.content,
    title: r.title,
    parsedContent: r.parsedContent,
    createdAt: r.createdAt,
  };
}
