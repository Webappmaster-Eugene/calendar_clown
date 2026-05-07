import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRetryableUpstreamError } from "../src/voice/sttClient.js";

describe("isRetryableUpstreamError", () => {
  it("retries on 5xx server errors", () => {
    assert.equal(isRetryableUpstreamError(500, "internal server error"), true);
    assert.equal(isRetryableUpstreamError(502, "bad gateway"), true);
    assert.equal(isRetryableUpstreamError(503, "service unavailable"), true);
  });

  it("retries on 429 rate limit", () => {
    assert.equal(isRetryableUpstreamError(429, "Too many requests"), true);
  });

  it("retries on 'No endpoints found' (production regression — DNT-9582)", () => {
    const body =
      '{"error":{"message":"No endpoints found for google/gemini-2.0-flash-001.","code":404}}';
    assert.equal(isRetryableUpstreamError(404, body), true);
  });

  it("retries on any 404 (OpenRouter routing failure)", () => {
    assert.equal(isRetryableUpstreamError(404, "anything"), true);
  });

  it("retries on 'no providers' / 'no allowed providers'", () => {
    assert.equal(isRetryableUpstreamError(400, "No providers available for the requested model"), true);
    assert.equal(isRetryableUpstreamError(400, "No allowed providers"), true);
  });

  it("retries on 'provider returned error'", () => {
    assert.equal(isRetryableUpstreamError(502, "Provider returned error"), true);
  });

  it("retries on geo-block phrasing", () => {
    assert.equal(
      isRetryableUpstreamError(400, "User location is not supported for the API use."),
      true
    );
    assert.equal(
      isRetryableUpstreamError(400, "Location not available in this region"),
      true
    );
  });

  it("retries when model id is unknown to the catalogue", () => {
    assert.equal(isRetryableUpstreamError(400, "is not a valid model id"), true);
    assert.equal(isRetryableUpstreamError(400, "Model not found"), true);
  });

  it("does NOT retry on 401 / 403 auth failures", () => {
    assert.equal(isRetryableUpstreamError(401, "Invalid API key"), false);
    assert.equal(isRetryableUpstreamError(403, "Forbidden"), false);
  });

  it("does NOT retry on 400 with unrelated message (preserves precise client errors)", () => {
    assert.equal(isRetryableUpstreamError(400, "Malformed request body"), false);
    assert.equal(isRetryableUpstreamError(422, "Unprocessable entity"), false);
  });
});
