import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
import {
  getHistory,
  getTranscription,
  getQueueInfo,
  removeTranscription,
  getPending,
  clearUserQueue,
  updateTranscript,
} from "../../services/transcribeService.js";
import type { ApiEnv } from "../authMiddleware.js";
import { logApiAction } from "../../logging/actionLogger.js";

const app = new Hono<ApiEnv>();

// ── Input schemas.
const idParam = z.object({ id: z.coerce.number().int().positive() });

// STT output can be long, but cap it to guard against abusive payloads.
const MAX_TRANSCRIPT_LENGTH = 20_000;
const updateBody = z.object({
  transcript: z.string().trim().min(1, "Текст не может быть пустым").max(MAX_TRANSCRIPT_LENGTH),
});

app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10) || 10, 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  try {
    const result = await getHistory(telegramId, limit, offset);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get transcription history";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/queue/status", async (c) => {
  try {
    const status = await getQueueInfo();
    return c.json({ ok: true, data: status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get queue status";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/pending", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const pending = await getPending(telegramId);
    return c.json({ ok: true, data: pending });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get pending transcriptions";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/queue", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const cleared = await clearUserQueue(telegramId);
    logApiAction(telegramId, "transcribe_clear_queue", { cleared });
    return c.json({ ok: true, data: { cleared } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to clear queue";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const transcriptionId = parseInt(c.req.param("id"), 10);

  if (isNaN(transcriptionId)) {
    return c.json({ ok: false, error: "Invalid transcription ID" }, 400);
  }

  try {
    const transcription = await getTranscription(telegramId, transcriptionId);
    if (!transcription) {
      return c.json({ ok: false, error: "Transcription not found" }, 404);
    }
    return c.json({ ok: true, data: transcription });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get transcription";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/:id", zValidator("param", idParam), zValidator("json", updateBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const transcriptionId = parseInt(c.req.param("id"), 10);
  const { transcript } = c.req.valid("json");

  if (isNaN(transcriptionId)) {
    return c.json({ ok: false, error: "Invalid transcription ID" }, 400);
  }

  try {
    const updated = await updateTranscript(telegramId, transcriptionId, transcript);
    if (!updated) {
      return c.json({ ok: false, error: "Transcription not found" }, 404);
    }
    logApiAction(telegramId, "transcribe_edit", { transcriptionId });
    return c.json({ ok: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update transcription";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const transcriptionId = parseInt(c.req.param("id"), 10);

  if (isNaN(transcriptionId)) {
    return c.json({ ok: false, error: "Invalid transcription ID" }, 400);
  }

  try {
    const deleted = await removeTranscription(telegramId, transcriptionId);
    logApiAction(telegramId, "transcribe_delete", { transcriptionId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete transcription";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
