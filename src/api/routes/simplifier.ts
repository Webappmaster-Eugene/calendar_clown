import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
import {
  getHistory,
  getSimplification,
  removeSimplification,
  simplifyFromApi,
} from "../../services/simplifierService.js";
import { transcribeAudio } from "../../services/voiceService.js";
import { MAX_SIMPLIFIER_INPUT_LENGTH } from "../../constants.js";
import type { ApiEnv } from "../authMiddleware.js";
import { logApiAction } from "../../logging/actionLogger.js";
import { createLogger } from "../../utils/logger.js";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const log = createLogger("simplifier-route");

const app = new Hono<ApiEnv>();

// Free-text `text` is validated only as a string; the handler owns
// trim/empty/length enforcement.
const idParam = z.object({ id: z.coerce.number().int().positive() });
const simplifyBody = z.object({
  text: z.string().optional(),
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
    const msg = err instanceof Error ? err.message : "Failed to get simplifier history";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const id = parseInt(c.req.param("id"), 10);

  if (isNaN(id)) {
    return c.json({ ok: false, error: "Invalid simplification ID" }, 400);
  }

  try {
    const item = await getSimplification(telegramId, id);
    if (!item) {
      return c.json({ ok: false, error: "Simplification not found" }, 404);
    }
    return c.json({ ok: true, data: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get simplification";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/", zValidator("json", simplifyBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  let body: { text?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const text = body.text?.trim();
  if (!text) {
    return c.json({ ok: false, error: "text field is required" }, 400);
  }

  if (text.length > MAX_SIMPLIFIER_INPUT_LENGTH) {
    return c.json({
      ok: false,
      error: `Text too long (${text.length} chars, max ${MAX_SIMPLIFIER_INPUT_LENGTH})`,
    }, 400);
  }

  try {
    const result = await simplifyFromApi(telegramId, text);
    logApiAction(telegramId, "simplifier_submit", { inputLength: text.length });
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to simplify text";
    log.error("Simplify text error for user %d: %s", telegramId, msg);
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/voice", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  let tempPath: string | null = null;

  try {
    const formData = await c.req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof File)) {
      return c.json({ ok: false, error: "audio file is required (multipart field 'audio')" }, 400);
    }

    const tempDir = join(process.cwd(), "data", "voice");
    await mkdir(tempDir, { recursive: true });
    const ext = audioFile.name?.split(".").pop() ?? "ogg";
    tempPath = join(tempDir, `simp_${telegramId}_${randomUUID()}.${ext}`);
    const arrayBuffer = await audioFile.arrayBuffer();
    await writeFile(tempPath, Buffer.from(arrayBuffer));

    // General-purpose prompt, not calendar-biased.
    const transcribeResult = await transcribeAudio(tempPath, "general");
    const transcript = transcribeResult.transcript;

    if (!transcript) {
      return c.json({ ok: false, error: "Не удалось распознать речь" }, 422);
    }

    const result = await simplifyFromApi(telegramId, transcript, "voice");
    return c.json({
      ok: true,
      data: {
        transcript,
        simplification: result,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to process voice";
    log.error("Simplifier voice error for user %d: %s", telegramId, msg);
    return c.json({ ok: false, error: msg }, 500);
  } finally {
    if (tempPath) unlink(tempPath).catch(() => {});
  }
});

app.delete("/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const id = parseInt(c.req.param("id"), 10);

  if (isNaN(id)) {
    return c.json({ ok: false, error: "Invalid simplification ID" }, 400);
  }

  try {
    const deleted = await removeSimplification(telegramId, id);
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete simplification";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
