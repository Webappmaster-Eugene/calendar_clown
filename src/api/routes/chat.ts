import { Hono } from "hono";
import {
  getUserDialogs,
  createNewDialog,
  getDialogMessages,
  sendMessage,
  removeDialog,
} from "../../services/chatService.js";
import { getUserByTelegramId } from "../../expenses/repository.js";
import { getChatProvider, setChatProvider } from "../../chat/repository.js";
import type { ChatProvider } from "../../shared/types.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

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
    return c.json({ ok: true, data: dialog });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create dialog";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/chat/dialogs/:id/messages — list messages */
app.get("/dialogs/:id/messages", async (c) => {
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
app.post("/messages", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ dialogId?: number; content: string }>();

  if (!body.content?.trim()) {
    return c.json({ ok: false, error: "content is required" }, 400);
  }

  try {
    const result = await sendMessage(telegramId, body.content.trim(), body.dialogId);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send message";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/chat/dialogs/:id — delete dialog */
app.delete("/dialogs/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const dialogId = parseInt(c.req.param("id"), 10);

  if (isNaN(dialogId)) {
    return c.json({ ok: false, error: "Invalid dialog ID" }, 400);
  }

  try {
    await removeDialog(telegramId, dialogId);
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
app.put("/provider", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ provider: string }>();

  const provider = body.provider as ChatProvider;
  if (provider !== "free" && provider !== "paid") {
    return c.json({ ok: false, error: "Invalid provider. Use 'free' or 'paid'" }, 400);
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
