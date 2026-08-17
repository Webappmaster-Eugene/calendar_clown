import { and, count, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle.js";
import { chatDialogs, chatMessages, users } from "../db/schema.js";
import { CHAT_MAX_DIALOGS, CHAT_MESSAGE_LIMIT } from "../constants.js";
import type { ChatProvider } from "../shared/types.js";

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ChatDialog {
  id: number;
  userId: number;
  title: string;
  model: string | null;
  systemPrompt: string | null;
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

// ─── Dialog functions ───────────────────────────────────────────────────────

export async function createDialog(
  userId: number,
  title: string = "Новый диалог"
): Promise<ChatDialog> {
  const count = await countActiveDialogs(userId);
  if (count >= CHAT_MAX_DIALOGS) {
    throw new Error(`Достигнут лимит (${CHAT_MAX_DIALOGS} диалогов). Удалите ненужные, чтобы создать новый.`);
  }

  const [row] = await db.insert(chatDialogs).values({ userId, title }).returning();
  return mapDialog(row);
}

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

export async function updateDialogTitle(
  dialogId: number,
  title: string
): Promise<void> {
  await db
    .update(chatDialogs)
    .set({ title, updatedAt: sql`now()` })
    .where(eq(chatDialogs.id, dialogId));
}

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

// Only keys present in `patch` are written; `null` clears an override.
export async function updateDialogSettings(
  dialogId: number,
  userId: number,
  patch: {
    title?: string;
    model?: string | null;
    systemPrompt?: string | null;
  }
): Promise<ChatDialog | null> {
  const set: PgUpdateSetSource<typeof chatDialogs> = { updatedAt: sql`now()` };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.model !== undefined) set.model = patch.model;
  if (patch.systemPrompt !== undefined) set.systemPrompt = patch.systemPrompt;

  const [row] = await db
    .update(chatDialogs)
    .set(set)
    .where(and(eq(chatDialogs.id, dialogId), eq(chatDialogs.userId, userId), eq(chatDialogs.isActive, true)))
    .returning();
  return row ? mapDialog(row) : null;
}

export async function deleteDialog(
  dialogId: number,
  userId: number
): Promise<void> {
  await db
    .update(chatDialogs)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(and(eq(chatDialogs.id, dialogId), eq(chatDialogs.userId, userId)));

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

export async function countActiveDialogs(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(chatDialogs)
    .where(and(eq(chatDialogs.userId, userId), eq(chatDialogs.isActive, true)));
  return row.value;
}

export async function countDialogMessages(dialogId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(chatMessages)
    .where(eq(chatMessages.dialogId, dialogId));
  return row.value;
}

// The cap equals the context window, so hitting it means nothing can be silently
// forgotten — the user must start a new dialog. Shared by the bot and the Mini App
// so a dialog can never become writable from one client and not the other.
export async function isDialogAtMessageLimit(dialogId: number): Promise<boolean> {
  return (await countDialogMessages(dialogId)) >= CHAT_MESSAGE_LIMIT;
}

export async function getActiveDialogId(userId: number): Promise<number | null> {
  const [row] = await db
    .select({ activeDialogId: users.activeDialogId })
    .from(users)
    .where(eq(users.id, userId));
  return row ? row.activeDialogId : null;
}

export async function setActiveDialogId(
  userId: number,
  dialogId: number | null
): Promise<void> {
  await db.update(users).set({ activeDialogId: dialogId }).where(eq(users.id, userId));
}

export async function getOrCreateActiveDialog(userId: number): Promise<ChatDialog> {
  const activeId = await getActiveDialogId(userId);

  if (activeId != null) {
    const dialog = await getDialogById(activeId, userId);
    if (dialog) return dialog;
  }

  const dialog = await createDialog(userId);
  await setActiveDialogId(userId, dialog.id);
  return dialog;
}

// ─── Message functions ──────────────────────────────────────────────────────

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

export async function getRecentMessages(
  dialogId: number,
  limit: number = CHAT_MESSAGE_LIMIT
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

// Ownership is part of the WHERE clause, so a caller can never read a message that
// belongs to another user (used by the share endpoint, which must not accept free text).
export async function getMessageById(
  messageId: number,
  dialogId: number,
  userId: number
): Promise<ChatMessage | null> {
  const [r] = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.id, messageId),
        eq(chatMessages.dialogId, dialogId),
        eq(chatMessages.userId, userId)
      )
    );
  if (!r) return null;
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

export async function countAllDialogs(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(chatDialogs);
  return row.value;
}

export async function bulkDeleteDialogs(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.delete(chatDialogs).where(inArray(chatDialogs.id, ids)).returning({ id: chatDialogs.id });
  return rows.length;
}

export async function deleteAllDialogs(): Promise<number> {
  const rows = await db.delete(chatDialogs).returning({ id: chatDialogs.id });
  return rows.length;
}

// ─── Chat Provider ──────────────────────────────────────────────────────────

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
    isActive: r.isActive,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
