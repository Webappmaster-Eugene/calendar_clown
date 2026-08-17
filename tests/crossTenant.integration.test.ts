import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Two real users, one dataset each: proves that an id belonging to somebody else
 * cannot be toggled, edited or deleted. Object ids reach these calls from client
 * input (API path params, bot callback_data) and are sequential, so "the caller
 * checked first" is not a guarantee — the owner has to be in the query.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/crossTenant.integration.test.ts
 */

const OWNER_TG = 999_000_120;
const ATTACKER_TG = 999_000_121;

let ownerId: number;
let attackerId: number;
let goalsRepo: typeof import("../src/goals/repository.js");
let wishlistRepo: typeof import("../src/wishlist/repository.js");
let summarizerRepo: typeof import("../src/summarizer/repository.js");

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  const fixtures = await seedFixtures();

  const { ensureUser, setUserTribe } = await import("../src/expenses/repository.js");
  const owner = await ensureUser(OWNER_TG, "owner", "Owner", "User", false);
  const attacker = await ensureUser(ATTACKER_TG, "attacker", "Attacker", "User", false);
  ownerId = owner.id;
  attackerId = attacker.id;
  // Wishlists live inside a tribe; both users share one, which is the permissive case.
  await setUserTribe(OWNER_TG, fixtures.tribeId);
  await setUserTribe(ATTACKER_TG, fixtures.tribeId);

  goalsRepo = await import("../src/goals/repository.js");
  wishlistRepo = await import("../src/wishlist/repository.js");
  summarizerRepo = await import("../src/summarizer/repository.js");
});

after(async () => {
  const { db } = await import("../src/db/drizzle.js");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM goal_sets WHERE user_id IN (${ownerId}, ${attackerId})`);
  await db.execute(sql`DELETE FROM wishlists WHERE user_id IN (${ownerId}, ${attackerId})`);
  await db.execute(sql`DELETE FROM workplaces WHERE user_id IN (${ownerId}, ${attackerId})`);
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(OWNER_TG);
  await cleanupTestUser(ATTACKER_TG);
  await closeTestDb();
});

describe("goals belong to their owner", () => {
  let goalId: number;

  before(async () => {
    const set = await goalsRepo.createGoalSet(ownerId, "Приватные цели", "month", null, "🎯");
    const goal = await goalsRepo.createGoal(set.id, "Секретная цель", "text");
    goalId = goal.id;
  });

  it("another user cannot toggle it", async () => {
    assert.equal(await goalsRepo.toggleGoalCompleted(goalId, attackerId), null);
  });

  it("another user cannot rewrite its text", async () => {
    assert.equal(await goalsRepo.updateGoalText(goalId, attackerId, "взломано"), null);
  });

  it("another user cannot delete it", async () => {
    assert.equal(await goalsRepo.deleteGoal(goalId, attackerId), false);
  });

  it("the goal is still intact and untouched", async () => {
    const set = (await goalsRepo.getGoalSetsByUser(ownerId))[0];
    const goals = await goalsRepo.getGoalsBySet(set.id);
    const goal = goals.find((g) => g.id === goalId);
    assert.ok(goal, "the goal must still exist");
    assert.equal(goal!.text, "Секретная цель");
    assert.equal(goal!.isCompleted, false);
  });

  it("the owner can still toggle and delete it", async () => {
    const toggled = await goalsRepo.toggleGoalCompleted(goalId, ownerId);
    assert.equal(toggled?.isCompleted, true);
    assert.equal(await goalsRepo.deleteGoal(goalId, ownerId), true);
  });
});

describe("wishlist items belong to their owner", () => {
  let itemId: number;

  before(async () => {
    const { tribeId } = await (await import("./helpers/testDb.js")).seedFixtures();
    const wishlist = await wishlistRepo.createWishlist(tribeId, ownerId, "Мой вишлист", "🎁");
    const item = await wishlistRepo.createItem({ wishlistId: wishlist.id, title: "Подарок", priority: 1 });
    itemId = item.id;
  });

  it("a tribe-mate cannot delete somebody else's item", async () => {
    assert.equal(await wishlistRepo.deleteItem(itemId, attackerId), false);
    assert.ok(await wishlistRepo.getItemById(itemId), "the item must survive");
  });

  it("the owner can delete it", async () => {
    assert.equal(await wishlistRepo.deleteItem(itemId, ownerId), true);
  });
});

describe("achievements belong to their owner", () => {
  let achievementId: number;

  before(async () => {
    const workplace = await summarizerRepo.createWorkplace(ownerId, "Моя работа", "💼");
    const achievement = await summarizerRepo.createAchievement(workplace.id, "Секретное достижение", "text");
    achievementId = achievement.id;
  });

  it("another user cannot delete it", async () => {
    assert.equal(await summarizerRepo.deleteAchievement(achievementId, attackerId), false);
  });

  it("the owner can delete it", async () => {
    assert.equal(await summarizerRepo.deleteAchievement(achievementId, ownerId), true);
  });
});
