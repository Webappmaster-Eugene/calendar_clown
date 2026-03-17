import { query } from "../db/connection.js";
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

/** Max rubrics per user. */
export const MAX_RUBRICS_PER_USER = 10;

/** Max channels per rubric. */
export const MAX_CHANNELS_PER_RUBRIC = 20;

/** Max total channels across all users (rate-limit safety). */
export const MAX_CHANNELS_TOTAL = parseInt(
  process.env.DIGEST_MAX_CHANNELS_TOTAL ?? "100",
  10
);

// ─── Rubrics ─────────────────────────────────────────────────────────────────

export async function createRubric(params: CreateRubricParams): Promise<DigestRubric> {
  const { rows } = await query<RubricRow>(
    `INSERT INTO digest_rubrics (user_id, name, description, emoji, keywords)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.userId, params.name, params.description, params.emoji, params.keywords]
  );
  return mapRubric(rows[0]);
}

export async function getRubricsByUser(userId: number): Promise<DigestRubric[]> {
  const { rows } = await query<RubricRow>(
    "SELECT * FROM digest_rubrics WHERE user_id = $1 ORDER BY created_at",
    [userId]
  );
  return rows.map(mapRubric);
}

export async function getActiveRubricsByUser(userId: number): Promise<DigestRubric[]> {
  const { rows } = await query<RubricRow>(
    "SELECT * FROM digest_rubrics WHERE user_id = $1 AND is_active = true ORDER BY created_at",
    [userId]
  );
  return rows.map(mapRubric);
}

export async function getRubricById(rubricId: number): Promise<DigestRubric | null> {
  const { rows } = await query<RubricRow>(
    "SELECT * FROM digest_rubrics WHERE id = $1",
    [rubricId]
  );
  return rows.length > 0 ? mapRubric(rows[0]) : null;
}

export async function getRubricByUserAndName(
  userId: number,
  name: string
): Promise<DigestRubric | null> {
  const { rows } = await query<RubricRow>(
    "SELECT * FROM digest_rubrics WHERE user_id = $1 AND LOWER(name) = LOWER($2)",
    [userId, name]
  );
  return rows.length > 0 ? mapRubric(rows[0]) : null;
}

export async function countRubricsByUser(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM digest_rubrics WHERE user_id = $1",
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

export async function deleteRubric(rubricId: number, userId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM digest_rubrics WHERE id = $1 AND user_id = $2",
    [rubricId, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function toggleRubric(rubricId: number, userId: number, isActive: boolean): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE digest_rubrics SET is_active = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3",
    [isActive, rubricId, userId]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Channels ────────────────────────────────────────────────────────────────

export async function addChannel(
  rubricId: number,
  channelUsername: string
): Promise<DigestChannel> {
  const clean = channelUsername.replace(/^@/, "").toLowerCase();
  const { rows } = await query<ChannelRow>(
    `INSERT INTO digest_channels (rubric_id, channel_username)
     VALUES ($1, $2)
     ON CONFLICT (rubric_id, channel_username) DO UPDATE SET is_active = true
     RETURNING *`,
    [rubricId, clean]
  );
  return mapChannel(rows[0]);
}

export async function getChannelsByRubric(rubricId: number): Promise<DigestChannel[]> {
  const { rows } = await query<ChannelRow>(
    "SELECT * FROM digest_channels WHERE rubric_id = $1 AND is_active = true ORDER BY added_at",
    [rubricId]
  );
  return rows.map(mapChannel);
}

export async function countChannelsByRubric(rubricId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM digest_channels WHERE rubric_id = $1 AND is_active = true",
    [rubricId]
  );
  return parseInt(rows[0].count, 10);
}

export async function countTotalChannels(): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM digest_channels WHERE is_active = true"
  );
  return parseInt(rows[0].count, 10);
}

export async function removeChannel(rubricId: number, channelUsername: string): Promise<boolean> {
  const clean = channelUsername.replace(/^@/, "").toLowerCase();
  const { rowCount } = await query(
    "UPDATE digest_channels SET is_active = false WHERE rubric_id = $1 AND channel_username = $2",
    [rubricId, clean]
  );
  return (rowCount ?? 0) > 0;
}

export async function updateChannelMeta(
  channelUsername: string,
  title: string | null,
  subscriberCount: number | null
): Promise<void> {
  await query(
    `UPDATE digest_channels SET channel_title = $1, subscriber_count = $2
     WHERE channel_username = $3 AND is_active = true`,
    [title, subscriberCount, channelUsername]
  );
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export async function createRun(userId: number, rubricId: number): Promise<DigestRun> {
  const { rows } = await query<RunRow>(
    `INSERT INTO digest_runs (user_id, rubric_id, status, started_at)
     VALUES ($1, $2, 'running', NOW())
     RETURNING *`,
    [userId, rubricId]
  );
  return mapRun(rows[0]);
}

export async function completeRun(
  runId: number,
  channelsParsed: number,
  postsFound: number,
  postsSelected: number
): Promise<void> {
  await query(
    `UPDATE digest_runs
     SET status = 'completed', channels_parsed = $1, posts_found = $2,
         posts_selected = $3, completed_at = NOW()
     WHERE id = $4`,
    [channelsParsed, postsFound, postsSelected, runId]
  );
}

export async function failRun(runId: number, errorMessage: string): Promise<void> {
  await query(
    `UPDATE digest_runs
     SET status = 'failed', error_message = $1, completed_at = NOW()
     WHERE id = $2`,
    [errorMessage, runId]
  );
}

// ─── Posts ────────────────────────────────────────────────────────────────────

export async function insertDigestPosts(posts: CreateDigestPostParams[]): Promise<DigestPost[]> {
  if (posts.length === 0) return [];

  const results: DigestPost[] = [];
  for (const p of posts) {
    const { rows } = await query<PostRow>(
      `INSERT INTO digest_posts
         (run_id, rubric_id, user_id, channel_username, channel_title,
          telegram_message_id, message_url, original_text, summary,
          post_date, views, forwards, reactions_count, comments_count,
          engagement_score, is_from_tracked_channel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (run_id, channel_username, telegram_message_id) DO NOTHING
       RETURNING *`,
      [
        p.runId, p.rubricId, p.userId, p.channelUsername, p.channelTitle,
        p.telegramMessageId, p.messageUrl, p.originalText, p.summary,
        p.postDate, p.views, p.forwards, p.reactionsCount, p.commentsCount,
        p.engagementScore, p.isFromTrackedChannel,
      ]
    );
    if (rows.length > 0) results.push(mapPost(rows[0]));
  }
  return results;
}

/** Get all users who have at least one active rubric with channels. */
export async function getUsersWithActiveDigest(): Promise<number[]> {
  const { rows } = await query<{ user_id: number }>(
    `SELECT DISTINCT r.user_id
     FROM digest_rubrics r
     JOIN digest_channels c ON c.rubric_id = r.id AND c.is_active = true
     WHERE r.is_active = true`
  );
  return rows.map((r) => r.user_id);
}

// ─── Admin functions ─────────────────────────────────────────────────────────

/** Admin: update rubric fields. */
export async function updateRubric(
  rubricId: number,
  fields: { name?: string; description?: string | null; emoji?: string | null; keywords?: string[] }
): Promise<boolean> {
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let idx = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${idx++}`);
    params.push(fields.name);
  }
  if (fields.description !== undefined) {
    sets.push(`description = $${idx++}`);
    params.push(fields.description);
  }
  if (fields.emoji !== undefined) {
    sets.push(`emoji = $${idx++}`);
    params.push(fields.emoji);
  }
  if (fields.keywords !== undefined) {
    sets.push(`keywords = $${idx++}`);
    params.push(fields.keywords);
  }

  if (sets.length === 1) return false; // only updated_at
  params.push(rubricId);

  const { rowCount } = await query(
    `UPDATE digest_rubrics SET ${sets.join(", ")} WHERE id = $${idx}`,
    params
  );
  return (rowCount ?? 0) > 0;
}

/** Admin: bulk delete rubrics by ID array. */
export async function bulkDeleteRubrics(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await query(
    "DELETE FROM digest_rubrics WHERE id = ANY($1)",
    [ids]
  );
  return rowCount ?? 0;
}

/** Admin: delete all rubrics (optionally by user). */
export async function deleteAllRubrics(userId?: number): Promise<number> {
  if (userId != null) {
    const { rowCount } = await query("DELETE FROM digest_rubrics WHERE user_id = $1", [userId]);
    return rowCount ?? 0;
  }
  const { rowCount } = await query("DELETE FROM digest_rubrics");
  return rowCount ?? 0;
}

/** Admin: get all rubrics paginated (all users). */
export async function getAllRubricsPaginated(
  limit: number,
  offset: number
): Promise<Array<DigestRubric & { firstName: string }>> {
  const { rows } = await query<RubricRow & { first_name: string }>(
    `SELECT r.*, u.first_name
     FROM digest_rubrics r
     JOIN users u ON u.id = r.user_id
     ORDER BY r.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map((r) => ({ ...mapRubric(r), firstName: r.first_name }));
}

/** Admin: count all rubrics. */
export async function countAllRubrics(): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM digest_rubrics"
  );
  return parseInt(rows[0].count, 10);
}

// ─── Row mappers ─────────────────────────────────────────────────────────────

interface RubricRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  emoji: string | null;
  keywords: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapRubric(r: RubricRow): DigestRubric {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    description: r.description,
    emoji: r.emoji,
    keywords: r.keywords ?? [],
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface ChannelRow {
  id: number;
  rubric_id: number;
  channel_username: string;
  channel_title: string | null;
  subscriber_count: number | null;
  is_active: boolean;
  added_at: Date;
}

function mapChannel(r: ChannelRow): DigestChannel {
  return {
    id: r.id,
    rubricId: r.rubric_id,
    channelUsername: r.channel_username,
    channelTitle: r.channel_title,
    subscriberCount: r.subscriber_count,
    isActive: r.is_active,
    addedAt: r.added_at,
  };
}

interface RunRow {
  id: number;
  user_id: number;
  rubric_id: number;
  status: string;
  channels_parsed: number;
  posts_found: number;
  posts_selected: number;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

function mapRun(r: RunRow): DigestRun {
  return {
    id: r.id,
    userId: r.user_id,
    rubricId: r.rubric_id,
    status: r.status as DigestRunStatus,
    channelsParsed: r.channels_parsed,
    postsFound: r.posts_found,
    postsSelected: r.posts_selected,
    errorMessage: r.error_message,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  };
}

interface PostRow {
  id: number;
  run_id: number;
  rubric_id: number;
  user_id: number;
  channel_username: string;
  channel_title: string | null;
  telegram_message_id: number;
  message_url: string | null;
  original_text: string | null;
  summary: string | null;
  post_date: Date;
  views: number;
  forwards: number;
  reactions_count: number;
  comments_count: number;
  engagement_score: number;
  is_from_tracked_channel: boolean;
  created_at: Date;
}

function mapPost(r: PostRow): DigestPost {
  return {
    id: r.id,
    runId: r.run_id,
    rubricId: r.rubric_id,
    userId: r.user_id,
    channelUsername: r.channel_username,
    channelTitle: r.channel_title,
    telegramMessageId: r.telegram_message_id,
    messageUrl: r.message_url,
    originalText: r.original_text,
    summary: r.summary,
    postDate: r.post_date,
    views: r.views,
    forwards: r.forwards,
    reactionsCount: r.reactions_count,
    commentsCount: r.comments_count,
    engagementScore: r.engagement_score,
    isFromTrackedChannel: r.is_from_tracked_channel,
    createdAt: r.created_at,
  };
}
