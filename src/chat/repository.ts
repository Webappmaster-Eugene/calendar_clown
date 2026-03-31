import { query } from "../db/connection.js";
import type { ChatProvider } from "../shared/types.js";

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ChatDialog {
  id: number;
  userId: number;
  title: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: number;
  userId: number;
  dialogId: number;
  role: "user" | "assistant";
  content: string;
  modelUsed: string | null;
  tokensUsed: number | null;
  createdAt: Date;
}

const MAX_DIALOGS = 10;

// ─── Dialog functions ───────────────────────────────────────────────────────

/** Create a new dialog. Throws if user already has MAX_DIALOGS active dialogs. */
export async function createDialog(
  userId: number,
  title: string = "Новый диалог"
): Promise<ChatDialog> {
  const count = await countActiveDialogs(userId);
  if (count >= MAX_DIALOGS) {
    throw new Error(`Достигнут лимит (${MAX_DIALOGS} диалогов). Удалите ненужные, чтобы создать новый.`);
  }

  const { rows } = await query<{
    id: number;
    user_id: number;
    title: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO chat_dialogs (user_id, title)
     VALUES ($1, $2)
     RETURNING id, user_id, title, is_active, created_at, updated_at`,
    [userId, title]
  );
  return mapDialog(rows[0]);
}

/** Get all active dialogs for a user, ordered by updated_at DESC. Includes message count. */
export async function getDialogsByUser(userId: number): Promise<(ChatDialog & { messageCount: number })[]> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    title: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    message_count: string;
  }>(
    `SELECT d.id, d.user_id, d.title, d.is_active, d.created_at, d.updated_at,
            COUNT(m.id) AS message_count
     FROM chat_dialogs d
     LEFT JOIN chat_messages m ON m.dialog_id = d.id
     WHERE d.user_id = $1 AND d.is_active = TRUE
     GROUP BY d.id
     ORDER BY d.updated_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    ...mapDialog(r),
    messageCount: parseInt(r.message_count, 10),
  }));
}

/** Get a dialog by ID with ownership check. Returns null if not found or not owned. */
export async function getDialogById(
  dialogId: number,
  userId: number
): Promise<ChatDialog | null> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    title: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, user_id, title, is_active, created_at, updated_at
     FROM chat_dialogs
     WHERE id = $1 AND user_id = $2 AND is_active = TRUE`,
    [dialogId, userId]
  );
  return rows.length > 0 ? mapDialog(rows[0]) : null;
}

/** Update dialog title and updated_at. */
export async function updateDialogTitle(
  dialogId: number,
  title: string
): Promise<void> {
  await query(
    `UPDATE chat_dialogs SET title = $1, updated_at = NOW() WHERE id = $2`,
    [title, dialogId]
  );
}

/** Soft-delete a dialog (is_active=false). If it was active dialog, switch to latest. */
export async function deleteDialog(
  dialogId: number,
  userId: number
): Promise<void> {
  // Soft delete
  await query(
    `UPDATE chat_dialogs SET is_active = FALSE, updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [dialogId, userId]
  );

  // If this was the active dialog, switch to latest remaining
  const { rows: userRows } = await query<{ active_dialog_id: number | null }>(
    `SELECT active_dialog_id FROM users WHERE id = $1`,
    [userId]
  );

  if (userRows.length > 0 && userRows[0].active_dialog_id === dialogId) {
    const { rows: latestRows } = await query<{ id: number }>(
      `SELECT id FROM chat_dialogs
       WHERE user_id = $1 AND is_active = TRUE
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );
    const newActiveId = latestRows.length > 0 ? latestRows[0].id : null;
    await query(
      `UPDATE users SET active_dialog_id = $1 WHERE id = $2`,
      [newActiveId, userId]
    );
  }
}

/** Count active dialogs for a user. */
export async function countActiveDialogs(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM chat_dialogs
     WHERE user_id = $1 AND is_active = TRUE`,
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

/** Get active_dialog_id from users. */
export async function getActiveDialogId(userId: number): Promise<number | null> {
  const { rows } = await query<{ active_dialog_id: number | null }>(
    `SELECT active_dialog_id FROM users WHERE id = $1`,
    [userId]
  );
  return rows.length > 0 ? rows[0].active_dialog_id : null;
}

/** Set active_dialog_id in users. */
export async function setActiveDialogId(
  userId: number,
  dialogId: number | null
): Promise<void> {
  await query(
    `UPDATE users SET active_dialog_id = $1 WHERE id = $2`,
    [dialogId, userId]
  );
}

/**
 * Key helper: get the active dialog or create the first one.
 * If active_dialog_id is null or points to a deleted dialog, creates a new one.
 */
export async function getOrCreateActiveDialog(userId: number): Promise<ChatDialog> {
  const activeId = await getActiveDialogId(userId);

  if (activeId != null) {
    const dialog = await getDialogById(activeId, userId);
    if (dialog) return dialog;
  }

  // No active dialog or it was deleted — create a new one
  const dialog = await createDialog(userId);
  await setActiveDialogId(userId, dialog.id);
  return dialog;
}

// ─── Message functions ──────────────────────────────────────────────────────

/** Save a chat message to the database. Also updates dialog's updated_at. */
export async function saveMessage(
  userId: number,
  dialogId: number,
  role: "user" | "assistant",
  content: string,
  modelUsed?: string,
  tokensUsed?: number
): Promise<ChatMessage> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    dialog_id: number;
    role: string;
    content: string;
    model_used: string | null;
    tokens_used: number | null;
    created_at: Date;
  }>(
    `INSERT INTO chat_messages (user_id, dialog_id, role, content, model_used, tokens_used)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, dialog_id, role, content, model_used, tokens_used, created_at`,
    [userId, dialogId, role, content, modelUsed ?? null, tokensUsed ?? null]
  );

  // Update dialog's updated_at (fire-and-forget)
  query(
    `UPDATE chat_dialogs SET updated_at = NOW() WHERE id = $1`,
    [dialogId]
  ).catch(() => {});

  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    dialogId: r.dialog_id,
    role: r.role as "user" | "assistant",
    content: r.content,
    modelUsed: r.model_used,
    tokensUsed: r.tokens_used,
    createdAt: r.created_at,
  };
}

/** Get recent chat messages for a dialog, ordered oldest-first. */
export async function getRecentMessages(
  dialogId: number,
  limit: number = 20
): Promise<ChatMessage[]> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    dialog_id: number;
    role: string;
    content: string;
    model_used: string | null;
    tokens_used: number | null;
    created_at: Date;
  }>(
    `SELECT id, user_id, dialog_id, role, content, model_used, tokens_used, created_at
     FROM chat_messages
     WHERE dialog_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [dialogId, limit]
  );
  return rows
    .map((r) => ({
      id: r.id,
      userId: r.user_id,
      dialogId: r.dialog_id,
      role: r.role as "user" | "assistant",
      content: r.content,
      modelUsed: r.model_used,
      tokensUsed: r.tokens_used,
      createdAt: r.created_at,
    }))
    .reverse();
}

/** Clear all messages in a specific dialog. Returns number of deleted messages. */
export async function clearDialogHistory(
  dialogId: number,
  userId: number
): Promise<number> {
  const { rowCount } = await query(
    `DELETE FROM chat_messages
     WHERE dialog_id = $1 AND user_id = $2`,
    [dialogId, userId]
  );
  return rowCount ?? 0;
}

/** Count messages in a specific dialog. */
export async function countDialogMessages(dialogId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM chat_messages WHERE dialog_id = $1`,
    [dialogId]
  );
  return parseInt(rows[0].count, 10);
}

// ─── Admin functions ────────────────────────────────────────────────────────

/** Admin: get all dialogs paginated (all users, with user info). */
export async function getAllDialogsPaginated(
  limit: number,
  offset: number
): Promise<Array<ChatDialog & { firstName: string }>> {
  const { rows } = await query<{
    id: number;
    user_id: number;
    title: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    first_name: string;
  }>(
    `SELECT d.*, u.first_name
     FROM chat_dialogs d
     JOIN users u ON u.id = d.user_id
     ORDER BY d.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map((r) => ({ ...mapDialog(r), firstName: r.first_name }));
}

/** Admin: count all dialogs. */
export async function countAllDialogs(): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM chat_dialogs"
  );
  return parseInt(rows[0].count, 10);
}

/** Admin: bulk delete dialogs by IDs. */
export async function bulkDeleteDialogs(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await query(
    "DELETE FROM chat_dialogs WHERE id = ANY($1)",
    [ids]
  );
  return rowCount ?? 0;
}

/** Admin: delete ALL dialogs. */
export async function deleteAllDialogs(): Promise<number> {
  const { rowCount } = await query("DELETE FROM chat_dialogs");
  return rowCount ?? 0;
}

// ─── Chat Provider ──────────────────────────────────────────────────────────

/** Get chat provider preference for a user. */
export async function getChatProvider(userId: number): Promise<ChatProvider> {
  const { rows } = await query<{ chat_provider: string }>(
    `SELECT chat_provider FROM users WHERE id = $1`,
    [userId]
  );
  const provider = rows[0]?.chat_provider;
  if (provider === "paid") return "paid";
  if (provider === "uncensored") return "uncensored";
  return "free";
}

/** Set chat provider preference for a user. */
export async function setChatProvider(userId: number, provider: ChatProvider): Promise<void> {
  await query(
    `UPDATE users SET chat_provider = $1 WHERE id = $2`,
    [provider, userId]
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapDialog(r: {
  id: number;
  user_id: number;
  title: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}): ChatDialog {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
