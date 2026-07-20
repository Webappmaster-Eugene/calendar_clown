import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for per-dialog AI settings (model/system prompt/temperature/
 * max_tokens/theme) added to chat_dialogs. Covers the service layer that the Mini
 * App uses: updateDialogForUser persists + clears overrides, getUserDialogs surfaces
 * them, and ownership is enforced. Hits a live PostgreSQL.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/chatDialogSettings.integration.test.ts
 */

const TG = 999_000_094;
const TG_OTHER = 999_000_095;
let svc: typeof import("../src/services/chatService.js");
let dialogId: number;

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();
  svc = await import("../src/services/chatService.js");
  const { ensureUser } = await import("../src/expenses/repository.js");
  await ensureUser(TG, "chatsettings", "Chat", "Settings", false);
  await ensureUser(TG_OTHER, "chatother", "Chat", "Other", false);
  const dialog = await svc.createNewDialog(TG, "Тестовый диалог");
  dialogId = dialog.id;
});

after(async () => {
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await cleanupTestUser(TG_OTHER);
  await closeTestDb();
});

describe("per-dialog AI settings", () => {
  it("a fresh dialog has null overrides", async () => {
    const dialogs = await svc.getUserDialogs(TG);
    const d = dialogs.find((x) => x.id === dialogId);
    assert.ok(d);
    assert.equal(d!.model, null);
    assert.equal(d!.systemPrompt, null);
    assert.equal(d!.temperature, null);
    assert.equal(d!.maxTokens, null);
    assert.equal(d!.theme, null);
  });

  it("updateDialogForUser persists model + prompt + temperature + maxTokens + theme + title", async () => {
    const res = await svc.updateDialogForUser(TG, dialogId, {
      title: "Код на Python",
      model: "anthropic/claude-sonnet-4",
      systemPrompt: "Ты — сеньор Python-разработчик.",
      temperature: 0.3,
      maxTokens: 2048,
      theme: "программирование",
    });
    assert.equal(res.title, "Код на Python");
    assert.equal(res.model, "anthropic/claude-sonnet-4");
    assert.equal(res.systemPrompt, "Ты — сеньор Python-разработчик.");
    assert.equal(res.temperature, 0.3);
    assert.equal(res.maxTokens, 2048);
    assert.equal(res.theme, "программирование");

    // Persisted — visible via the list too.
    const d = (await svc.getUserDialogs(TG)).find((x) => x.id === dialogId);
    assert.equal(d!.model, "anthropic/claude-sonnet-4");
    assert.equal(d!.temperature, 0.3);
  });

  it("a partial patch leaves other fields untouched", async () => {
    const res = await svc.updateDialogForUser(TG, dialogId, { temperature: 1.1 });
    assert.equal(res.temperature, 1.1);
    assert.equal(res.model, "anthropic/claude-sonnet-4", "model must be unchanged");
    assert.equal(res.title, "Код на Python", "title must be unchanged");
  });

  it("null clears an override back to the global default", async () => {
    const res = await svc.updateDialogForUser(TG, dialogId, { model: null, systemPrompt: null });
    assert.equal(res.model, null);
    assert.equal(res.systemPrompt, null);
    assert.equal(res.temperature, 1.1, "unrelated override stays");
  });

  it("refuses to update another user's dialog (ownership)", async () => {
    await assert.rejects(
      () => svc.updateDialogForUser(TG_OTHER, dialogId, { title: "hijack" }),
      /Диалог не найден/
    );
  });
});
