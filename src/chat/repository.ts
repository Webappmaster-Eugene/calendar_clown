import { query } from "../db/connection.js";

export interface ChatMessage {
  id: number;
  userId: number;
  role: "user" | "assistant";
  content: string;
  modelUsed: string | null;
  tokensUsed: number | null;
  createdAt: Date;
}

/** Save a chat message to the database. */
export async function saveMessage(
  userId: number,
  role: "user" | "assistant",
  content: string,
  modelUsed?: string,
  tokensUsed?: number
): Promise<ChatMessage> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    role: string;
    content: string;
    model_used: string | null;
    tokens_used: number | null;
    created_at: Date;
  }>(
    `INSERT INTO chat_messages (user_id, role, content, model_used, tokens_used)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, role, content, model_used, tokens_used, created_at`,
    [userId, role, content, modelUsed ?? null, tokensUsed ?? null]
  );
  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    role: r.role as "user" | "assistant",
    content: r.content,
    modelUsed: r.model_used,
    tokensUsed: r.tokens_used,
    createdAt: r.created_at,
  };
}

/** Get recent chat messages for a user, ordered oldest-first. */
export async function getRecentMessages(
  userId: number,
  limit: number = 10
): Promise<ChatMessage[]> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    role: string;
    content: string;
    model_used: string | null;
    tokens_used: number | null;
    created_at: Date;
  }>(
    `SELECT id, user_id, role, content, model_used, tokens_used, created_at
     FROM chat_messages
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows
    .map((r) => ({
      id: r.id,
      userId: r.user_id,
      role: r.role as "user" | "assistant",
      content: r.content,
      modelUsed: r.model_used,
      tokensUsed: r.tokens_used,
      createdAt: r.created_at,
    }))
    .reverse();
}

/** Clear all chat history for a user. Returns number of deleted messages. */
export async function clearHistory(userId: number): Promise<number> {
  const { rowCount } = await query(
    "DELETE FROM chat_messages WHERE user_id = $1",
    [userId]
  );
  return rowCount ?? 0;
}

/** Count total chat messages for a user. */
export async function countMessages(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM chat_messages WHERE user_id = $1",
    [userId]
  );
  return parseInt(rows[0].count, 10);
}
