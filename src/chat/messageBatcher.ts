import type { Context } from "telegraf";
import { NEURO_BATCH_DEBOUNCE_MS, NEURO_BATCH_MAX_WAIT_MS } from "../constants.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("neuro-batcher");

interface PendingBatch {
  messages: Array<{ text: string; ctx: Context; timestamp: number }>;
  timer: ReturnType<typeof setTimeout>;
  dialogId: number;
  dbUserId: number;
  telegramId: number;
  model: string;
  systemPromptOverride?: string;
  firstMessageTime: number;
  onFlush: (batch: FlushedBatch) => Promise<void>;
}

export interface FlushedBatch {
  combinedText: string;
  ctx: Context;
  dialogId: number;
  dbUserId: number;
  telegramId: number;
  model: string;
  systemPromptOverride?: string;
}

/** In-memory map: dbUserId → PendingBatch. */
const batches = new Map<number, PendingBatch>();

/** Flush a batch and call the onFlush callback. */
function flushBatch(dbUserId: number): void {
  const batch = batches.get(dbUserId);
  if (!batch || batch.messages.length === 0) {
    batches.delete(dbUserId);
    return;
  }

  clearTimeout(batch.timer);
  batches.delete(dbUserId);

  const combinedText = batch.messages.map((m) => m.text).join("\n\n");
  const lastCtx = batch.messages[batch.messages.length - 1].ctx;

  const flushed: FlushedBatch = {
    combinedText,
    ctx: lastCtx,
    dialogId: batch.dialogId,
    dbUserId: batch.dbUserId,
    telegramId: batch.telegramId,
    model: batch.model,
    systemPromptOverride: batch.systemPromptOverride,
  };

  batch.onFlush(flushed).catch((err) => {
    log.error("Error in batch onFlush:", err);
  });
}

/** Add a message to the batch. Resets debounce timer. */
export function addMessage(
  dbUserId: number,
  telegramId: number,
  dialogId: number,
  text: string,
  ctx: Context,
  onFlush: (batch: FlushedBatch) => Promise<void>,
  model: string = "",
  systemPromptOverride?: string
): void {
  const now = Date.now();
  const existing = batches.get(dbUserId);

  if (existing) {
    // If dialog changed mid-batch, flush old batch first and start a new one
    if (existing.dialogId !== dialogId) {
      flushBatch(dbUserId);
      // Fall through to create a new batch below
    } else {
      clearTimeout(existing.timer);
      existing.messages.push({ text, ctx, timestamp: now });

      // If max wait exceeded, flush immediately
      if (now - existing.firstMessageTime >= NEURO_BATCH_MAX_WAIT_MS) {
        flushBatch(dbUserId);
        ctx.sendChatAction("typing").catch(() => {});
        return;
      }

      // Reset debounce timer
      existing.timer = setTimeout(() => flushBatch(dbUserId), NEURO_BATCH_DEBOUNCE_MS);
      ctx.sendChatAction("typing").catch(() => {});
      return;
    }
  }

  // Create new batch (either no existing batch, or dialog changed and old was flushed)
  const timer = setTimeout(() => flushBatch(dbUserId), NEURO_BATCH_DEBOUNCE_MS);
  batches.set(dbUserId, {
    messages: [{ text, ctx, timestamp: now }],
    timer,
    dialogId,
    dbUserId,
    telegramId,
    model,
    systemPromptOverride,
    firstMessageTime: now,
    onFlush,
  });

  // Send typing indicator
  ctx.sendChatAction("typing").catch(() => {});
}

/** Cancel a pending batch without flushing. */
export function cancelBatch(dbUserId: number): void {
  const batch = batches.get(dbUserId);
  if (batch) {
    clearTimeout(batch.timer);
    batches.delete(dbUserId);
    log.info(`Cancelled batch for user ${dbUserId} (${batch.messages.length} messages)`);
  }
}

/** Check if user has a pending batch. */
export function hasPendingBatch(dbUserId: number): boolean {
  return batches.has(dbUserId);
}

/** Flush a batch synchronously and return the combined data (for voice/photo/doc). */
export function flushBatchSync(dbUserId: number): FlushedBatch | null {
  const batch = batches.get(dbUserId);
  if (!batch || batch.messages.length === 0) {
    batches.delete(dbUserId);
    return null;
  }

  clearTimeout(batch.timer);
  batches.delete(dbUserId);

  const combinedText = batch.messages.map((m) => m.text).join("\n\n");
  const lastCtx = batch.messages[batch.messages.length - 1].ctx;

  return {
    combinedText,
    ctx: lastCtx,
    dialogId: batch.dialogId,
    dbUserId: batch.dbUserId,
    telegramId: batch.telegramId,
    model: batch.model,
    systemPromptOverride: batch.systemPromptOverride,
  };
}

/** Clear all pending batches (for shutdown). */
export function clearAllBatches(): void {
  for (const [, batch] of batches) {
    clearTimeout(batch.timer);
  }
  batches.clear();
}
