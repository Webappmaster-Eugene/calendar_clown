import { Hono } from "hono";
import {
  getHistory,
  getTranscription,
  getQueueInfo,
  removeTranscription,
} from "../../services/transcribeService.js";
import type { ApiEnv } from "../authMiddleware.js";
import { logApiAction } from "../../logging/actionLogger.js";

const app = new Hono<ApiEnv>();

/** GET /api/transcribe — transcription history */
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

/** GET /api/transcribe/queue/status — queue status */
app.get("/queue/status", async (c) => {
  try {
    const status = await getQueueInfo();
    return c.json({ ok: true, data: status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get queue status";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/transcribe/:id — single transcription */
app.get("/:id", async (c) => {
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

/** DELETE /api/transcribe/:id — delete transcription */
app.delete("/:id", async (c) => {
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
