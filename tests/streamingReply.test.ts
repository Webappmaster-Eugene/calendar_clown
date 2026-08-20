import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Telegram } from "telegraf";
import { StreamingReply } from "../src/chat/streamingReply.js";
import { NEURO_STREAM_EDIT_INTERVAL_MS } from "../src/constants.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../src/utils/telegram.js";

/**
 * Unit tests for the bot-side answer streamer. The interesting behaviour is all
 * in how it rations Telegram calls and survives what Telegram throws back:
 * throttling, the 4096-char split, Markdown only on the final edit, flood waits
 * and "not modified" edits.
 */

interface Call {
  kind: "send" | "edit";
  messageId?: number;
  text: string;
  parseMode?: string;
  previewDisabled: boolean;
}

interface FakeTelegram {
  telegram: Telegram;
  calls: Call[];
  /** Queued failures, consumed one per call. */
  failWith: Array<Error | null>;
}

function fakeTelegram(): FakeTelegram {
  const calls: Call[] = [];
  const failWith: Array<Error | null> = [];
  let nextId = 100;

  const maybeFail = (): void => {
    const err = failWith.shift();
    if (err) throw err;
  };

  const record = (call: Call): void => {
    calls.push(call);
  };

  const telegram = {
    async sendMessage(_chatId: number, text: string, extra?: Record<string, unknown>) {
      maybeFail();
      const messageId = nextId++;
      record({
        kind: "send",
        messageId,
        text,
        parseMode: extra?.parse_mode as string | undefined,
        previewDisabled: Boolean(extra?.link_preview_options),
      });
      return { message_id: messageId };
    },
    async editMessageText(
      _chatId: number,
      messageId: number,
      _inline: undefined,
      text: string,
      extra?: Record<string, unknown>
    ) {
      maybeFail();
      record({
        kind: "edit",
        messageId,
        text,
        parseMode: extra?.parse_mode as string | undefined,
        previewDisabled: Boolean(extra?.link_preview_options),
      });
      return true;
    },
  } as unknown as Telegram;

  return { telegram, calls, failWith };
}

function floodError(seconds: number): Error {
  const err = new Error("429: Too Many Requests: retry after " + seconds) as Error & {
    response: { parameters: { retry_after: number } };
  };
  err.response = { parameters: { retry_after: seconds } };
  return err;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("StreamingReply", () => {
  it("throttles edits: a burst of deltas costs one intermediate edit at most", async () => {
    const { telegram, calls } = fakeTelegram();
    const reply = new StreamingReply({ telegram, chatId: 1, messageId: 7 });

    for (let i = 0; i < 200; i++) reply.push(`чанк${i} `);
    await sleep(NEURO_STREAM_EDIT_INTERVAL_MS / 4);
    await reply.finish();

    const intermediate = calls.filter((c) => !c.parseMode);
    assert.ok(intermediate.length <= 1, `expected at most 1 throttled edit, got ${intermediate.length}`);
    assert.equal(calls.at(-1)?.parseMode, "Markdown");
  });

  it("edits the status message in place instead of sending a new one", async () => {
    const { telegram, calls } = fakeTelegram();
    const reply = new StreamingReply({ telegram, chatId: 1, messageId: 7 });

    reply.push("ответ");
    await reply.finish();

    assert.deepEqual(calls.map((c) => c.kind), ["edit"]);
    assert.equal(calls[0].messageId, 7);
    assert.equal(calls[0].text, "ответ");
  });

  it("sends its own message when no status message was given", async () => {
    const { telegram, calls } = fakeTelegram();
    const reply = new StreamingReply({ telegram, chatId: 1 });

    reply.push("ответ");
    await reply.finish();

    assert.equal(calls[0].kind, "send");
  });

  it("marks the answer as in progress and drops the marker when done", async () => {
    const { telegram, calls } = fakeTelegram();
    const reply = new StreamingReply({ telegram, chatId: 1, messageId: 7 });

    reply.push("часть один");
    await sleep(NEURO_STREAM_EDIT_INTERVAL_MS + 50);
    assert.ok(calls[0].text.endsWith("▌"), `expected a cursor, got ${JSON.stringify(calls[0].text)}`);
    assert.equal(calls[0].previewDisabled, true, "link previews must not flicker mid-stream");

    reply.push(" часть два");
    await reply.finish();

    const last = calls.at(-1)!;
    assert.equal(last.text, "часть один часть два");
    assert.equal(last.previewDisabled, false);
  });

  it("continues in a new message once the answer passes Telegram's limit", async () => {
    const { telegram, calls } = fakeTelegram();
    const reply = new StreamingReply({ telegram, chatId: 1, messageId: 7 });

    // Paragraph-shaped, so the split lands on a blank line like a real answer.
    for (let i = 0; i < 60; i++) reply.push("Абзац ".repeat(20) + "\n\n");
    await reply.finish();

    const sends = calls.filter((c) => c.kind === "send");
    assert.ok(sends.length >= 1, "the overflow must continue in a new message");
    for (const call of calls) {
      assert.ok(
        call.text.length <= TELEGRAM_MAX_MESSAGE_LENGTH,
        `message of ${call.text.length} chars exceeds the Telegram limit`
      );
    }
    // No text may be dropped at the boundary.
    const joined = calls
      .filter((c, i) => i === calls.findLastIndex((o) => o.messageId === c.messageId))
      .map((c) => c.text)
      .join("");
    assert.ok(joined.includes("Абзац"), "the split messages must carry the answer");
  });

  it("keeps the transcript prefix on the first message only, italic once finished", async () => {
    const { telegram, calls } = fakeTelegram();
    const reply = new StreamingReply({
      telegram,
      chatId: 1,
      messageId: 7,
      prefix: { plain: "🎤 привет\n\n", markdown: "🎤 _привет_\n\n" },
    });

    reply.push("ответ");
    await sleep(NEURO_STREAM_EDIT_INTERVAL_MS + 50);
    assert.ok(calls[0].text.startsWith("🎤 привет"), "streaming uses the plain prefix");

    await reply.finish();
    assert.ok(calls.at(-1)!.text.startsWith("🎤 _привет_"), "the final edit italicises it");
  });

  it("falls back to plain text when Telegram rejects the Markdown", async () => {
    const { telegram, calls, failWith } = fakeTelegram();
    const reply = new StreamingReply({ telegram, chatId: 1, messageId: 7 });

    reply.push("*незакрытая разметка");
    failWith.push(new Error("400: Bad Request: can't parse entities"));
    await reply.finish();

    assert.equal(calls.length, 1, "the retry must not duplicate the message");
    assert.equal(calls[0].parseMode, undefined);
    assert.equal(calls[0].text, "*незакрытая разметка");
  });

  it("waits out a flood limit and slows down afterwards", async () => {
    const { telegram, calls, failWith } = fakeTelegram();
    const reply = new StreamingReply({ telegram, chatId: 1, messageId: 7 });

    reply.push("ответ");
    failWith.push(floodError(1));
    const startedAt = Date.now();
    await reply.finish();

    assert.ok(Date.now() - startedAt >= 900, "must honour retry_after before retrying");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, "ответ");
  });

  it("swallows a 'not modified' rejection", async () => {
    const { telegram, calls, failWith } = fakeTelegram();
    const reply = new StreamingReply({ telegram, chatId: 1, messageId: 7 });

    reply.push("ответ");
    failWith.push(new Error("400: Bad Request: message is not modified"));
    await reply.finish();

    assert.equal(calls.length, 0, "a no-op edit must not be retried");
  });

  it("says so instead of leaving the status line when the model returns nothing", async () => {
    const { telegram, calls } = fakeTelegram();
    const reply = new StreamingReply({ telegram, chatId: 1, messageId: 7 });

    await reply.finish();

    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /пустой ответ/);
  });

  it("ignores deltas that arrive after the answer was closed", async () => {
    const { telegram, calls } = fakeTelegram();
    const reply = new StreamingReply({ telegram, chatId: 1, messageId: 7 });

    reply.push("ответ");
    await reply.finish();
    reply.push(" хвост");
    await sleep(NEURO_STREAM_EDIT_INTERVAL_MS + 50);

    assert.equal(calls.length, 1);
    assert.equal(reply.text, "ответ");
  });
});
