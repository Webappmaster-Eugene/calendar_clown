import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for the Gandalf repository (real DB).
 * Gandalf entities are tribe-scoped (tribeId) with per-entry visibility
 * ('tribe' | 'private'). Run:
 *   DATABASE_URL=postgres://... npx tsx --test tests/gandalf.integration.test.ts
 */

const TG = 999000030;
let userId: number;
let tribeId: number;

let repo: typeof import("../src/gandalf/repository.js");

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();

  const { ensureUser } = await import("../src/expenses/repository.js");
  const user = await ensureUser(TG, "gandalftest", "Gandalf", "Tester", false);
  userId = user.id;
  tribeId = user.tribeId;

  repo = await import("../src/gandalf/repository.js");
});

after(async () => {
  // Deleting categories cascades to entries, which cascade to entry files.
  const { db } = await import("../src/db/drizzle.js");
  const { sql } = await import("drizzle-orm");
  await db.execute(
    sql`DELETE FROM gandalf_categories WHERE created_by_user_id = ${userId} OR tribe_id = ${tribeId}`
  );
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

describe("gandalf category + entry lifecycle", () => {
  let categoryId: number;

  it("creates a tribe-scoped category", async () => {
    const cat = await repo.createCategory(tribeId, "Техника", "💻", userId);
    assert.ok(cat.id > 0);
    assert.equal(cat.name, "Техника");
    assert.equal(cat.emoji, "💻");
    assert.equal(cat.tribeId, tribeId);
    assert.equal(cat.createdByUserId, userId);
    assert.equal(cat.isActive, true);
    categoryId = cat.id;

    const cats = await repo.getCategoriesByTribe(tribeId);
    assert.ok(cats.some((c) => c.id === categoryId));
  });

  it("creates an entry with a numeric price that round-trips as a NUMBER", async () => {
    const entry = await repo.createEntry({
      tribeId,
      categoryId,
      title: "Ноутбук",
      price: 1234.56,
      createdByUserId: userId,
      inputMethod: "text",
      visibility: "tribe",
    });
    assert.ok(entry.id > 0);
    assert.equal(entry.title, "Ноутбук");
    // The mapper stores numeric as string and parses it back with parseFloat.
    assert.equal(typeof entry.price, "number");
    assert.equal(entry.price, 1234.56);
    assert.equal(entry.visibility, "tribe");
    assert.equal(entry.isImportant, false);
    assert.equal(entry.isUrgent, false);
    // Joined fields present.
    assert.equal(entry.categoryName, "Техника");
    assert.equal(entry.addedByName, "Gandalf");
  });

  it("toggles important and urgent flags", async () => {
    const entry = await repo.createEntry({
      tribeId,
      categoryId,
      title: "Флаговая запись",
      createdByUserId: userId,
      visibility: "tribe",
    });
    assert.equal(entry.isImportant, false);
    assert.equal(entry.isUrgent, false);

    assert.equal(await repo.toggleEntryFlag(entry.id, tribeId, "important"), true);
    assert.equal(await repo.toggleEntryFlag(entry.id, tribeId, "urgent"), true);

    const afterToggle = await repo.getEntryById(entry.id, tribeId);
    assert.equal(afterToggle?.isImportant, true);
    assert.equal(afterToggle?.isUrgent, true);

    const scope = { type: "tribe", tribeId, userId } as const;
    const important = await repo.getEntriesByFlag(scope, "important");
    assert.ok(important.some((e) => e.id === entry.id));
    assert.ok((await repo.countEntriesByFlag(scope, "important")) >= 1);

    // Toggling important back off removes it from the important list.
    assert.equal(await repo.toggleEntryFlag(entry.id, tribeId, "important"), true);
    const afterUntoggle = await repo.getEntryById(entry.id, tribeId);
    assert.equal(afterUntoggle?.isImportant, false);
    assert.equal(afterUntoggle?.isUrgent, true);
  });

  it("scopes private entries to their creator within a tribe", async () => {
    const otherTg = 999000031;
    const { ensureUser } = await import("../src/expenses/repository.js");
    const other = await ensureUser(otherTg, "gandalfother", "Other", "Member", false);

    const priv = await repo.createEntry({
      tribeId,
      categoryId,
      title: "Приватная запись",
      createdByUserId: userId,
      visibility: "private",
    });
    assert.equal(priv.visibility, "private");

    const ownerScope = { type: "tribe", tribeId, userId } as const;
    const otherScope = { type: "tribe", tribeId, userId: other.id } as const;

    // Owner sees their own private entry via scoped lookup.
    const ownerView = await repo.getEntryByIdScoped(priv.id, ownerScope);
    assert.ok(ownerView);
    assert.equal(ownerView?.id, priv.id);

    // A different tribe member does NOT see another user's private entry.
    const otherView = await repo.getEntryByIdScoped(priv.id, otherScope);
    assert.equal(otherView, null);

    // Flip to tribe visibility → now the other member can see it.
    const newVis = await repo.toggleEntryVisibility(priv.id, tribeId);
    assert.equal(newVis, "tribe");
    const otherViewAfter = await repo.getEntryByIdScoped(priv.id, otherScope);
    assert.equal(otherViewAfter?.id, priv.id);

    // The extra member's user row must be removed before after() cleanup
    // (created_by_user_id is set-null on user delete, but keep it tidy).
    const { cleanupTestUser } = await import("./helpers/testDb.js");
    // Its private/tribe entry was created by `userId`, so cleanup of `otherTg` is safe.
    await cleanupTestUser(otherTg);
  });

  it("lists and counts entries by scope", async () => {
    const scope = { type: "tribe", tribeId, userId } as const;
    const entries = await repo.getEntriesByScope(scope, 100, 0);
    // Everything created above belongs to this category/tribe.
    assert.ok(entries.length >= 3);
    assert.ok(entries.every((e) => e.tribeId === tribeId));

    const scopeCount = await repo.countEntriesByScope(scope);
    assert.equal(scopeCount, entries.length);

    const byCategory = await repo.getEntriesByCategory(tribeId, categoryId, 100, 0);
    assert.ok(byCategory.length >= 3);
    const catCount = await repo.countEntriesByCategory(tribeId, categoryId);
    assert.equal(catCount, byCategory.length);
  });

  it("attaches a file to an entry", async () => {
    const entry = await repo.createEntry({
      tribeId,
      categoryId,
      title: "Запись с файлом",
      createdByUserId: userId,
      visibility: "tribe",
    });
    const file = await repo.addFileToEntry({
      entryId: entry.id,
      telegramFileId: "tg-file-abc",
      fileType: "photo",
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
      fileSizeBytes: 2048,
    });
    assert.ok(file.id > 0);
    assert.equal(file.entryId, entry.id);
    assert.equal(file.telegramFileId, "tg-file-abc");
    assert.equal(file.fileSizeBytes, 2048);

    const files = await repo.getFilesByEntry(entry.id);
    assert.equal(files.length, 1);
    assert.equal(files[0].id, file.id);
  });

  it("cascade-deletes a category, removing its entries", async () => {
    const cat = await repo.createCategory(tribeId, "Одноразовая", "🗑️", userId);
    const entry = await repo.createEntry({
      tribeId,
      categoryId: cat.id,
      title: "Уйдёт вместе с категорией",
      createdByUserId: userId,
      visibility: "tribe",
    });
    assert.ok(await repo.getEntryById(entry.id, tribeId));

    // deleteCategory is a soft delete (is_active=false); hard-delete the row to
    // exercise the FK cascade to gandalf_entries.
    const { db } = await import("../src/db/drizzle.js");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM gandalf_categories WHERE id = ${cat.id}`);

    assert.equal(await repo.getEntryById(entry.id, tribeId), null);
    assert.equal(await repo.getCategoryById(cat.id, tribeId), null);
  });
});
