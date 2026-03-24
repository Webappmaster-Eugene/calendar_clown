import { Hono } from "hono";
import { transcribeAudio } from "../../services/voiceService.js";
import type { ApiEnv } from "../authMiddleware.js";
import { createLogger } from "../../utils/logger.js";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const log = createLogger("voice-route");

const app = new Hono<ApiEnv>();

/** POST /api/voice/transcribe — receive audio file (multipart), transcribe and return result */
app.post("/transcribe", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  let tempPath: string | null = null;

  try {
    const formData = await c.req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof File)) {
      return c.json({ ok: false, error: "audio file is required (multipart field 'audio')" }, 400);
    }

    // Save to temporary file
    const tempDir = join(process.cwd(), "data", "voice");
    await mkdir(tempDir, { recursive: true });

    const ext = audioFile.name?.split(".").pop() ?? "ogg";
    tempPath = join(tempDir, `api_${telegramId}_${randomUUID()}.${ext}`);

    const arrayBuffer = await audioFile.arrayBuffer();
    await writeFile(tempPath, Buffer.from(arrayBuffer));

    const result = await transcribeAudio(tempPath);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to transcribe audio";
    log.error("Voice transcription error for user %d: %s", telegramId, msg);
    return c.json({ ok: false, error: msg }, 500);
  } finally {
    // Clean up temporary file
    if (tempPath) {
      unlink(tempPath).catch(() => {});
    }
  }
});

export default app;
