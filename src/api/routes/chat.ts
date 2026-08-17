import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
import { streamSSE } from "hono/streaming";
import {
  getUserDialogs,
  createNewDialog,
  getDialogMessages,
  sendMessage,
  sendMessageStream,
  removeDialog,
  updateDialogForUser,
  getModels,
  getModelVendors,
  getChatConfig,
} from "../../services/chatService.js";
import {
  prepareChatMessageShare,
  ShareNotFoundError,
  TelegramApiUnavailableError,
} from "../../services/shareService.js";
import type { UpdateDialogRequest } from "../../shared/types.js";
import { getUserByTelegramId } from "../../expenses/repository.js";
import { getChatProvider, setChatProvider } from "../../chat/repository.js";
import type { ChatProvider } from "../../shared/types.js";
import type { ApiEnv } from "../authMiddleware.js";
import { logApiAction } from "../../logging/actionLogger.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("chat-route");

const app = new Hono<ApiEnv>();

const idParam = z.object({ id: z.coerce.number().int().positive() });
const sendMessageBody = z.object({
  dialogId: z.number().optional(),
  content: z.string().min(1),
});
const setProviderBody = z.object({
  provider: z.string(),
});
// An explicit null clears an override (falls back to the global provider default).
const dialogUpdateBody = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().max(120).nullable().optional(),
  systemPrompt: z.string().max(8000).nullable().optional(),
});
const shareBody = z.object({
  dialogId: z.number().int().positive(),
  messageId: z.number().int().positive(),
});

app.get("/dialogs", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const dialogs = await getUserDialogs(telegramId);
    return c.json({ ok: true, data: dialogs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get dialogs";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/dialogs", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ title?: string }>().catch(() => ({} as { title?: string }));

  try {
    const dialog = await createNewDialog(telegramId, body.title);
    logApiAction(telegramId, "chat_dialog_create", { title: body.title });
    return c.json({ ok: true, data: dialog });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create dialog";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/dialogs/:id/messages", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const dialogId = parseInt(c.req.param("id"), 10);

  if (isNaN(dialogId)) {
    return c.json({ ok: false, error: "Invalid dialog ID" }, 400);
  }

  try {
    const messages = await getDialogMessages(telegramId, dialogId);
    return c.json({ ok: true, data: messages });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get messages";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/messages", zValidator("json", sendMessageBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ dialogId?: number; content: string }>();

  if (!body.content?.trim()) {
    return c.json({ ok: false, error: "content is required" }, 400);
  }

  try {
    const result = await sendMessage(telegramId, body.content.trim(), body.dialogId);
    logApiAction(telegramId, "chat_message_send", { dialogId: body.dialogId });
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send message";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/messages/stream", zValidator("json", sendMessageBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ dialogId?: number; content: string }>();

  if (!body.content?.trim()) {
    return c.json({ ok: false, error: "content is required" }, 400);
  }

  return streamSSE(c, async (stream) => {
    let eventId = 0;
    let aborted = false;
    let firstChunkSent = false;
    stream.onAbort(() => { aborted = true; });

    const write = async (event: string, data: unknown): Promise<void> => {
      if (aborted) return;
      await stream.writeSSE({ id: String(eventId++), event, data: JSON.stringify(data) });
    };

    // Link reading + web search can take tens of seconds before the first token;
    // a periodic ping keeps proxies (Traefik) from dropping the idle stream.
    const keepalive = setInterval(() => {
      if (!firstChunkSent) void write("ping", {}).catch(() => {});
    }, 15_000);

    try {
      const result = await sendMessageStream(
        telegramId,
        body.content.trim(),
        async (chunk) => {
          if (!firstChunkSent) {
            firstChunkSent = true;
            clearInterval(keepalive);
          }
          await write("chunk", { content: chunk });
        },
        body.dialogId,
        async (status) => {
          await write("status", { kind: status.kind, label: status.label });
        }
      );

      await write("done", {
        dialogId: result.dialogId,
        messageId: result.assistantMessage.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send message";
      await write("error", { error: msg });
    } finally {
      clearInterval(keepalive);
    }
  });
});

app.post("/share", zValidator("json", shareBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = c.req.valid("json");

  try {
    const data = await prepareChatMessageShare(telegramId, body.dialogId, body.messageId);
    logApiAction(telegramId, "chat_message_share", {
      dialogId: body.dialogId,
      messageId: body.messageId,
      truncated: data.truncated,
    });
    return c.json({ ok: true, data });
  } catch (err) {
    if (err instanceof ShareNotFoundError) {
      return c.json({ ok: false, error: err.message }, 404);
    }
    if (err instanceof TelegramApiUnavailableError) {
      return c.json(
        { ok: false, error: "Функция «Поделиться» временно недоступна. Попробуйте позже." },
        503
      );
    }
    const msg = err instanceof Error ? err.message : "Failed to prepare share";
    log.error("Failed to prepare share for user %d: %s", telegramId, msg);
    return c.json(
      { ok: false, error: "Функция «Поделиться» временно недоступна. Попробуйте позже." },
      503
    );
  }
});

app.put(
  "/dialogs/:id",
  zValidator("param", idParam),
  zValidator("json", dialogUpdateBody),
  async (c) => {
    const initData = c.get("initData");
    const telegramId = initData.user.id;
    const dialogId = parseInt(c.req.param("id"), 10);
    if (isNaN(dialogId)) {
      return c.json({ ok: false, error: "Invalid dialog ID" }, 400);
    }

    const patch = c.req.valid("json") as UpdateDialogRequest;
    if (Object.keys(patch).length === 0) {
      return c.json({ ok: false, error: "no fields to update" }, 400);
    }

    try {
      const dialog = await updateDialogForUser(telegramId, dialogId, patch);
      logApiAction(telegramId, "chat_dialog_update", { dialogId, fields: Object.keys(patch) });
      return c.json({ ok: true, data: dialog });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update dialog";
      const status = msg === "Диалог не найден." ? 404 : 500;
      return c.json({ ok: false, error: msg }, status);
    }
  }
);

app.get("/models", async (c) => {
  const search = c.req.query("search") ?? "";
  const free = c.req.query("free") === "1" || c.req.query("free") === "true";
  const vendor = c.req.query("vendor") || undefined;
  try {
    const models = await getModels(search, { free, vendor });
    return c.json({ ok: true, data: models });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load models";
    return c.json({ ok: false, error: msg }, 502);
  }
});

app.get("/config", (c) => {
  return c.json({ ok: true, data: getChatConfig() });
});

app.get("/models/vendors", async (c) => {
  try {
    const vendors = await getModelVendors();
    return c.json({ ok: true, data: vendors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load vendors";
    return c.json({ ok: false, error: msg }, 502);
  }
});

app.delete("/dialogs/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const dialogId = parseInt(c.req.param("id"), 10);

  if (isNaN(dialogId)) {
    return c.json({ ok: false, error: "Invalid dialog ID" }, 400);
  }

  try {
    await removeDialog(telegramId, dialogId);
    logApiAction(telegramId, "chat_dialog_delete", { dialogId });
    return c.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete dialog";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/provider", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) return c.json({ ok: false, error: "User not found" }, 404);

    const provider = await getChatProvider(dbUser.id);
    return c.json({ ok: true, data: { provider } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get provider";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/provider", zValidator("json", setProviderBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ provider: string }>();

  const provider = body.provider as ChatProvider;
  if (provider !== "free" && provider !== "paid" && provider !== "uncensored") {
    return c.json({ ok: false, error: "Invalid provider. Use 'free', 'paid', or 'uncensored'" }, 400);
  }

  try {
    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) return c.json({ ok: false, error: "User not found" }, 404);

    await setChatProvider(dbUser.id, provider);
    return c.json({ ok: true, data: { provider } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to set provider";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
