import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { CHAT_DIALOG_MESSAGE_LIMIT } from "../src/shared/constants.js";

/**
 * Integration test for the per-dialog message cap: once a dialog holds
 * CHAT_DIALOG_MESSAGE_LIMIT messages, sendMessage must refuse to write (the check
 * runs BEFORE any AI call, so this is deterministic — no network). Guards the
 * "нельзя писать в переполненный чат" requirement.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/chatMessageLimit.integration.test.ts
 */

const TG = 999_000_096;
let svc: typeof import("../src/services/chatService.js");
let repo: typeof import("../src/chat/repository.js");
let userId: number;
let dialogId: number;

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();
  svc = await import("../src/services/chatService.js");
  repo = await import("../src/chat/repository.js");
  const { ensureUser } = await import("../src/expenses/repository.js");
  const u = await ensureUser(TG, "chatlimit", "Chat", "Limit", false);
  userId = u.id;
  const d = await svc.createNewDialog(TG, "Лимит");
  dialogId = d.id;
});

after(async () => {
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

describe("per-dialog message cap", () => {
  it("counts messages in a dialog", async () => {
    assert.equal(await repo.countDialogMessages(dialogId), 0);
    await repo.saveMessage(userId, dialogId, "user", "привет");
    await repo.saveMessage(userId, dialogId, "assistant", "здравствуйте");
    assert.equal(await repo.countDialogMessages(dialogId), 2);
  });

  it("blocks sendMessage once the dialog reaches the limit (no AI call)", async () => {
    // Fill up to exactly the limit (we already have 2).
    const current = await repo.countDialogMessages(dialogId);
    for (let i = current; i < CHAT_DIALOG_MESSAGE_LIMIT; i++) {
      await repo.saveMessage(userId, dialogId, i % 2 === 0 ? "user" : "assistant", `msg ${i}`);
    }
    assert.equal(await repo.countDialogMessages(dialogId), CHAT_DIALOG_MESSAGE_LIMIT);

    await assert.rejects(
      () => svc.sendMessage(TG, "ещё сообщение", dialogId),
      new RegExp(`лимита в ${CHAT_DIALOG_MESSAGE_LIMIT}`)
    );
    // Nothing was written (the block is before the AI + save).
    assert.equal(await repo.countDialogMessages(dialogId), CHAT_DIALOG_MESSAGE_LIMIT);
  });
});
