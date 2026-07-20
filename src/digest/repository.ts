import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle.js";
import { digestChannels, digestPosts, digestRubrics, digestRuns, users } from "../db/schema.js";
import type {
  DigestRubric,
  DigestChannel,
  DigestRun,
  DigestPost,
  DigestRunStatus,
  CreateRubricParams,
  CreateDigestPostParams,
} from "./types.js";

// ─── Limits ──────────────────────────────────────────────────────────────────

export const MAX_RUBRICS_PER_USER = 10;

export const MAX_CHANNELS_PER_RUBRIC = 20;

export const MAX_CHANNELS_TOTAL = parseInt(
  process.env.DIGEST_MAX_CHANNELS_TOTAL ?? "100",
  10
);

// ─── Rubrics ─────────────────────────────────────────────────────────────────

export async function createRubric(params: CreateRubricParams): Promise<DigestRubric> {
  const [row] = await db
    .insert(digestRubrics)
    .values({
      userId: params.userId,
      name: params.name,
      description: params.description,
      emoji: params.emoji,
      keywords: params.keywords,
    })
    .returning();
  return mapRubric(row);
}

export async function getRubricsByUser(userId: number): Promise<DigestRubric[]> {
  const rows = await db
    .select()
    .from(digestRubrics)
    .where(eq(digestRubrics.userId, userId))
    .orderBy(digestRubrics.createdAt);
  return rows.map(mapRubric);
}

export async function getActiveRubricsByUser(userId: number): Promise<DigestRubric[]> {
  const rows = await db
    .select()
    .from(digestRubrics)
    .where(and(eq(digestRubrics.userId, userId), eq(digestRubrics.isActive, true)))
    .orderBy(digestRubrics.createdAt);
  return rows.map(mapRubric);
}

export async function getRubricByIdAndUser(rubricId: number, userId: number): Promise<DigestRubric | null> {
  const [row] = await db
    .select()
    .from(digestRubrics)
    .where(and(eq(digestRubrics.id, rubricId), eq(digestRubrics.userId, userId)));
  return row ? mapRubric(row) : null;
}

export async function getRubricByUserAndName(
  userId: number,
  name: string
): Promise<DigestRubric | null> {
  // Escape LIKE wildcards in user input to prevent unintended matches
  const escapedName = name.replace(/[%_\\]/g, "\\$&");
  const [row] = await db
    .select()
    .from(digestRubrics)
    .where(
      and(
        eq(digestRubrics.userId, userId),
        sql`(lower(${digestRubrics.name}) = lower(${name}) OR lower(trim(${digestRubrics.name})) LIKE '%' || lower(${escapedName}) || '%' ESCAPE '\\')`
      )
    )
    .limit(1);
  return row ? mapRubric(row) : null;
}

export async function countRubricsByUser(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(digestRubrics)
    .where(eq(digestRubrics.userId, userId));
  return row.value;
}

export async function deleteRubric(rubricId: number, userId: number): Promise<boolean> {
  const rows = await db
    .delete(digestRubrics)
    .where(and(eq(digestRubrics.id, rubricId), eq(digestRubrics.userId, userId)))
    .returning({ id: digestRubrics.id });
  return rows.length > 0;
}

export async function toggleRubric(rubricId: number, userId: number, isActive: boolean): Promise<boolean> {
  const rows = await db
    .update(digestRubrics)
    .set({ isActive, updatedAt: sql`now()` })
    .where(and(eq(digestRubrics.id, rubricId), eq(digestRubrics.userId, userId)))
    .returning({ id: digestRubrics.id });
  return rows.length > 0;
}

export async function toggleRubricIsActive(rubricId: number, userId: number): Promise<DigestRubric | null> {
  const [row] = await db
    .update(digestRubrics)
    .set({ isActive: sql`not ${digestRubrics.isActive}`, updatedAt: sql`now()` })
    .where(and(eq(digestRubrics.id, rubricId), eq(digestRubrics.userId, userId)))
    .returning();
  return row ? mapRubric(row) : null;
}

// ─── Channels ────────────────────────────────────────────────────────────────

export async function addChannel(
  rubricId: number,
  channelUsername: string
): Promise<DigestChannel> {
  const clean = channelUsername.replace(/^@/, "").toLowerCase();
  const [row] = await db
    .insert(digestChannels)
    .values({ rubricId, channelUsername: clean })
    .onConflictDoUpdate({
      target: [digestChannels.rubricId, digestChannels.channelUsername],
      set: { isActive: true },
    })
    .returning();
  return mapChannel(row);
}

export async function getChannelsByRubric(rubricId: number): Promise<DigestChannel[]> {
  const rows = await db
    .select()
    .from(digestChannels)
    .where(and(eq(digestChannels.rubricId, rubricId), eq(digestChannels.isActive, true)))
    .orderBy(digestChannels.addedAt);
  return rows.map(mapChannel);
}

export async function countChannelsByRubric(rubricId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(digestChannels)
    .where(and(eq(digestChannels.rubricId, rubricId), eq(digestChannels.isActive, true)));
  return row.value;
}

export async function countTotalChannels(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(digestChannels)
    .where(eq(digestChannels.isActive, true));
  return row.value;
}

export async function removeChannel(rubricId: number, channelUsername: string): Promise<boolean> {
  const clean = channelUsername.replace(/^@/, "").toLowerCase();
  const rows = await db
    .update(digestChannels)
    .set({ isActive: false })
    .where(and(eq(digestChannels.rubricId, rubricId), eq(digestChannels.channelUsername, clean)))
    .returning({ id: digestChannels.id });
  return rows.length > 0;
}

export async function getChannelById(channelId: number): Promise<DigestChannel | null> {
  const [row] = await db
    .select()
    .from(digestChannels)
    .where(and(eq(digestChannels.id, channelId), eq(digestChannels.isActive, true)));
  return row ? mapChannel(row) : null;
}

export async function removeChannelById(channelId: number, rubricId: number): Promise<boolean> {
  const rows = await db
    .update(digestChannels)
    .set({ isActive: false })
    .where(and(eq(digestChannels.id, channelId), eq(digestChannels.rubricId, rubricId)))
    .returning({ id: digestChannels.id });
  return rows.length > 0;
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export async function createRun(userId: number, rubricId: number): Promise<DigestRun> {
  const [row] = await db
    .insert(digestRuns)
    .values({ userId, rubricId, status: "running", startedAt: sql`now()` })
    .returning();
  return mapRun(row);
}

export async function completeRun(
  runId: number,
  channelsParsed: number,
  postsFound: number,
  postsSelected: number
): Promise<void> {
  await db
    .update(digestRuns)
    .set({
      status: "completed",
      channelsParsed,
      postsFound,
      postsSelected,
      completedAt: sql`now()`,
    })
    .where(eq(digestRuns.id, runId));
}

export async function failRun(runId: number, errorMessage: string): Promise<void> {
  await db
    .update(digestRuns)
    .set({ status: "failed", errorMessage, completedAt: sql`now()` })
    .where(eq(digestRuns.id, runId));
}

// ─── Posts ────────────────────────────────────────────────────────────────────

export async function insertDigestPosts(posts: CreateDigestPostParams[]): Promise<DigestPost[]> {
  if (posts.length === 0) return [];

  const rows = await db
    .insert(digestPosts)
    .values(
      posts.map((p) => ({
        runId: p.runId,
        rubricId: p.rubricId,
        userId: p.userId,
        channelUsername: p.channelUsername,
        channelTitle: p.channelTitle,
        telegramMessageId: BigInt(p.telegramMessageId),
        messageUrl: p.messageUrl,
        originalText: p.originalText,
        summary: p.summary,
        postDate: p.postDate,
        views: p.views,
        forwards: p.forwards,
        reactionsCount: p.reactionsCount,
        commentsCount: p.commentsCount,
        engagementScore: p.engagementScore,
        isFromTrackedChannel: p.isFromTrackedChannel,
      }))
    )
    .onConflictDoNothing({
      target: [digestPosts.runId, digestPosts.channelUsername, digestPosts.telegramMessageId],
    })
    .returning();
  return rows.map(mapPost);
}

export async function getUsersWithActiveDigest(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: digestRubrics.userId })
    .from(digestRubrics)
    .innerJoin(
      digestChannels,
      and(eq(digestChannels.rubricId, digestRubrics.id), eq(digestChannels.isActive, true))
    )
    .where(eq(digestRubrics.isActive, true));
  return rows.map((r) => r.userId);
}

// ─── Admin functions ─────────────────────────────────────────────────────────

export async function updateRubric(
  rubricId: number,
  fields: { name?: string; description?: string | null; emoji?: string | null; keywords?: string[] }
): Promise<boolean> {
  const set: PgUpdateSetSource<typeof digestRubrics> = {};
  if (fields.name !== undefined) set.name = fields.name;
  if (fields.description !== undefined) set.description = fields.description;
  if (fields.emoji !== undefined) set.emoji = fields.emoji;
  if (fields.keywords !== undefined) set.keywords = fields.keywords;

  if (Object.keys(set).length === 0) return false;

  set.updatedAt = sql`now()`;
  const rows = await db
    .update(digestRubrics)
    .set(set)
    .where(eq(digestRubrics.id, rubricId))
    .returning({ id: digestRubrics.id });
  return rows.length > 0;
}

export async function bulkDeleteRubrics(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .delete(digestRubrics)
    .where(inArray(digestRubrics.id, ids))
    .returning({ id: digestRubrics.id });
  return rows.length;
}

export async function deleteAllRubrics(userId?: number): Promise<number> {
  if (userId != null) {
    const rows = await db
      .delete(digestRubrics)
      .where(eq(digestRubrics.userId, userId))
      .returning({ id: digestRubrics.id });
    return rows.length;
  }
  const rows = await db.delete(digestRubrics).returning({ id: digestRubrics.id });
  return rows.length;
}

export async function getAllRubricsPaginated(
  limit: number,
  offset: number
): Promise<Array<DigestRubric & { firstName: string }>> {
  const rows = await db
    .select({ rubric: digestRubrics, firstName: users.firstName })
    .from(digestRubrics)
    .innerJoin(users, eq(users.id, digestRubrics.userId))
    .orderBy(desc(digestRubrics.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({ ...mapRubric(r.rubric), firstName: r.firstName }));
}

export async function countAllRubrics(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(digestRubrics);
  return row.value;
}

// ─── Row mappers ─────────────────────────────────────────────────────────────

function mapRubric(r: typeof digestRubrics.$inferSelect): DigestRubric {
  return {
    id: r.id,
    userId: r.userId,
    name: r.name,
    description: r.description,
    emoji: r.emoji,
    keywords: r.keywords ?? [],
    isActive: r.isActive ?? true,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapChannel(r: typeof digestChannels.$inferSelect): DigestChannel {
  return {
    id: r.id,
    rubricId: r.rubricId,
    channelUsername: r.channelUsername,
    channelTitle: r.channelTitle,
    subscriberCount: r.subscriberCount,
    isActive: r.isActive ?? true,
    addedAt: r.addedAt,
  };
}

function mapRun(r: typeof digestRuns.$inferSelect): DigestRun {
  return {
    id: r.id,
    userId: r.userId,
    rubricId: r.rubricId,
    status: r.status as DigestRunStatus,
    channelsParsed: r.channelsParsed,
    postsFound: r.postsFound,
    postsSelected: r.postsSelected,
    errorMessage: r.errorMessage,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
  };
}

function mapPost(r: typeof digestPosts.$inferSelect): DigestPost {
  return {
    id: r.id,
    runId: r.runId,
    rubricId: r.rubricId,
    userId: r.userId,
    channelUsername: r.channelUsername,
    channelTitle: r.channelTitle,
    telegramMessageId: Number(r.telegramMessageId),
    messageUrl: r.messageUrl,
    originalText: r.originalText,
    summary: r.summary,
    postDate: r.postDate,
    views: r.views,
    forwards: r.forwards,
    reactionsCount: r.reactionsCount,
    commentsCount: r.commentsCount,
    engagementScore: r.engagementScore,
    isFromTrackedChannel: r.isFromTrackedChannel,
    createdAt: r.createdAt,
  };
}
