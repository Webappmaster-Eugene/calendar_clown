import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchWorkName } from "../src/voice/extractTaskIntent.js";

describe("matchWorkName", () => {
  const works = ["Росатом", "9RED", "Королёв"];

  it("matches case-insensitively", () => {
    assert.equal(matchWorkName("росатом", works), "Росатом");
    assert.equal(matchWorkName("9red", works), "9RED");
  });

  it("normalizes ё/е and punctuation", () => {
    assert.equal(matchWorkName("королев", works), "Королёв");
    assert.equal(matchWorkName("«Росатом».", works), "Росатом");
  });

  it("matches a unique containment (spoken name carries extra words)", () => {
    assert.equal(matchWorkName("проект Росатом", works), "Росатом");
  });

  it("returns null on ambiguous containment", () => {
    assert.equal(matchWorkName("проект", ["Проект А", "Проект Б"]), null);
  });

  it("returns null for no candidate, no match, or too-short fragments", () => {
    assert.equal(matchWorkName(null, works), null);
    assert.equal(matchWorkName("Газпром", works), null);
    assert.equal(matchWorkName("ab", ["abc"]), null);
  });
});
