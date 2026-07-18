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
  renameUserDialog,
} from "../../services/chatService.js";
import { getUserByTelegramId } from "../../expenses/repository.js";
import { getChatProvider, setChatProvider } from "../../chat/repository.js";
import type { ChatProvider } from "../../shared/types.js";
import type { ApiEnv } from "../authMiddleware.js";
import { logApiAction } from "../../logging/actionLogger.js";

const app = new Hono<ApiEnv>();

// ── Input schemas (json bodies + :id params). Schemas mirror what handlers
//    accept; query params keep the handlers' own parsing.
const idParam = z.object({ id: z.coerce.number().int().positive() });
const sendMessageBody = z.object({
  dialogId: z.number().optional(),
  content: z.string().min(1),
});
const setProviderBody = z.object({
  provider: z.string(),
});
const renameDialogBody = z.object({
  title: z.string().trim().min(1).max(100),
});

/** GET /api/chat/dialogs — list dialogs */
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

/** POST /api/chat/dialogs — create dialog */
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

/** GET /api/chat/dialogs/:id/messages — list messages */
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

/** POST /api/chat/messages — send message */
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

/** POST /api/chat/messages/stream — send message with SSE streaming response */
app.post("/messages/stream", zValidator("json", sendMessageBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ dialogId?: number; content: string }>();

  if (!body.content?.trim()) {
    return c.json({ ok: false, error: "content is required" }, 400);
  }

  return streamSSE(c, async (stream) => {
    let eventId = 0;

    try {
      const result = await sendMessageStream(
        telegramId,
        body.content.trim(),
        async (chunk) => {
          await stream.writeSSE({
            id: String(eventId++),
            event: "chunk",
            data: JSON.stringify({ content: chunk }),
          });
        },
        body.dialogId
      );

      await stream.writeSSE({
        id: String(eventId++),
        event: "done",
        data: JSON.stringify({
          dialogId: result.dialogId,
          messageId: result.assistantMessage.id,
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send message";
      await stream.writeSSE({
        id: String(eventId++),
        event: "error",
        data: JSON.stringify({ error: msg }),
      });
    }
  });
});

/** PUT /api/chat/dialogs/:id — rename dialog */
app.put(
  "/dialogs/:id",
  zValidator("param", idParam),
  zValidator("json", renameDialogBody),
  async (c) => {
    const initData = c.get("initData");
    const telegramId = initData.user.id;
    const dialogId = parseInt(c.req.param("id"), 10);

    if (isNaN(dialogId)) {
      return c.json({ ok: false, error: "Invalid dialog ID" }, 400);
    }

    const body = await c.req.json<{ title: string }>();
    const title = body.title.trim();

    if (!title || title.length > 100) {
      return c.json({ ok: false, error: "title must be 1-100 characters" }, 400);
    }

    try {
      await renameUserDialog(telegramId, dialogId, title);
      logApiAction(telegramId, "chat_dialog_rename", { dialogId });
      return c.json({ ok: true, data: { id: dialogId, title } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to rename dialog";
      return c.json({ ok: false, error: msg }, 500);
    }
  }
);

/** DELETE /api/chat/dialogs/:id — delete dialog */
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

/** GET /api/chat/provider — get current chat provider */
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

/** PUT /api/chat/provider — set chat provider */
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
