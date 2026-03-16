/**
 * Throttled progress reporter that updates a Telegram status message in real-time.
 * Prefixes each step with elapsed time [M:SS] and throttles edits to max 1/sec.
 */

import type { Telegraf } from "telegraf";
import type { OnProgressCallback } from "./types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("progress-reporter");

/** Minimum interval between Telegram message edits (ms). */
const THROTTLE_INTERVAL_MS = 1_000;

export interface ProgressReporter {
  onProgress: OnProgressCallback;
  flush: () => Promise<void>;
}

/** Format elapsed milliseconds as [M:SS]. */
function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `[${min}:${sec.toString().padStart(2, "0")}]`;
}

/**
 * Create a progress reporter bound to a Telegram status message.
 * Each call to `onProgress` queues a message edit with elapsed time prefix.
 * At most one `editMessageText` fires per second — only the latest step matters.
 */
export function createProgressReporter(
  bot: Telegraf,
  chatId: number,
  statusMessageId: number
): ProgressReporter {
  const startTime = Date.now();
  let pendingText: string | null = null;
  let lastEditTime = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSentText: string | null = null;

  function doEdit(text: string): void {
    if (text === lastSentText) return;
    lastSentText = text;
    lastEditTime = Date.now();
    bot.telegram
      .editMessageText(chatId, statusMessageId, undefined, text)
      .catch((err) => {
        log.error(`Progress edit failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  function schedulePendingEdit(): void {
    if (pendingText === null) return;
    if (timer !== null) return;

    const elapsed = Date.now() - lastEditTime;
    const delay = Math.max(0, THROTTLE_INTERVAL_MS - elapsed);

    timer = setTimeout(() => {
      timer = null;
      if (pendingText !== null) {
        const text = pendingText;
        pendingText = null;
        doEdit(text);
      }
    }, delay);
  }

  const onProgress: OnProgressCallback = (step: string) => {
    const elapsed = Date.now() - startTime;
    const prefix = formatElapsed(elapsed);
    const text = `${prefix} ${step}`;

    const timeSinceLastEdit = Date.now() - lastEditTime;
    if (timeSinceLastEdit >= THROTTLE_INTERVAL_MS && timer === null) {
      pendingText = null;
      doEdit(text);
    } else {
      pendingText = text;
      schedulePendingEdit();
    }
  };

  async function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pendingText !== null) {
      const text = pendingText;
      pendingText = null;
      if (text !== lastSentText) {
        try {
          await bot.telegram.editMessageText(chatId, statusMessageId, undefined, text);
        } catch {
          // Message may have been deleted — ignore
        }
      }
    }
  }

  return { onProgress, flush };
}
