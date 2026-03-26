import { Hono } from "hono";
import { transcribeAudio } from "../../services/voiceService.js";
import { extractExpenseIntent } from "../../voice/extractExpenseIntent.js";
import { getCategoriesListFormatted, addExpenseFromVoice } from "../../services/expenseService.js";
import type { ApiEnv } from "../authMiddleware.js";
import { createLogger } from "../../utils/logger.js";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const log = createLogger("voice-route");

const app = new Hono<ApiEnv>();

/** Save uploaded audio to a temp file and return its path + cleanup function. */
async function saveAudioToTemp(
  audioFile: File,
  telegramId: number
): Promise<string> {
  const tempDir = join(process.cwd(), "data", "voice");
  await mkdir(tempDir, { recursive: true });
  const ext = audioFile.name?.split(".").pop() ?? "ogg";
  const tempPath = join(tempDir, `api_${telegramId}_${randomUUID()}.${ext}`);
  const arrayBuffer = await audioFile.arrayBuffer();
  await writeFile(tempPath, Buffer.from(arrayBuffer));
  return tempPath;
}

/** Extract audio File from multipart form data, or return error response. */
function extractAudioFile(formData: FormData): File | null {
  const audioFile = formData.get("audio");
  if (!audioFile || !(audioFile instanceof File)) return null;
  return audioFile;
}

/** POST /api/voice/transcribe — receive audio file (multipart), transcribe and return result */
app.post("/transcribe", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  let tempPath: string | null = null;

  try {
    const formData = await c.req.formData();
    const audioFile = extractAudioFile(formData);

    if (!audioFile) {
      return c.json({ ok: false, error: "audio file is required (multipart field 'audio')" }, 400);
    }

    tempPath = await saveAudioToTemp(audioFile, telegramId);
    const result = await transcribeAudio(tempPath);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to transcribe audio";
    log.error("Voice transcription error for user %d: %s", telegramId, msg);
    return c.json({ ok: false, error: msg }, 500);
  } finally {
    if (tempPath) unlink(tempPath).catch(() => {});
  }
});

/**
 * POST /api/voice/expense — transcribe audio and extract expense intent via AI.
 * Returns transcript + parsed expense data (category, subcategory, amount).
 * If intent extraction succeeds, the expense is automatically saved.
 */
app.post("/expense", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  let tempPath: string | null = null;

  try {
    const formData = await c.req.formData();
    const audioFile = extractAudioFile(formData);

    if (!audioFile) {
      return c.json({ ok: false, error: "audio file is required (multipart field 'audio')" }, 400);
    }

    // Step 1: Transcribe audio to text
    tempPath = await saveAudioToTemp(audioFile, telegramId);
    const { transcript } = await transcribeAudio(tempPath);

    // Step 2: Extract expense intent via DeepSeek AI (same as bot)
    const categoriesList = await getCategoriesListFormatted();
    const intent = await extractExpenseIntent(transcript, categoriesList);

    if (intent.type !== "expense") {
      return c.json({
        ok: false,
        error: intent.type === "not_expense"
          ? "Голосовое сообщение не содержит информацию о расходе."
          : "Не удалось извлечь расход из голосового сообщения.",
        code: "INTENT_EXTRACTION_FAILED",
        data: { transcript },
      }, 422);
    }

    // Step 3: Save expense to DB
    const result = await addExpenseFromVoice(
      telegramId,
      initData.user.username ?? null,
      initData.user.first_name,
      initData.user.last_name ?? null,
      false,
      intent.category,
      intent.subcategory,
      intent.amount
    );

    return c.json({
      ok: true,
      data: {
        ...result,
        transcript,
        expense: {
          category: intent.category,
          subcategory: intent.subcategory,
          amount: intent.amount,
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to process voice expense";
    log.error("Voice expense error for user %d: %s", telegramId, msg);
    return c.json({ ok: false, error: msg }, 500);
  } finally {
    if (tempPath) unlink(tempPath).catch(() => {});
  }
});

export default app;
