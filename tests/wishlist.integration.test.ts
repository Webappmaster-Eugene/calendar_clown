import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for the Wishlist repository (real DB).
 * Wishlists are tribe-scoped; items cascade to item files. Run:
 *   DATABASE_URL=postgres://... npx tsx --test tests/wishlist.integration.test.ts
 */

const TG = 999000040;
let userId: number;
let tribeId: number;

let repo: typeof import("../src/wishlist/repository.js");

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();

  const { ensureUser } = await import("../src/expenses/repository.js");
  const user = await ensureUser(TG, "wishlisttest", "Wishlist", "Tester", false);
  userId = user.id;
  tribeId = user.tribeId;

  repo = await import("../src/wishlist/repository.js");
});

after(async () => {
  // Deleting wishlists cascades to items, which cascade to item files.
  const { db } = await import("../src/db/drizzle.js");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM wishlists WHERE user_id = ${userId}`);
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

describe("wishlist lifecycle", () => {
  let wishlistId: number;
  let itemId: number;

  it("creates a wishlist", async () => {
    const wl = await repo.createWishlist(tribeId, userId, "День рождения", "🎂");
    assert.ok(wl.id > 0);
    assert.equal(wl.name, "День рождения");
    assert.equal(wl.emoji, "🎂");
    assert.equal(wl.tribeId, tribeId);
    assert.equal(wl.userId, userId);
    assert.equal(wl.isActive, true);
    wishlistId = wl.id;

    const mine = await repo.getWishlistsByUser(userId);
    assert.ok(mine.some((w) => w.id === wishlistId));
    assert.equal(await repo.countWishlistsByUser(userId), mine.length);
  });

  it("enforces the partial-unique active name", async () => {
    // Same (user, name) while the first is still active must be rejected.
    await assert.rejects(() => repo.createWishlist(tribeId, userId, "День рождения", "🎁"));
  });

  it("adds items with priority, ordered by priority ascending", async () => {
    const high = await repo.createItem({
      wishlistId,
      title: "Наушники",
      description: "Беспроводные",
      link: "https://example.com/headphones",
      priority: 1,
    });
    const low = await repo.createItem({ wishlistId, title: "Книга", priority: 5 });
    itemId = high.id;

    assert.equal(high.priority, 1);
    assert.equal(high.description, "Беспроводные");
    assert.equal(high.link, "https://example.com/headphones");
    assert.equal(high.isReserved, false);
    assert.equal(high.reservedByUserId, null);
    assert.equal(low.priority, 5);

    const items = await repo.getItemsByWishlist(wishlistId, 100, 0);
    assert.equal(items.length, 2);
    // Ordered by priority asc: high (1) before low (5).
    assert.equal(items[0].id, high.id);
    assert.equal(items[1].id, low.id);
    assert.equal(await repo.countItemsByWishlist(wishlistId), 2);
  });

  it("reserves and unreserves an item", async () => {
    // Reserve succeeds once and records the reserver.
    assert.equal(await repo.reserveItem(itemId, userId), true);
    const reserved = await repo.getItemById(itemId);
    assert.equal(reserved?.isReserved, true);
    assert.equal(reserved?.reservedByUserId, userId);
    assert.equal(reserved?.reservedByName, "Wishlist");

    // A second reserve while already reserved is a no-op (guarded by is_reserved=false).
    assert.equal(await repo.reserveItem(itemId, userId), false);

    // A different user cannot unreserve someone else's reservation.
    assert.equal(await repo.unreserveItem(itemId, userId + 999999), false);

    // The reserving user can unreserve.
    assert.equal(await repo.unreserveItem(itemId, userId), true);
    const freed = await repo.getItemById(itemId);
    assert.equal(freed?.isReserved, false);
    assert.equal(freed?.reservedByUserId, null);
  });

  it("attaches a file to an item and cascades on hard-delete", async () => {
    const file = await repo.addFileToItem({
      itemId,
      telegramFileId: "tg-wish-file-1",
      fileType: "photo",
      fileName: "gift.png",
      mimeType: "image/png",
      fileSizeBytes: 4096,
    });
    assert.ok(file.id > 0);
    assert.equal(file.itemId, itemId);
    assert.equal(file.telegramFileId, "tg-wish-file-1");

    const files = await repo.getFilesByItem(itemId);
    assert.equal(files.length, 1);
    assert.equal(files[0].id, file.id);

    // Hard-deleting the item cascades to its files.
    assert.equal(await repo.deleteItem(itemId), true);
    assert.equal(await repo.getItemById(itemId), null);
    assert.equal((await repo.getFilesByItem(itemId)).length, 0);
  });

  it("soft-deletes the wishlist (row survives, drops out of active listings)", async () => {
    assert.equal(await repo.deleteWishlist(wishlistId, userId), true);

    // Not returned among the user's active wishlists.
    const mine = await repo.getWishlistsByUser(userId);
    assert.equal(mine.some((w) => w.id === wishlistId), false);
    assert.equal(await repo.countWishlistsByUser(userId), mine.length);

    // But the row still exists (soft delete): fetch-by-id (tribe-scoped) still returns it.
    const byId = await repo.getWishlistById(wishlistId, tribeId);
    assert.ok(byId);
    assert.equal(byId?.isActive, false);

    // Because the old wishlist is now inactive, the partial-unique index allows
    // re-creating a wishlist with the same name.
    const revived = await repo.createWishlist(tribeId, userId, "День рождения", "🎂");
    assert.ok(revived.id > 0);
    assert.notEqual(revived.id, wishlistId);
  });
});
