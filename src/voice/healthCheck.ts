// Catalogue lookup only checks that a model id EXISTS; it does NOT verify that the
// pinned provider (e.g. google-vertex, allow_fallbacks:false) has an active endpoint —
// OpenRouter can still 404 "No endpoints found" at request time. Verifying that would
// need a real STT round-trip at boot; the runtime fallback chain in callStt is the net.

import { TRANSCRIBE_MODEL, TRANSCRIBE_MODEL_HQ, TRANSCRIBE_MODEL_FALLBACKS } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import { openRouterRequest } from "../utils/proxyAgent.js";

const log = createLogger("stt-healthcheck");

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const HEALTHCHECK_TIMEOUT_MS = 10_000;

interface OpenRouterModelsResponse {
  data?: Array<{ id?: string }>;
}

export async function validateSttModels(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    log.debug("OPENROUTER_API_KEY not set — skipping STT model health-check.");
    return;
  }

  const configured = Array.from(
    new Set([TRANSCRIBE_MODEL, TRANSCRIBE_MODEL_HQ, ...TRANSCRIBE_MODEL_FALLBACKS].filter(Boolean)),
  );
  if (configured.length === 0) return;

  let available: Set<string>;
  try {
    // Use the proxy path so the check matches real STT calls, not a directly-blocked one.
    const res = await openRouterRequest(OPENROUTER_MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: HEALTHCHECK_TIMEOUT_MS,
    });
    if (!res.ok) {
      log.debug(`STT health-check: catalogue request returned ${res.status}, skipping.`);
      return;
    }
    const json = (await res.json()) as OpenRouterModelsResponse;
    available = new Set((json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id)));
  } catch (err) {
    log.debug(`STT health-check: catalogue request failed (${err instanceof Error ? err.message : String(err)}), skipping.`);
    return;
  }

  const missing = configured.filter((m) => !available.has(m));
  if (missing.length === 0) {
    log.info(
      `STT models present in catalogue: ${configured.join(", ")} ` +
        `(this does not guarantee provider endpoints — see callStt fallback chain).`
    );
    return;
  }
  log.error(
    `STT models NOT available on OpenRouter: ${missing.join(", ")}. ` +
      `Update STT_MODEL / STT_MODEL_HQ / STT_MODEL_FALLBACKS to a valid slug.`,
  );
}
