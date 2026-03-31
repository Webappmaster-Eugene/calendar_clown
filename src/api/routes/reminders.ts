import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getUserReminders,
  createNewReminder,
  toggleReminder,
  removeReminder,
  editReminderText,
  editReminderSchedule,
  editReminderSoundSettings,
  getTribeRemindersList,
  subscribeToReminder,
  unsubscribeFromReminder,
  getAvailableSounds,
  getFiredReminders,
} from "../../services/remindersService.js";
import type { ApiEnv } from "../authMiddleware.js";
import { logApiAction } from "../../logging/actionLogger.js";
import type { ReminderScheduleDto } from "../../shared/types.js";

const app = new Hono<ApiEnv>();

/** GET /api/reminders/sounds — available sounds for selection */
app.get("/sounds", async (c) => {
  try {
    const sounds = await getAvailableSounds();
    return c.json({ ok: true, data: sounds });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get sounds";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/reminders/sounds/file/:filename — serve MP3 file */
app.get("/sounds/file/:filename", async (c) => {
  const filename = c.req.param("filename");
  if (!/^[\w-]+\.mp3$/.test(filename)) {
    return c.json({ ok: false, error: "Invalid filename" }, 400);
  }
  try {
    const filePath = join(process.cwd(), "data", "sounds", filename);
    const file = await readFile(filePath);
    return new Response(file, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return c.json({ ok: false, error: "Sound file not found" }, 404);
  }
});

/** GET /api/reminders/fired?since=ISO — recently fired reminders with sound (Mini App polling) */
app.get("/fired", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const sinceParam = c.req.query("since");

  if (!sinceParam) {
    return c.json({ ok: false, error: "since query param is required (ISO date)" }, 400);
  }

  const since = new Date(sinceParam);
  if (isNaN(since.getTime())) {
    return c.json({ ok: false, error: "Invalid since date format" }, 400);
  }

  try {
    const fired = await getFiredReminders(telegramId, since);
    return c.json({ ok: true, data: fired });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get fired reminders";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/reminders — list reminders */
app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const reminders = await getUserReminders(telegramId);
    return c.json({ ok: true, data: reminders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get reminders";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/reminders/tribe — tribe reminders (must be before /:id) */
app.get("/tribe", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const reminders = await getTribeRemindersList(telegramId);
    return c.json({ ok: true, data: reminders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get tribe reminders";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/reminders — create reminder */
app.post("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{
    text: string;
    schedule: ReminderScheduleDto;
    soundId?: number;
    soundEnabled?: boolean;
  }>();

  if (!body.text?.trim()) {
    return c.json({ ok: false, error: "text is required" }, 400);
  }
  if (!body.schedule || !body.schedule.times || !body.schedule.weekdays) {
    return c.json({ ok: false, error: "schedule with times and weekdays is required" }, 400);
  }

  try {
    const reminder = await createNewReminder(
      telegramId,
      body.text.trim(),
      body.schedule,
      "text",
      body.soundId,
      body.soundEnabled,
    );
    logApiAction(telegramId, "reminder_create", { text: body.text.trim() });
    return c.json({ ok: true, data: reminder });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create reminder";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/reminders/:id/toggle — toggle active */
app.put("/:id/toggle", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const reminderId = parseInt(c.req.param("id"), 10);

  if (isNaN(reminderId)) {
    return c.json({ ok: false, error: "Invalid reminder ID" }, 400);
  }

  try {
    const reminder = await toggleReminder(telegramId, reminderId);
    if (!reminder) {
      return c.json({ ok: false, error: "Reminder not found" }, 404);
    }
    logApiAction(telegramId, "reminder_toggle", { reminderId });
    return c.json({ ok: true, data: reminder });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to toggle reminder";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/reminders/:id — update reminder (text + schedule + sound) */
app.put("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const reminderId = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{
    text?: string;
    schedule?: ReminderScheduleDto;
    soundId?: number | null;
    soundEnabled?: boolean;
  }>();

  if (isNaN(reminderId)) {
    return c.json({ ok: false, error: "Invalid reminder ID" }, 400);
  }

  try {
    if (body.text?.trim()) {
      await editReminderText(telegramId, reminderId, body.text.trim());
    }
    if (body.schedule) {
      await editReminderSchedule(telegramId, reminderId, body.schedule);
    }
    if (body.soundId !== undefined || body.soundEnabled !== undefined) {
      await editReminderSoundSettings(
        telegramId,
        reminderId,
        body.soundId ?? null,
        body.soundEnabled ?? false,
      );
    }
    logApiAction(telegramId, "reminder_edit", { reminderId });
    return c.json({ ok: true, data: { updated: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update reminder";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/reminders/:id/subscribe — subscribe to reminder */
app.post("/:id/subscribe", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const reminderId = parseInt(c.req.param("id"), 10);

  if (isNaN(reminderId)) {
    return c.json({ ok: false, error: "Invalid reminder ID" }, 400);
  }

  try {
    await subscribeToReminder(telegramId, reminderId);
    return c.json({ ok: true, data: { subscribed: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to subscribe";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/reminders/:id/subscribe — unsubscribe from reminder */
app.delete("/:id/subscribe", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const reminderId = parseInt(c.req.param("id"), 10);

  if (isNaN(reminderId)) {
    return c.json({ ok: false, error: "Invalid reminder ID" }, 400);
  }

  try {
    await unsubscribeFromReminder(telegramId, reminderId);
    return c.json({ ok: true, data: { unsubscribed: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to unsubscribe";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/reminders/:id — delete reminder */
app.delete("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const reminderId = parseInt(c.req.param("id"), 10);

  if (isNaN(reminderId)) {
    return c.json({ ok: false, error: "Invalid reminder ID" }, 400);
  }

  try {
    const deleted = await removeReminder(telegramId, reminderId);
    logApiAction(telegramId, "reminder_delete", { reminderId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete reminder";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
