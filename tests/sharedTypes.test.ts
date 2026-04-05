import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MODE_LABELS,
  INDIVIDUAL_MODES,
  TRIBE_MODES,
  ADMIN_MODES,
  TIMEZONE_MSK,
  DEFAULT_MONTHLY_LIMIT,
  MAX_EXPENSE_AMOUNT,
  MIN_EXPENSE_AMOUNT,
  MAX_REMINDERS_PER_USER,
  MAX_WORKPLACES_PER_USER,
  MAX_BLOGGER_CHANNELS,
} from "../src/shared/constants.js";

const ALL_MODES = [
  "calendar", "expenses", "transcribe", "simplifier", "digest", "gandalf", "neuro",
  "goals", "reminders", "wishlist", "notable_dates", "osint",
  "summarizer", "blogger", "broadcast", "admin", "tasks", "nutritionist",
];

describe("MODE_LABELS", () => {
  it("contains all known modes", () => {
    for (const mode of ALL_MODES) {
      assert.ok(MODE_LABELS[mode], `Missing MODE_LABELS entry for: ${mode}`);
    }
  });

  it("each entry has label, emoji, description", () => {
    for (const [mode, meta] of Object.entries(MODE_LABELS)) {
      assert.ok(meta.label, `${mode}: missing label`);
      assert.ok(meta.emoji, `${mode}: missing emoji`);
      assert.ok(meta.description, `${mode}: missing description`);
    }
  });

  it("has no extra modes beyond known set", () => {
    for (const mode of Object.keys(MODE_LABELS)) {
      assert.ok(ALL_MODES.includes(mode), `Unexpected mode in MODE_LABELS: ${mode}`);
    }
  });
});

describe("Mode category arrays", () => {
  it("INDIVIDUAL_MODES + TRIBE_MODES + ADMIN_MODES cover all modes", () => {
    const allCategorized = new Set([
      ...INDIVIDUAL_MODES,
      ...TRIBE_MODES,
      ...ADMIN_MODES,
    ]);
    for (const mode of ALL_MODES) {
      assert.ok(allCategorized.has(mode), `Mode ${mode} not in any category`);
    }
  });

  it("mode categories don't overlap", () => {
    const sets = [INDIVIDUAL_MODES, TRIBE_MODES, ADMIN_MODES];
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        for (const mode of sets[i]) {
          assert.ok(
            !sets[j].includes(mode as never),
            `Mode ${mode} is in multiple categories`
          );
        }
      }
    }
  });
});

describe("Shared constants", () => {
  it("TIMEZONE_MSK is Europe/Moscow", () => {
    assert.equal(TIMEZONE_MSK, "Europe/Moscow");
  });

  it("expense limits are valid", () => {
    assert.ok(DEFAULT_MONTHLY_LIMIT > 0);
    assert.ok(MAX_EXPENSE_AMOUNT > MIN_EXPENSE_AMOUNT);
    assert.ok(MIN_EXPENSE_AMOUNT >= 1);
  });

  it("feature limits are positive", () => {
    assert.ok(MAX_REMINDERS_PER_USER > 0);
    assert.ok(MAX_WORKPLACES_PER_USER > 0);
    assert.ok(MAX_BLOGGER_CHANNELS > 0);
  });
});
