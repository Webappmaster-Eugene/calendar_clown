import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import {
  attachStream,
  authorize,
  countOnlineSessionsForThread,
  countSessionsForThread,
  detachStream,
  newestSessionForThread,
  registerSession,
  sessionsForThread,
  unregisterSession,
} from "../src/cc/registry.js";

/** Enough of a ServerResponse for the registry: it only ever writes and ends. */
function fakeStream(): http.ServerResponse {
  return {
    write: () => true,
    end: () => undefined,
  } as unknown as http.ServerResponse;
}

function register(threadId: number) {
  return registerSession({
    userId: 1,
    groupId: -100123,
    machine: "mbp",
    hostname: "host",
    cwd: "/tmp/project",
    project: "project",
    branch: null,
    threadId,
  });
}

describe("cc registry: sessions sharing a topic", () => {
  beforeEach(() => {
    // The registry is module state; clear whatever earlier cases left behind.
    for (const thread of [900, 901]) {
      for (const s of sessionsForThread(thread)) unregisterSession(s.id);
    }
  });

  it("numbers sessions within a topic and restarts once it empties", () => {
    const first = register(900);
    const second = register(900);
    assert.equal(authorize(first.sessionId, first.sessionToken)?.ordinal, 1);
    assert.equal(authorize(second.sessionId, second.sessionToken)?.ordinal, 2);

    unregisterSession(first.sessionId);
    unregisterSession(second.sessionId);

    const afterEmpty = register(900);
    assert.equal(
      authorize(afterEmpty.sessionId, afterEmpty.sessionToken)?.ordinal,
      1,
      "#1 should mean the only session in the topic, not the third one this month",
    );
  });

  it("numbers each topic independently", () => {
    const a = register(900);
    const b = register(901);
    assert.equal(authorize(a.sessionId, a.sessionToken)?.ordinal, 1);
    assert.equal(authorize(b.sessionId, b.sessionToken)?.ordinal, 1);
  });

  it("counts only sessions with an attached stream as online", () => {
    const ghost = register(900);
    assert.equal(countSessionsForThread(900), 1);
    assert.equal(
      countOnlineSessionsForThread(900),
      0,
      "a registered session that never attached its stream cannot receive anything",
    );

    const live = authorize(ghost.sessionId, ghost.sessionToken);
    assert.ok(live);
    const stream = fakeStream();
    attachStream(live, stream);
    assert.equal(countOnlineSessionsForThread(900), 1);

    detachStream(live, stream);
    assert.equal(
      countOnlineSessionsForThread(900),
      0,
      "a dropped stream must not make the session look reachable",
    );
  });

  it("does not mistake a reconnect for a second terminal", () => {
    // A client that lost its stream re-registers; the stale session lingers in
    // the map until the sweeper. Warning about a "second session" there would be
    // a false alarm, so the check is on online sessions, not registered ones.
    const stale = register(900);
    const revived = authorize(stale.sessionId, stale.sessionToken);
    assert.ok(revived);
    const stream = fakeStream();
    attachStream(revived, stream);
    detachStream(revived, stream); // соединение оборвалось

    assert.equal(countSessionsForThread(900), 1);
    assert.equal(countOnlineSessionsForThread(900), 0);
  });

  it("addresses the newest session in a topic", () => {
    const first = register(900);
    const second = register(900);
    assert.equal(newestSessionForThread(900)?.id, second.sessionId);

    unregisterSession(second.sessionId);
    assert.equal(
      newestSessionForThread(900)?.id,
      first.sessionId,
      "when the newest leaves, the previous one inherits the topic",
    );
  });
});
