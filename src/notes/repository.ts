/**
 * CRUD repository for notes and topics.
 * All note content is encrypted before INSERT, decrypted after SELECT.
 */

import { query } from "../db/connection.js";
import { encrypt, decrypt } from "./encryption.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface NoteTopic {
  id: number;
  userId: number;
  name: string;
  emoji: string;
  createdAt: Date;
}

export type NoteVisibility = "public" | "private";

export interface Note {
  id: number;
  userId: number;
  topicId: number | null;
  content: string;
  isImportant: boolean;
  isUrgent: boolean;
  hasImage: boolean;
  imageFilePath: string | null;
  inputMethod: string;
  visibility: NoteVisibility;
  tribeId: number | null;
  createdAt: Date;
  updatedAt: Date;
  topicName?: string;
  topicEmoji?: string;
  authorName?: string;
}

// ─── Topics ─────────────────────────────────────────────────────────────

export async function createTopic(userId: number, name: string, emoji: string = "📁"): Promise<NoteTopic> {
  const { rows } = await query<{
    id: number; user_id: number; name: string; emoji: string; created_at: Date;
  }>(
    `INSERT INTO note_topics (user_id, name, emoji) VALUES ($1, $2, $3) RETURNING *`,
    [userId, name, emoji]
  );
  return mapTopic(rows[0]);
}

export async function getTopicsByUser(userId: number): Promise<NoteTopic[]> {
  const { rows } = await query<{
    id: number; user_id: number; name: string; emoji: string; created_at: Date;
  }>(
    "SELECT * FROM note_topics WHERE user_id = $1 ORDER BY name",
    [userId]
  );
  return rows.map(mapTopic);
}

export async function getTopicById(topicId: number, userId: number): Promise<NoteTopic | null> {
  const { rows } = await query<{
    id: number; user_id: number; name: string; emoji: string; created_at: Date;
  }>(
    "SELECT * FROM note_topics WHERE id = $1 AND user_id = $2",
    [topicId, userId]
  );
  if (rows.length === 0) return null;
  return mapTopic(rows[0]);
}

export async function deleteTopic(topicId: number, userId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM note_topics WHERE id = $1 AND user_id = $2",
    [topicId, userId]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Notes ──────────────────────────────────────────────────────────────

export async function createNote(params: {
  userId: number;
  topicId: number | null;
  content: string;
  isImportant?: boolean;
  isUrgent?: boolean;
  hasImage?: boolean;
  imageFilePath?: string | null;
  inputMethod?: string;
  visibility?: NoteVisibility;
  tribeId?: number | null;
}): Promise<Note> {
  const encryptedContent = encrypt(params.content);
  const { rows: inserted } = await query<{ id: number }>(
    `INSERT INTO notes (user_id, topic_id, content, is_important, is_urgent, has_image, image_file_path, input_method, visibility, tribe_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      params.userId,
      params.topicId,
      encryptedContent,
      params.isImportant ?? false,
      params.isUrgent ?? false,
      params.hasImage ?? false,
      params.imageFilePath ?? null,
      params.inputMethod ?? "text",
      params.visibility ?? "private",
      params.tribeId ?? null,
    ]
  );
  // Fetch with topic info via JOIN so topicName/topicEmoji are populated
  const { rows } = await query<NoteRow & { topic_name: string | null; topic_emoji: string | null }>(
    `SELECT n.*, t.name AS topic_name, t.emoji AS topic_emoji
     FROM notes n LEFT JOIN note_topics t ON t.id = n.topic_id
     WHERE n.id = $1`,
    [inserted[0].id]
  );
  return mapNoteWithTopic(rows[0]);
}

export async function getNoteById(noteId: number, userId: number): Promise<Note | null> {
  const { rows } = await query<NoteRow & { topic_name: string | null; topic_emoji: string | null }>(
    `SELECT n.*, t.name AS topic_name, t.emoji AS topic_emoji
     FROM notes n LEFT JOIN note_topics t ON t.id = n.topic_id
     WHERE n.id = $1 AND n.user_id = $2`,
    [noteId, userId]
  );
  if (rows.length === 0) return null;
  return mapNoteWithTopic(rows[0]);
}

export async function getNotesByUser(
  userId: number,
  limit: number = 10,
  offset: number = 0
): Promise<Note[]> {
  const { rows } = await query<NoteRow & { topic_name: string | null; topic_emoji: string | null }>(
    `SELECT n.*, t.name AS topic_name, t.emoji AS topic_emoji
     FROM notes n LEFT JOIN note_topics t ON t.id = n.topic_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows.map(mapNoteWithTopic);
}

export async function getNotesByTopic(
  userId: number,
  topicId: number,
  limit: number = 10,
  offset: number = 0
): Promise<Note[]> {
  const { rows } = await query<NoteRow & { topic_name: string | null; topic_emoji: string | null }>(
    `SELECT n.*, t.name AS topic_name, t.emoji AS topic_emoji
     FROM notes n LEFT JOIN note_topics t ON t.id = n.topic_id
     WHERE n.user_id = $1 AND n.topic_id = $2
     ORDER BY n.created_at DESC
     LIMIT $3 OFFSET $4`,
    [userId, topicId, limit, offset]
  );
  return rows.map(mapNoteWithTopic);
}

export async function getNotesByFlag(
  userId: number,
  flag: "important" | "urgent",
  limit: number = 10,
  offset: number = 0
): Promise<Note[]> {
  const column = flag === "important" ? "is_important" : "is_urgent";
  const { rows } = await query<NoteRow & { topic_name: string | null; topic_emoji: string | null }>(
    `SELECT n.*, t.name AS topic_name, t.emoji AS topic_emoji
     FROM notes n LEFT JOIN note_topics t ON t.id = n.topic_id
     WHERE n.user_id = $1 AND n.${column} = true
     ORDER BY n.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows.map(mapNoteWithTopic);
}

export async function countNotesByUser(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM notes WHERE user_id = $1",
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

export async function countNotesByFlag(userId: number, flag: "important" | "urgent"): Promise<number> {
  const column = flag === "important" ? "is_important" : "is_urgent";
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM notes WHERE user_id = $1 AND ${column} = true`,
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

export async function updateNote(
  noteId: number,
  userId: number,
  updates: { content?: string; topicId?: number | null; isImportant?: boolean; isUrgent?: boolean }
): Promise<boolean> {
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let idx = 1;

  if (updates.content !== undefined) {
    sets.push(`content = $${idx++}`);
    params.push(encrypt(updates.content));
  }
  if (updates.topicId !== undefined) {
    sets.push(`topic_id = $${idx++}`);
    params.push(updates.topicId);
  }
  if (updates.isImportant !== undefined) {
    sets.push(`is_important = $${idx++}`);
    params.push(updates.isImportant);
  }
  if (updates.isUrgent !== undefined) {
    sets.push(`is_urgent = $${idx++}`);
    params.push(updates.isUrgent);
  }

  params.push(noteId, userId);

  const { rowCount } = await query(
    `UPDATE notes SET ${sets.join(", ")} WHERE id = $${idx++} AND user_id = $${idx}`,
    params
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteNote(noteId: number, userId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM notes WHERE id = $1 AND user_id = $2",
    [noteId, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function toggleNoteFlag(
  noteId: number,
  userId: number,
  flag: "important" | "urgent"
): Promise<boolean> {
  const column = flag === "important" ? "is_important" : "is_urgent";
  const { rowCount } = await query(
    `UPDATE notes SET ${column} = NOT ${column}, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [noteId, userId]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Public notes (tribe-level) ─────────────────────────────────────────

export async function getPublicNotesByTribe(
  tribeId: number,
  limit: number = 10,
  offset: number = 0
): Promise<Note[]> {
  const { rows } = await query<NoteRow & { topic_name: string | null; topic_emoji: string | null; first_name: string }>(
    `SELECT n.*, t.name AS topic_name, t.emoji AS topic_emoji, u.first_name
     FROM notes n
     LEFT JOIN note_topics t ON t.id = n.topic_id
     JOIN users u ON u.id = n.user_id
     WHERE n.tribe_id = $1 AND n.visibility = 'public'
     ORDER BY n.created_at DESC
     LIMIT $2 OFFSET $3`,
    [tribeId, limit, offset]
  );
  return rows.map((r) => ({ ...mapNoteWithTopic(r), authorName: r.first_name }));
}

export async function countPublicNotesByTribe(tribeId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM notes WHERE tribe_id = $1 AND visibility = 'public'",
    [tribeId]
  );
  return parseInt(rows[0].count, 10);
}

export async function toggleNoteVisibility(noteId: number, userId: number): Promise<NoteVisibility | null> {
  const { rows } = await query<{ visibility: string }>(
    `UPDATE notes SET visibility = CASE WHEN visibility = 'public' THEN 'private' ELSE 'public' END,
     updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING visibility`,
    [noteId, userId]
  );
  if (rows.length === 0) return null;
  return rows[0].visibility as NoteVisibility;
}

export async function appendToNote(noteId: number, tribeId: number, additionalContent: string): Promise<boolean> {
  const { rows } = await query<{ content: string }>(
    "SELECT content FROM notes WHERE id = $1 AND tribe_id = $2 AND visibility = 'public'",
    [noteId, tribeId]
  );
  if (rows.length === 0) return false;
  const decrypted = decrypt(rows[0].content);
  const newContent = encrypt(decrypted + "\n\n" + additionalContent);
  const { rowCount } = await query(
    "UPDATE notes SET content = $1, updated_at = NOW() WHERE id = $2",
    [newContent, noteId]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Admin functions ────────────────────────────────────────────────────

/** Admin: update note content (encrypts). */
export async function updateNoteContent(noteId: number, newContent: string): Promise<boolean> {
  const { rowCount } = await query(
    "UPDATE notes SET content = $1, updated_at = NOW() WHERE id = $2",
    [encrypt(newContent), noteId]
  );
  return (rowCount ?? 0) > 0;
}

/** Admin: bulk delete notes by ID array. */
export async function bulkDeleteNotes(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await query(
    "DELETE FROM notes WHERE id = ANY($1)",
    [ids]
  );
  return rowCount ?? 0;
}

/** Admin: delete all notes (optionally by user). */
export async function deleteAllNotes(userId?: number): Promise<number> {
  if (userId != null) {
    const { rowCount } = await query("DELETE FROM notes WHERE user_id = $1", [userId]);
    return rowCount ?? 0;
  }
  const { rowCount } = await query("DELETE FROM notes");
  return rowCount ?? 0;
}

/** Admin: get all notes paginated (all users). */
export async function getAllNotesPaginated(
  limit: number,
  offset: number
): Promise<Array<Note & { authorName: string }>> {
  const { rows } = await query<NoteRow & { topic_name: string | null; topic_emoji: string | null; first_name: string }>(
    `SELECT n.*, t.name AS topic_name, t.emoji AS topic_emoji, u.first_name
     FROM notes n
     LEFT JOIN note_topics t ON t.id = n.topic_id
     JOIN users u ON u.id = n.user_id
     ORDER BY n.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map((r) => ({ ...mapNoteWithTopic(r), authorName: r.first_name }));
}

/** Admin: count all notes. */
export async function countAllNotes(): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM notes"
  );
  return parseInt(rows[0].count, 10);
}

// ─── Internal ──────────────────────────────────────────────────────────

interface NoteRow {
  id: number;
  user_id: number;
  topic_id: number | null;
  content: string;
  is_important: boolean;
  is_urgent: boolean;
  has_image: boolean;
  image_file_path: string | null;
  input_method: string;
  visibility: string;
  tribe_id: number | null;
  created_at: Date;
  updated_at: Date;
}

function mapTopic(r: { id: number; user_id: number; name: string; emoji: string; created_at: Date }): NoteTopic {
  return { id: r.id, userId: r.user_id, name: r.name, emoji: r.emoji ?? "📁", createdAt: r.created_at };
}

function mapNote(r: NoteRow): Note {
  return {
    id: r.id,
    userId: r.user_id,
    topicId: r.topic_id,
    content: decrypt(r.content),
    isImportant: r.is_important,
    isUrgent: r.is_urgent,
    hasImage: r.has_image,
    imageFilePath: r.image_file_path,
    inputMethod: r.input_method,
    visibility: (r.visibility ?? "private") as NoteVisibility,
    tribeId: r.tribe_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapNoteWithTopic(r: NoteRow & { topic_name: string | null; topic_emoji: string | null }): Note {
  return {
    ...mapNote(r),
    topicName: r.topic_name ?? undefined,
    topicEmoji: r.topic_emoji ?? undefined,
  };
}
