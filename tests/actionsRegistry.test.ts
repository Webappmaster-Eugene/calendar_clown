import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAllActions } from "../src/actions/registry.js";
import { actionArgsJsonSchema } from "../src/actions/schema.js";

/**
 * Structural validation of the whole Action Registry (all 18 mode catalogs).
 * No DB/network: loading the registry already enforces unique names; here we
 * assert full mode coverage and that every action's args serialize to a JSON
 * Schema object (required by the MCP `inputSchema` and the /do arg-fill step).
 */

const EXPECTED_MODES = new Set([
  "calendar", "expenses", "transcribe", "simplifier", "digest", "broadcast",
  "notable_dates", "gandalf", "neuro", "wishlist", "goals", "reminders",
  "osint", "summarizer", "blogger", "nutritionist", "admin", "tasks",
]);

describe("action registry", () => {
  it("loads with unique names and a substantial action count", () => {
    const actions = getAllActions();
    assert.ok(actions.length >= 80, `expected >=80 actions, got ${actions.length}`);
    const names = new Set(actions.map((a) => a.name));
    assert.equal(names.size, actions.length, "action names must be unique");
  });

  it("covers all 18 modes", () => {
    const modes = new Set(getAllActions().map((a) => a.mode));
    for (const m of EXPECTED_MODES) {
      assert.ok(modes.has(m), `mode ${m} has no actions`);
    }
    assert.equal(modes.size, EXPECTED_MODES.size);
  });

  it("every action has required metadata and a JSON-Schema-serializable args schema", () => {
    for (const a of getAllActions()) {
      assert.ok(a.name && a.mode && a.humanTitle && a.description, `metadata missing on ${a.name}`);
      assert.equal(typeof a.mutates, "boolean", `mutates flag missing on ${a.name}`);
      assert.ok(EXPECTED_MODES.has(a.mode), `unknown mode ${a.mode} on ${a.name}`);
      const schema = actionArgsJsonSchema(a);
      assert.equal(schema.type, "object", `args schema of ${a.name} must be an object`);
    }
  });

  it("names follow the <mode>.<verb> convention", () => {
    for (const a of getAllActions()) {
      assert.match(a.name, /^[a-z_]+(\.[a-zA-Z]+)+$/, `bad action name: ${a.name}`);
    }
  });
});
