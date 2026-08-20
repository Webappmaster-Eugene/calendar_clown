import type { Telegram } from "telegraf";
import { NEURO_STREAM_EDIT_INTERVAL_MS, NEURO_STREAM_EDIT_MAX_INTERVAL_MS } from "../constants.js";
import { splitMessage, TELEGRAM_MAX_MESSAGE_LENGTH } from "../utils/telegram.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("neuro-stream");

/** Marks the answer as still being written; dropped by the final edit. */
const CURSOR = " ▌";

/** Headroom for the cursor and for Markdown entities the final edit may add. */
const LENGTH_RESERVE = 64;

const EMPTY_ANSWER_TEXT = "🤷 Модель вернула пустой ответ.";

export interface StreamingReplyOptions {
  telegram: Telegram;
  chatId: number;
  /** Status message to grow into the answer. A new message is sent when omitted. */
  messageId?: number;
  /** Kept above the answer in the first message (e.g. the recognised voice text). */
  prefix?: { plain: string; markdown: string };
}

function retryAfterSeconds(err: unknown): number | null {
  const params = (err as { response?: { parameters?: { retry_after?: number } } })?.response?.parameters;
  return typeof params?.retry_after === "number" ? params.retry_after : null;
}

function isNotModified(err: unknown): boolean {
  return /message is not modified/i.test((err as Error)?.message ?? "");
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Streams a model answer into Telegram by editing one message in place.
 *
 * Telegram has no partial-append API, so every update rewrites the whole message
 * — a per-chat rate-limited call and a re-render on the user's screen. Edits are
 * therefore throttled, and the growing text is written as plain text: a
 * half-finished `**bold` or an unclosed code fence is not valid Markdown and
 * would make Telegram reject the edit. Markdown is applied by the final edit.
 */
export class StreamingReply {
  private readonly telegram: Telegram;
  private readonly chatId: number;
  private readonly prefix: { plain: string; markdown: string } | null;

  private messageId: number | null;
  private isFirstMessage = true;
  /** Text of the message currently being written into. */
  private body = "";
  /** Everything the model produced, including parts already split off. */
  private full = "";

  private dirty = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private interval = NEURO_STREAM_EDIT_INTERVAL_MS;
  private nextEditAt = 0;

  constructor(options: StreamingReplyOptions) {
    this.telegram = options.telegram;
    this.chatId = options.chatId;
    this.messageId = options.messageId ?? null;
    this.prefix = options.prefix ?? null;
  }

  get text(): string {
    return this.full;
  }

  /**
   * Buffers a delta. Deliberately synchronous: it runs inside the SSE read loop,
   * and awaiting a Telegram round-trip there would stall reading from the model.
   */
  push(delta: string): void {
    if (this.closed || !delta) return;
    this.body += delta;
    this.full += delta;
    this.dirty = true;
    this.schedule();
  }

  /** Writes the tail, drops the cursor and re-renders the answer as Markdown. */
  async finish(suffix = ""): Promise<void> {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.inFlight;
    if (suffix) {
      this.body += suffix;
      this.full += suffix;
    }
    await this.render(true);
  }

  private schedule(): void {
    // A push landing while an edit is in flight must not queue a second one:
    // nextEditAt still holds the pre-edit value, so the timer would fire at
    // once and two concurrent edits would race on the same message.
    if (this.timer || this.inFlight || this.closed) return;
    const wait = Math.max(0, this.nextEditAt - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.inFlight = this.tick();
    }, wait);
  }

  private async tick(): Promise<void> {
    try {
      await this.render(false);
    } catch (err) {
      // A dropped intermediate edit is not fatal — body is cumulative, so the
      // next render (or finish()) carries the missing text anyway.
      log.warn("Streaming edit failed:", err);
    } finally {
      this.inFlight = null;
      if (this.dirty) this.schedule();
    }
  }

  private async render(final: boolean): Promise<void> {
    if (!this.dirty && !final) return;
    this.dirty = false;

    if (!this.body.trim()) {
      // Telegram rejects an empty edit, and a finished-but-empty answer needs a
      // visible outcome instead of a stale status line.
      if (final) await this.write(EMPTY_ANSWER_TEXT, { markdown: false, streaming: false });
      return;
    }

    const limit = TELEGRAM_MAX_MESSAGE_LENGTH - LENGTH_RESERVE;
    const prefixOf = (markdown: boolean): string =>
      this.isFirstMessage && this.prefix ? (markdown ? this.prefix.markdown : this.prefix.plain) : "";

    // The cursor is applied only after the split, so it can never be carried
    // over into the body of the continuation message.
    while (prefixOf(final).length + this.body.length > limit) {
      const [head, ...rest] = splitMessage(prefixOf(true) + this.body, limit);
      await this.write(head, { markdown: true, streaming: false });
      this.body = rest.join("\n\n");
      this.isFirstMessage = false;
      this.messageId = null;
    }

    await this.write(prefixOf(final) + this.body + (final ? "" : CURSOR), {
      markdown: final,
      streaming: !final,
    });
  }

  /**
   * Sends or edits the current message. Falls back to plain text when Telegram
   * rejects the markup, and waits out a flood limit before retrying.
   */
  private async write(text: string, opts: { markdown: boolean; streaming: boolean }): Promise<void> {
    let useMarkdown = opts.markdown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.send(text, useMarkdown, opts.streaming);
        this.nextEditAt = Date.now() + this.interval;
        return;
      } catch (err) {
        if (isNotModified(err)) return;

        const retryAfter = retryAfterSeconds(err);
        if (retryAfter != null) {
          // One flood wait means the cadence is too fast for this chat right
          // now, so slow the rest of the answer down too.
          this.interval = Math.min(this.interval * 2, NEURO_STREAM_EDIT_MAX_INTERVAL_MS);
          await sleep(retryAfter * 1000);
          continue;
        }
        if (useMarkdown) {
          useMarkdown = false;
          continue;
        }
        throw err;
      }
    }
  }

  private async send(text: string, markdown: boolean, streaming: boolean): Promise<void> {
    const extra = {
      ...(markdown ? { parse_mode: "Markdown" as const } : {}),
      // While the text grows, a link preview would pop in and out underneath it
      // and shift the chat on every edit. The final edit lets it back in.
      ...(streaming ? { link_preview_options: { is_disabled: true } } : {}),
    };

    if (this.messageId == null) {
      const sent = await this.telegram.sendMessage(this.chatId, text, extra);
      this.messageId = sent.message_id;
      return;
    }
    await this.telegram.editMessageText(this.chatId, this.messageId, undefined, text, extra);
  }
}
