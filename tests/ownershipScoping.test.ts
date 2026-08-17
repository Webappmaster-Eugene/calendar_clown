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
  it("failed auth is counted, and only failures are ever blocked", () => {
    const auth = read("src/api/authMiddleware.ts");
    assert.match(auth, /recordAuthFailure\(c\)/, "failures must feed the limiter");

    // Everything after a successful validation must be reachable without consulting
    // the limiter: thousands of mobile users share one CGNAT address, so blocking an
    // address outright would lock out real users alongside an abuser.
    const afterSuccess = auth.split("const initData = validateInitData(")[1] ?? "";
    assert.doesNotMatch(afterSuccess, /recordAuthFailure|limited/, "valid requests must not be throttled by address");

    const limiter = read("src/api/rateLimitMiddleware.ts");
    assert.match(limiter, /AUTH_FAILURE_MAX/);
  });

  it("uploads are rejected on content-length, before the body is buffered", () => {
    for (const file of ["src/api/routes/voice.ts", "src/api/routes/simplifier.ts"]) {
      const src = read(file);
      assert.match(src, /MAX_UPLOAD_BYTES/, `${file} must cap upload size`);
      // The check has to precede the parse call, which buffers the whole body.
      const beforeParse = src.split("await c.req.formData()")[0];
      assert.match(beforeParse, /content-length/, `${file} must check content-length first`);
    }
    const csv = read("src/api/routes/notable-dates.ts");
    assert.match(csv.split("await c.req.parseBody()")[0], /content-length/, "CSV import must check content-length first");
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

describe("bot and webhook hardening", () => {
  it("webhook mode refuses to start without a strong secret", () => {
    const src = read("src/index.ts");
    const block = src.split("const webhookDomain =")[1]?.split("const MAX_RETRIES")[0] ?? "";
    assert.ok(block, "webhook block not found");
    assert.match(block, /TELEGRAM_WEBHOOK_SECRET/);
    assert.match(block, /process\.exit\(1\)/, "a missing secret must be fatal, not a warning");
    // Telegraf accepts every POST when no secret is set, so the length floor matters.
    assert.match(block, /secretToken\.length < 32/);
  });

  it("paid actions are rate-limited at every bot entry point", () => {
    const limiter = read("src/middleware/rateLimit.ts");
    assert.match(limiter, /checkCostlyRateLimit/);

    // Voice funnels through voiceEvent for every mode; photos, documents and OSINT
    // each spend money per message.
    for (const file of [
      "src/commands/voiceEvent.ts",
      "src/commands/chatMode.ts",
      "src/commands/osintMode.ts",
    ]) {
      assert.match(read(file), /checkCostlyRateLimit\(telegramId\)/, `${file} must cap costly actions`);
    }
  });

  it("digest folder import writes only into the caller's rubric", () => {
    const src = read("src/commands/digestMode.ts");
    const handler = src.split("export async function handleDigestFolderToCallback")[1]?.split("\nexport ")[0] ?? "";
    const beforeWrite = handler.split("addChannel(")[0];
    assert.match(beforeWrite, /getRubricForCallback\(ctx, rubricId\)/);
  });
});
