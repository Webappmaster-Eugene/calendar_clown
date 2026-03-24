import { Hono } from "hono";
import {
  getUserDialogs,
  createNewDialog,
  getDialogMessages,
  sendMessage,
  removeDialog,
} from "../../services/chatService.js";
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

export default app;
