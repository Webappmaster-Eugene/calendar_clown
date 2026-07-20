import { and, count, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle.js";
import { chatDialogs, chatMessages, users } from "../db/schema.js";
import type { ChatProvider } from "../shared/types.js";

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ChatDialog {
  id: number;
  userId: number;
  title: string;
  model: string | null;
  systemPrompt: string | null;
  temperature: number | null;
  maxTokens: number | null;
  theme: string | null;
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

  const [row] = await db.insert(chatDialogs).values({ userId, title }).returning();
  return mapDialog(row);
}

/** Get all active dialogs for a user, ordered by updated_at DESC. Includes message count. */
export async function getDialogsByUser(userId: number): Promise<(ChatDialog & { messageCount: number })[]> {
  const rows = await db
    .select({
      ...getTableColumns(chatDialogs),
      messageCount: sql<number>`count(${chatMessages.id})`.mapWith(Number),
    })
    .from(chatDialogs)
    .leftJoin(chatMessages, eq(chatMessages.dialogId, chatDialogs.id))
    .where(and(eq(chatDialogs.userId, userId), eq(chatDialogs.isActive, true)))
    .groupBy(chatDialogs.id)
    .orderBy(desc(chatDialogs.updatedAt));
  return rows.map((r) => ({ ...mapDialog(r), messageCount: r.messageCount }));
}

/** Get a dialog by ID with ownership check. Returns null if not found or not owned. */
export async function getDialogById(
  dialogId: number,
  userId: number
): Promise<ChatDialog | null> {
  const [row] = await db
    .select()
    .from(chatDialogs)
    .where(
      and(
        eq(chatDialogs.id, dialogId),
        eq(chatDialogs.userId, userId),
        eq(chatDialogs.isActive, true)
      )
    );
  return row ? mapDialog(row) : null;
}

/** Update dialog title and updated_at. */
export async function updateDialogTitle(
  dialogId: number,
  title: string
): Promise<void> {
  await db
    .update(chatDialogs)
    .set({ title, updatedAt: sql`now()` })
    .where(eq(chatDialogs.id, dialogId));
}

/**
 * Rename a dialog with an ownership check. Returns true if a row was updated,
 * false if the dialog was not found, not owned, or already deleted.
 */
export async function renameDialog(
  dialogId: number,
  userId: number,
  title: string
): Promise<boolean> {
  const rows = await db
    .update(chatDialogs)
    .set({ title, updatedAt: sql`now()` })
    .where(
      and(
        eq(chatDialogs.id, dialogId),
        eq(chatDialogs.userId, userId),
        eq(chatDialogs.isActive, true)
      )
    )
    .returning({ id: chatDialogs.id });
  return rows.length > 0;
}

/**
 * Update any subset of a dialog's settings (title + per-dialog AI overrides), with
 * an ownership check. Only keys present in `patch` are written; `null` clears an
 * override. Returns the updated dialog, or null if not found / not owned.
 */
export async function updateDialogSettings(
  dialogId: number,
  userId: number,
  patch: {
    title?: string;
    model?: string | null;
    systemPrompt?: string | null;
    temperature?: number | null;
    maxTokens?: number | null;
    theme?: string | null;
  }
): Promise<ChatDialog | null> {
  const set: PgUpdateSetSource<typeof chatDialogs> = { updatedAt: sql`now()` };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.model !== undefined) set.model = patch.model;
  if (patch.systemPrompt !== undefined) set.systemPrompt = patch.systemPrompt;
  if (patch.temperature !== undefined) set.temperature = patch.temperature;
  if (patch.maxTokens !== undefined) set.maxTokens = patch.maxTokens;
  if (patch.theme !== undefined) set.theme = patch.theme;

  const [row] = await db
    .update(chatDialogs)
    .set(set)
    .where(and(eq(chatDialogs.id, dialogId), eq(chatDialogs.userId, userId), eq(chatDialogs.isActive, true)))
    .returning();
  return row ? mapDialog(row) : null;
}

/** Soft-delete a dialog (is_active=false). If it was active dialog, switch to latest. */
export async function deleteDialog(
  dialogId: number,
  userId: number
): Promise<void> {
  await db
    .update(chatDialogs)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(and(eq(chatDialogs.id, dialogId), eq(chatDialogs.userId, userId)));

  // If this was the active dialog, switch to latest remaining
  const [userRow] = await db
    .select({ activeDialogId: users.activeDialogId })
    .from(users)
    .where(eq(users.id, userId));

  if (userRow && userRow.activeDialogId === dialogId) {
    const [latestRow] = await db
      .select({ id: chatDialogs.id })
      .from(chatDialogs)
      .where(and(eq(chatDialogs.userId, userId), eq(chatDialogs.isActive, true)))
      .orderBy(desc(chatDialogs.updatedAt))
      .limit(1);
    const newActiveId = latestRow ? latestRow.id : null;
    await db.update(users).set({ activeDialogId: newActiveId }).where(eq(users.id, userId));
  }
}

/** Count active dialogs for a user. */
export async function countActiveDialogs(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(chatDialogs)
    .where(and(eq(chatDialogs.userId, userId), eq(chatDialogs.isActive, true)));
  return row.value;
}

/** Number of messages in a dialog (for the per-dialog message-limit check). */
export async function countDialogMessages(dialogId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(chatMessages)
    .where(eq(chatMessages.dialogId, dialogId));
  return row.value;
}

/** Get active_dialog_id from users. */
export async function getActiveDialogId(userId: number): Promise<number | null> {
  const [row] = await db
    .select({ activeDialogId: users.activeDialogId })
    .from(users)
    .where(eq(users.id, userId));
  return row ? row.activeDialogId : null;
}

/** Set active_dialog_id in users. */
export async function setActiveDialogId(
  userId: number,
  dialogId: number | null
): Promise<void> {
  await db.update(users).set({ activeDialogId: dialogId }).where(eq(users.id, userId));
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
  // Insert the message and touch the dialog's updated_at atomically so a failed
  // touch can't leave the message stranded (and no error is silently swallowed).
  const r = await db.transaction(async (tx) => {
    const [message] = await tx
      .insert(chatMessages)
      .values({
        userId,
        dialogId,
        role,
        content,
        modelUsed: modelUsed ?? null,
        tokensUsed: tokensUsed ?? null,
      })
      .returning();

    await tx
      .update(chatDialogs)
      .set({ updatedAt: sql`now()` })
      .where(eq(chatDialogs.id, dialogId));

    return message;
  });

  return {
    id: r.id,
    userId: r.userId,
    dialogId: r.dialogId,
    role: r.role as "user" | "assistant",
    content: r.content,
    modelUsed: r.modelUsed,
    tokensUsed: r.tokensUsed,
    createdAt: r.createdAt,
  };
}

/** Get recent chat messages for a dialog, ordered oldest-first. */
export async function getRecentMessages(
  dialogId: number,
  limit: number = 20
): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.dialogId, dialogId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
  return rows
    .map((r) => ({
      id: r.id,
      userId: r.userId,
      dialogId: r.dialogId,
      role: r.role as "user" | "assistant",
      content: r.content,
      modelUsed: r.modelUsed,
      tokensUsed: r.tokensUsed,
      createdAt: r.createdAt,
    }))
    .reverse();
}

/** Clear all messages in a specific dialog. Returns number of deleted messages. */
export async function clearDialogHistory(
  dialogId: number,
  userId: number
): Promise<number> {
  const rows = await db
    .delete(chatMessages)
    .where(and(eq(chatMessages.dialogId, dialogId), eq(chatMessages.userId, userId)))
    .returning({ id: chatMessages.id });
  return rows.length;
}

// ─── Admin functions ────────────────────────────────────────────────────────

/** Admin: get all dialogs paginated (all users, with user info). */
export async function getAllDialogsPaginated(
  limit: number,
  offset: number
): Promise<Array<ChatDialog & { firstName: string }>> {
  const rows = await db
    .select({ ...getTableColumns(chatDialogs), firstName: users.firstName })
    .from(chatDialogs)
    .innerJoin(users, eq(users.id, chatDialogs.userId))
    .orderBy(desc(chatDialogs.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({ ...mapDialog(r), firstName: r.firstName }));
}

/** Admin: count all dialogs. */
export async function countAllDialogs(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(chatDialogs);
  return row.value;
}

/** Admin: bulk delete dialogs by IDs. */
export async function bulkDeleteDialogs(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.delete(chatDialogs).where(inArray(chatDialogs.id, ids)).returning({ id: chatDialogs.id });
  return rows.length;
}

/** Admin: delete ALL dialogs. */
export async function deleteAllDialogs(): Promise<number> {
  const rows = await db.delete(chatDialogs).returning({ id: chatDialogs.id });
  return rows.length;
}

// ─── Chat Provider ──────────────────────────────────────────────────────────

/** Get chat provider preference for a user. */
export async function getChatProvider(userId: number): Promise<ChatProvider> {
  const [row] = await db
    .select({ chatProvider: users.chatProvider })
    .from(users)
    .where(eq(users.id, userId));
  const provider = row?.chatProvider;
  if (provider === "paid") return "paid";
  if (provider === "uncensored") return "uncensored";
  return "free";
}

/** Set chat provider preference for a user. */
export async function setChatProvider(userId: number, provider: ChatProvider): Promise<void> {
  await db.update(users).set({ chatProvider: provider }).where(eq(users.id, userId));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapDialog(r: typeof chatDialogs.$inferSelect): ChatDialog {
  return {
    id: r.id,
    userId: r.userId,
    title: r.title,
    model: r.model,
    systemPrompt: r.systemPrompt,
    temperature: r.temperature,
    maxTokens: r.maxTokens,
    theme: r.theme,
    isActive: r.isActive,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
