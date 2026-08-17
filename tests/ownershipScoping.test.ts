import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Object ids reach these calls straight from the client — an API path param or the
 * bot's callback_data — so the owner has to be part of the query, not a check a
 * caller may forget. These assertions read the source because the alternative
 * (a live cross-tenant write) is exactly what must never be possible.
 */

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("repository mutations take an owner", () => {
  it("goal mutations are scoped through their goal set", () => {
    const src = read("src/goals/repository.ts");
    for (const fn of ["toggleGoalCompleted", "updateGoalText", "deleteGoal"]) {
      const sig = new RegExp(`export async function ${fn}\\(([^)]*)\\)`).exec(src)?.[1] ?? "";
      assert.match(sig, /userId: number/, `${fn} must require an owner`);
    }
    assert.match(src, /function ownedGoal\(/, "ownership belongs in a shared WHERE helper");
  });

  it("wishlist item deletion is scoped through its wishlist", () => {
    const sig = /export async function deleteItem\(([^)]*)\)/.exec(read("src/wishlist/repository.ts"))?.[1] ?? "";
    assert.match(sig, /ownerUserId: number/);
  });

  it("achievement deletion is scoped through its workplace", () => {
    const sig = /export async function deleteAchievement\(([^)]*)\)/.exec(read("src/summarizer/repository.ts"))?.[1] ?? "";
    assert.match(sig, /ownerUserId: number/);
  });
});

describe("services resolve the caller before mutating", () => {
  const cases: Array<[string, string[]]> = [
    ["src/services/goalsService.ts", ["toggleGoal", "editGoalText", "removeGoal"]],
    ["src/services/wishlistService.ts", ["removeWishlistItem"]],
    ["src/services/summarizerService.ts", ["removeAchievement"]],
  ];

  for (const [file, fns] of cases) {
    it(`${file.split("/").pop()} passes the owner down`, () => {
      const src = read(file);
      for (const fn of fns) {
        const body = src.split(`export async function ${fn}(`)[1]?.split("\nexport ")[0] ?? "";
        assert.ok(body, `${fn} not found`);
        assert.match(body, /requireDbUser\(telegramId\)/, `${fn} must resolve the caller`);
        assert.match(body, /dbUser\.id/, `${fn} must pass the owner to the repository`);
      }
    });
  }
});

describe("bot callbacks do not trust callback_data ids", () => {
  it("goal callbacks resolve the user before touching a goal", () => {
    const src = read("src/commands/goalsMode.ts");
    assert.match(src, /toggleGoalCompleted\(goalId, dbUser\.id\)/);
    assert.match(src, /deleteGoal\(goalId, dbUser\.id\)/);
  });

  it("achievement and wishlist-item deletion pass the owner", () => {
    assert.match(read("src/commands/summarizerMode.ts"), /deleteAchievement\(achId, dbUser\.id\)/);
    assert.match(read("src/commands/wishlistMode.ts"), /deleteItem\(itemId, dbUser\.id\)/);
  });
});

describe("abuse limits", () => {
  it("failed auth is rate-limited before authentication runs", () => {
    const router = read("src/api/router.ts");
    const authAt = router.indexOf("authAttemptLimit(");
    const apiAuthAt = router.indexOf("apiAuthMiddleware()");
    assert.ok(authAt > 0 && apiAuthAt > 0);
    assert.ok(authAt < apiAuthAt, "the attempt limiter must run before the auth middleware");
  });

  it("audio uploads are size-capped before being buffered", () => {
    for (const file of ["src/api/routes/voice.ts", "src/api/routes/simplifier.ts"]) {
      assert.match(read(file), /MAX_UPLOAD_BYTES/, `${file} must cap upload size`);
    }
  });

  it("initData hashes are compared in constant time", () => {
    assert.match(read("src/api/authMiddleware.ts"), /timingSafeEqual/);
  });

  it("link fetching re-checks every redirect hop", () => {
    const src = read("src/blogger/contentFetcher.ts");
    assert.match(src, /redirect: "manual"/);
    assert.match(src, /MAX_REDIRECTS/);
    // assertPublicUrl must sit inside the redirect loop, not only before it.
    const loop = src.split("for (let hop")[1]?.split("}\n\nexport")[0] ?? "";
    assert.match(loop, /assertPublicUrl\(current\)/);
  });
});
