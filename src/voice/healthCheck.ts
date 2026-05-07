/**
 * Startup validation for STT model identifiers against the OpenRouter catalogue.
 * Logs a warning if a configured model is missing, so deprecations surface at
 * boot rather than on the first user voice message.
 *
 * IMPORTANT — what this does NOT cover:
 *   The catalogue lookup only checks that a model id exists. It does NOT verify
 *   that any provider has an active *endpoint* for the (model, provider) pair
 *   we actually request. With `provider: { order: ["google-vertex"],
 *   allow_fallbacks: false }` (our default for Google models, see `sttClient.ts`),
 *   OpenRouter can still return `404 "No endpoints found for <model>"` at
 *   request time — the model is in the catalogue, but the pinned provider has
 *   no endpoint for this account/region. Surfacing that here would require a
 *   real STT round-trip at boot, which is out of scope for a non-blocking
 *   health-check. The runtime fallback chain in `callStt` is the safety net.
 *
 * Non-blocking: any network or auth failure is downgraded to a debug log.
 */

import { TRANSCRIBE_MODEL, TRANSCRIBE_MODEL_HQ, TRANSCRIBE_MODEL_FALLBACKS } from "../constants.js";
import { createLogger } from "../utils/logger.js";

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS);

  let available: Set<string>;
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
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
  } finally {
    clearTimeout(timer);
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
