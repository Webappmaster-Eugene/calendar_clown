/**
 * CRUD repository for Blogger mode: channels, posts, sources.
 * All queries use raw SQL via query().
 */

import { query } from "../db/connection.js";
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

// ─── Row types ──────────────────────────────────────────────────────────

interface ChannelRow {
  id: number;
  user_id: number;
  channel_username: string | null;
  channel_title: string;
  niche_description: string | null;
  style_samples: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface PostRow {
  id: number;
  channel_id: number;
  user_id: number;
  topic: string;
  status: string;
  generated_text: string | null;
  model_used: string | null;
  created_at: Date;
  updated_at: Date;
  generated_at: Date | null;
}

interface SourceRow {
  id: number;
  post_id: number;
  source_type: string;
  content: string;
  title: string | null;
  parsed_content: string | null;
  created_at: Date;
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

  const { rows } = await query<ChannelRow>(
    `INSERT INTO blogger_channels (user_id, channel_title, channel_username, niche_description)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, channelTitle, channelUsername ?? null, nicheDescription ?? null]
  );
  return mapChannel(rows[0]);
}

export async function getChannelsByUser(userId: number): Promise<BloggerChannel[]> {
  const { rows } = await query<ChannelRow & { post_count: string }>(
    `SELECT bc.*,
       COUNT(bp.id) AS post_count
     FROM blogger_channels bc
     LEFT JOIN blogger_posts bp ON bp.channel_id = bc.id
     WHERE bc.user_id = $1 AND bc.is_active = true
     GROUP BY bc.id
     ORDER BY bc.created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    ...mapChannel(r),
    postCount: parseInt(r.post_count, 10),
  }));
}

export async function getChannelById(
  channelId: number,
  userId: number
): Promise<BloggerChannel | null> {
  const { rows } = await query<ChannelRow>(
    `SELECT * FROM blogger_channels
     WHERE id = $1 AND user_id = $2 AND is_active = true`,
    [channelId, userId]
  );
  if (rows.length === 0) return null;
  return mapChannel(rows[0]);
}

export async function updateChannel(
  channelId: number,
  userId: number,
  updates: { channelTitle?: string; channelUsername?: string; nicheDescription?: string }
): Promise<BloggerChannel | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (updates.channelTitle !== undefined) {
    sets.push(`channel_title = $${idx++}`);
    params.push(updates.channelTitle);
  }
  if (updates.channelUsername !== undefined) {
    sets.push(`channel_username = $${idx++}`);
    params.push(updates.channelUsername);
  }
  if (updates.nicheDescription !== undefined) {
    sets.push(`niche_description = $${idx++}`);
    params.push(updates.nicheDescription);
  }

  if (sets.length === 0) return getChannelById(channelId, userId);

  sets.push(`updated_at = NOW()`);
  params.push(channelId, userId);

  const { rows } = await query<ChannelRow>(
    `UPDATE blogger_channels SET ${sets.join(", ")}
     WHERE id = $${idx++} AND user_id = $${idx} AND is_active = true
     RETURNING *`,
    params
  );
  if (rows.length === 0) return null;
  return mapChannel(rows[0]);
}

export async function deleteChannel(
  channelId: number,
  userId: number
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE blogger_channels SET is_active = false, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND is_active = true`,
    [channelId, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function countChannelsByUser(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM blogger_channels WHERE user_id = $1 AND is_active = true",
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

export async function updateChannelStyleSamples(
  channelId: number,
  userId: number,
  samples: string[]
): Promise<void> {
  const serialized = JSON.stringify(samples);
  await query(
    `UPDATE blogger_channels SET style_samples = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3 AND is_active = true`,
    [serialized, channelId, userId]
  );
}

// ─── Posts ───────────────────────────────────────────────────────────────

export async function createPost(
  channelId: number,
  userId: number,
  topic: string,
  status: string = "collecting"
): Promise<BloggerPost> {
  const { rows } = await query<PostRow>(
    `INSERT INTO blogger_posts (channel_id, user_id, topic, status)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [channelId, userId, topic, status]
  );
  return mapPost(rows[0]);
}

export async function getPostsByChannel(
  channelId: number,
  limit: number = 5,
  offset: number = 0
): Promise<BloggerPost[]> {
  const { rows } = await query<PostRow & { source_count: string }>(
    `SELECT bp.*,
       COUNT(bs.id) AS source_count
     FROM blogger_posts bp
     LEFT JOIN blogger_sources bs ON bs.post_id = bp.id
     WHERE bp.channel_id = $1
     GROUP BY bp.id
     ORDER BY bp.created_at DESC
     LIMIT $2 OFFSET $3`,
    [channelId, limit, offset]
  );
  return rows.map((r) => ({
    ...mapPost(r),
    sourceCount: parseInt(r.source_count, 10),
  }));
}

export async function getPostsByUser(
  userId: number,
  limit: number = 5,
  offset: number = 0
): Promise<BloggerPost[]> {
  const { rows } = await query<PostRow & { source_count: string }>(
    `SELECT bp.*,
       COUNT(bs.id) AS source_count
     FROM blogger_posts bp
     LEFT JOIN blogger_sources bs ON bs.post_id = bp.id
     WHERE bp.user_id = $1
     GROUP BY bp.id
     ORDER BY bp.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows.map((r) => ({
    ...mapPost(r),
    sourceCount: parseInt(r.source_count, 10),
  }));
}

export async function getPostById(
  postId: number,
  userId: number
): Promise<BloggerPost | null> {
  const { rows } = await query<PostRow>(
    `SELECT * FROM blogger_posts WHERE id = $1 AND user_id = $2`,
    [postId, userId]
  );
  if (rows.length === 0) return null;
  return mapPost(rows[0]);
}

export async function updatePostStatus(
  postId: number,
  userId: number,
  status: string
): Promise<void> {
  await query(
    `UPDATE blogger_posts SET status = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3`,
    [status, postId, userId]
  );
}

export async function updatePostGenerated(
  postId: number,
  userId: number,
  generatedText: string,
  modelUsed: string
): Promise<void> {
  await query(
    `UPDATE blogger_posts
     SET generated_text = $1, model_used = $2, status = 'generated',
         generated_at = NOW(), updated_at = NOW()
     WHERE id = $3 AND user_id = $4`,
    [generatedText, modelUsed, postId, userId]
  );
}

export async function deletePost(
  postId: number,
  userId: number
): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM blogger_posts WHERE id = $1 AND user_id = $2",
    [postId, userId]
  );
  return (rowCount ?? 0) > 0;
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

  const { rows } = await query<SourceRow>(
    `INSERT INTO blogger_sources (post_id, source_type, content, title, parsed_content)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [postId, sourceType, content, title ?? null, parsedContent ?? null]
  );
  return mapSource(rows[0]);
}

export async function getSourcesByPost(postId: number): Promise<BloggerSource[]> {
  const { rows } = await query<SourceRow>(
    `SELECT * FROM blogger_sources WHERE post_id = $1 ORDER BY created_at`,
    [postId]
  );
  return rows.map(mapSource);
}

export async function deleteSource(sourceId: number, userId: number): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM blogger_sources
     WHERE id = $1
       AND post_id IN (SELECT id FROM blogger_posts WHERE user_id = $2)`,
    [sourceId, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function countSourcesByPost(postId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM blogger_sources WHERE post_id = $1",
    [postId]
  );
  return parseInt(rows[0].count, 10);
}

// ─── Mappers ────────────────────────────────────────────────────────────

function mapChannel(r: ChannelRow): BloggerChannel {
  return {
    id: r.id,
    userId: r.user_id,
    channelUsername: r.channel_username,
    channelTitle: r.channel_title,
    nicheDescription: r.niche_description,
    styleSamples: r.style_samples,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPost(r: PostRow): BloggerPost {
  return {
    id: r.id,
    channelId: r.channel_id,
    userId: r.user_id,
    topic: r.topic,
    status: r.status,
    generatedText: r.generated_text,
    modelUsed: r.model_used,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    generatedAt: r.generated_at,
  };
}

function mapSource(r: SourceRow): BloggerSource {
  return {
    id: r.id,
    postId: r.post_id,
    sourceType: r.source_type,
    content: r.content,
    title: r.title,
    parsedContent: r.parsed_content,
    createdAt: r.created_at,
  };
}
