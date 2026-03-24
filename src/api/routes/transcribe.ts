import { Hono } from "hono";
import {
  getHistory,
  getTranscription,
  getQueueInfo,
} from "../../services/transcribeService.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

/** GET /api/transcribe — transcription history */
app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const result = await getHistory(telegramId);
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

export default app;
