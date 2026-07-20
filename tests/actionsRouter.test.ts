import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UserMenuContext } from "../src/shared/auth.js";
import { routeDo, selectAction, fillArgs, type LlmComplete } from "../src/actions/router.js";
import { getAction } from "../src/actions/registry.js";
import { renderResult } from "../src/actions/render.js";
import { actionArgsJsonSchema } from "../src/actions/schema.js";

/**
 * Unit tests for the /do NL router (mocked LLM — no network/DB), plus render and
 * schema serialization. Verifies two-stage routing, access filtering, self-repair.
 */

const tribeMenu: UserMenuContext = { role: "user", status: "approved", hasTribe: true, tribeId: 1, tribeName: "T" };
const noTribeMenu: UserMenuContext = { role: "user", status: "approved", hasTribe: false, tribeId: null, tribeName: null };
const NOW = new Date("2026-07-20T09:00:00Z");

/** Build a mocked LLM: stage A is detected by the routing prompt, stage B by the arg-fill prompt. */
function mockLlm(opts: { action?: string | null; argsSeq?: string[] }): LlmComplete {
  let argCall = 0;
  return async (system: string) => {
    if (system.includes("маршрутизатор")) {
      return JSON.stringify({ action: opts.action ?? null });
    }
    // arg-fill stage
    const seq = opts.argsSeq ?? ["{}"];
    const out = seq[Math.min(argCall, seq.length - 1)];
    argCall += 1;
    return out;
  };
}

describe("router: selectAction", () => {
  it("picks an accessible action by name", async () => {
    const a = await selectAction("создай напоминание", tribeMenu, mockLlm({ action: "reminders.create" }));
    assert.equal(a?.name, "reminders.create");
  });

  it("returns null when the model picks nothing", async () => {
    const a = await selectAction("привет", tribeMenu, mockLlm({ action: null }));
    assert.equal(a, null);
  });

  it("rejects a hallucinated / unknown action", async () => {
    const a = await selectAction("x", tribeMenu, mockLlm({ action: "totally.madeup" }));
    assert.equal(a, null);
  });

  it("rejects an action the user cannot access (tribe mode without tribe)", async () => {
    const a = await selectAction("добавь задачу", noTribeMenu, mockLlm({ action: "tasks.item.add" }));
    assert.equal(a, null);
  });
});

describe("router: fillArgs", () => {
  const create = getAction("reminders.create")!;

  it("fills and validates arguments", async () => {
    const res = await fillArgs(
      "пить воду в 10:00",
      create,
      mockLlm({ argsSeq: ['{"text":"пить воду","schedule":{"times":["10:00"],"weekdays":[]}}'] }),
      NOW,
    );
    assert.ok(res.ok);
    assert.deepEqual((res as { ok: true; args: { text: string } }).args.text, "пить воду");
  });

  it("self-repairs once when the first attempt is invalid", async () => {
    const res = await fillArgs(
      "пить воду",
      create,
      mockLlm({ argsSeq: ["{}", '{"text":"пить воду","schedule":{"times":["10:00"],"weekdays":[1]}}'] }),
      NOW,
    );
    assert.ok(res.ok);
  });

  it("fails after repair still invalid", async () => {
    const res = await fillArgs("пить воду", create, mockLlm({ argsSeq: ["{}", "{}"] }), NOW);
    assert.equal(res.ok, false);
  });
});

describe("router: routeDo end-to-end", () => {
  it("returns ok with action + args", async () => {
    const r = await routeDo(
      "создай напоминание пить воду в 10:00",
      tribeMenu,
      mockLlm({ action: "reminders.create", argsSeq: ['{"text":"пить воду","schedule":{"times":["10:00"],"weekdays":[]}}'] }),
      NOW,
    );
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") assert.equal(r.action.name, "reminders.create");
  });

  it("no_action when nothing matches", async () => {
    const r = await routeDo("как дела", tribeMenu, mockLlm({ action: null }), NOW);
    assert.equal(r.kind, "no_action");
  });

  it("invalid_args when args cannot be filled", async () => {
    const r = await routeDo("напоминание", tribeMenu, mockLlm({ action: "reminders.create", argsSeq: ["{}", "{}"] }), NOW);
    assert.equal(r.kind, "invalid_args");
  });
});

describe("schema + render", () => {
  it("actionArgsJsonSchema produces an object schema with properties", () => {
    const schema = actionArgsJsonSchema(getAction("reminders.create")!);
    assert.equal(schema.type, "object");
    assert.ok(schema.properties && typeof schema.properties === "object");
  });

  it("renders JSON with a code fence", () => {
    const action = getAction("reminders.list")!;
    const out = renderResult(action, { data: [{ id: 7, text: "пить воду" }] }, { json: true });
    assert.ok(out.includes("```json"));
    assert.ok(out.includes('"id": 7'));
  });

  it("renders a human list with ids", () => {
    const action = getAction("reminders.list")!;
    const out = renderResult(action, { data: [{ id: 7, text: "пить воду" }] }, {});
    assert.ok(out.includes("#7"));
    assert.ok(out.includes("пить воду"));
  });

  it("renders a single object result with id", () => {
    const action = getAction("reminders.create")!;
    const out = renderResult(action, { data: { id: 42, text: "чай" } }, {});
    assert.ok(out.includes("#42"));
  });
});
