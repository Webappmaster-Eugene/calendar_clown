import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for the P1 CRUD-gap edits (real DB): the new owner-checked
 * update functions added so the Mini App can edit records instead of
 * delete-and-recreate. Covers:
 *   - wishlist.updateWishlist   (name/emoji, ownership + isActive guard)
 *   - chat.renameDialog         (title, ownership + isActive guard)
 *   - transcribe.updateTranscriptForUser (transcript, ownership guard)
 *   - calendar.markEventUpdated (audit row summary/times, ownership + status guard)
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/p1CrudEdits.integration.test.ts
 */

const TG = 999000090;
let userId: number;
let tribeId: number;

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();

  const { ensureUser } = await import("../src/expenses/repository.js");
  const user = await ensureUser(TG, "p1edits", "P1", "Editor", false);
  userId = user.id;
  tribeId = user.tribeId;
});

after(async () => {
  const { db } = await import("../src/db/drizzle.js");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM calendar_events WHERE user_id = ${userId}`);
  await db.execute(sql`DELETE FROM voice_transcriptions WHERE user_id = ${userId}`);
  await db.execute(sql`DELETE FROM chat_dialogs WHERE user_id = ${userId}`);
  await db.execute(sql`DELETE FROM wishlists WHERE user_id = ${userId}`);
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

describe("wishlist.updateWishlist", () => {
  it("updates name and emoji, and enforces ownership + active guards", async () => {
    const repo = await import("../src/wishlist/repository.js");
    const wl = await repo.createWishlist(tribeId, userId, "Старое имя", "📦");

    const updated = await repo.updateWishlist(wl.id, userId, { name: "Новое имя", emoji: "🎉" });
    assert.ok(updated);
    assert.equal(updated?.name, "Новое имя");
    assert.equal(updated?.emoji, "🎉");

    // Partial update: only emoji changes, name is preserved.
    const partial = await repo.updateWishlist(wl.id, userId, { emoji: "⭐" });
    assert.equal(partial?.name, "Новое имя");
    assert.equal(partial?.emoji, "⭐");

    // A different user cannot update someone else's list.
    assert.equal(await repo.updateWishlist(wl.id, userId + 999999, { name: "Взлом" }), null);

    // After soft-delete the list is no longer updatable (isActive guard).
    assert.equal(await repo.deleteWishlist(wl.id, userId), true);
    assert.equal(await repo.updateWishlist(wl.id, userId, { name: "Зомби" }), null);
  });
});

describe("chat.renameDialog", () => {
  it("renames a dialog, and enforces ownership + active guards", async () => {
    const repo = await import("../src/chat/repository.js");
    const dialog = await repo.createDialog(userId, "Новый диалог");

    assert.equal(await repo.renameDialog(dialog.id, userId, "Планы на отпуск"), true);
    const after = await repo.getDialogById(dialog.id, userId);
    assert.equal(after?.title, "Планы на отпуск");

    // Wrong owner cannot rename.
    assert.equal(await repo.renameDialog(dialog.id, userId + 999999, "Взлом"), false);

    // After soft-delete rename returns false (isActive guard).
    await repo.deleteDialog(dialog.id, userId);
    assert.equal(await repo.renameDialog(dialog.id, userId, "Зомби"), false);
  });
});

describe("transcribe.updateTranscriptForUser", () => {
  it("updates transcript text with an ownership guard", async () => {
    const repo = await import("../src/transcribe/repository.js");
    const created = await repo.createTranscription({
      userId,
      telegramFileId: "tg-p1-file-1",
      telegramFileUniqueId: "tg-p1-uniq-1",
      durationSeconds: 12,
      fileSizeBytes: 2048,
      forwardedFromName: null,
      forwardedDate: null,
      audioFilePath: "/tmp/p1.ogg",
      sequenceNumber: 1,
      chatId: TG,
      statusMessageId: 1,
    });

    const updated = await repo.updateTranscriptForUser(created.id, userId, "Исправленный текст");
    assert.ok(updated);
    assert.equal(updated?.transcript, "Исправленный текст");

    // Persisted, not just returned.
    const fetched = await repo.getTranscriptionByIdForUser(created.id, userId);
    assert.equal(fetched?.transcript, "Исправленный текст");

    // Wrong owner cannot update.
    assert.equal(await repo.updateTranscriptForUser(created.id, userId + 999999, "Взлом"), null);
  });
});

describe("calendar.markEventUpdated", () => {
  it("updates the audit row, and enforces ownership + created-status guards", async () => {
    const repo = await import("../src/calendar/repository.js");
    const { db } = await import("../src/db/drizzle.js");
    const { calendarEvents } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");

    const gId = "gcal-p1-1";
    await repo.saveCalendarEvent({
      userId,
      tribeId,
      googleEventId: gId,
      summary: "Старая встреча",
      startTime: new Date("2026-01-01T10:00:00Z"),
      endTime: new Date("2026-01-01T11:00:00Z"),
      inputMethod: "text",
      status: "created",
    });

    const newStart = new Date("2026-01-02T15:00:00Z");
    const newEnd = new Date("2026-01-02T16:00:00Z");
    assert.equal(
      await repo.markEventUpdated(gId, userId, { summary: "Новая встреча", startTime: newStart, endTime: newEnd }),
      true,
    );

    const [row] = await db.select().from(calendarEvents).where(eq(calendarEvents.googleEventId, gId));
    assert.equal(row.summary, "Новая встреча");
    assert.equal(new Date(row.startTime).toISOString(), newStart.toISOString());
    assert.equal(new Date(row.endTime).toISOString(), newEnd.toISOString());

    // Wrong owner cannot update.
    assert.equal(
      await repo.markEventUpdated(gId, userId + 999999, { summary: "Взлом", startTime: newStart, endTime: newEnd }),
      false,
    );

    // Once the event is deleted (status != "created"), update no longer applies.
    assert.equal(await repo.markEventDeleted(gId, userId), true);
    assert.equal(
      await repo.markEventUpdated(gId, userId, { summary: "Зомби", startTime: newStart, endTime: newEnd }),
      false,
    );
  });
});
