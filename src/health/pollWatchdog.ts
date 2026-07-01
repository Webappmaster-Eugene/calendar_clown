import type { Telegraf } from "telegraf";
import { createLogger } from "../utils/logger.js";

/**
 * Poll watchdog — liveness monitor for the Telegraf long-polling loop.
 *
 * Problem it solves: the bot process hosts both the HTTP health server and the
 * Telegraf poller in a single process. A transient network blip to the proxy can
 * wedge the poller (stale sockets in the proxy-agent pool / getUpdates stuck)
 * while the process — and the HTTP `/health` endpoint — stay alive. The bot then
 * silently stops responding until someone restarts it by hand.
 *
 * Detection: a lightweight `getMe()` probe runs on an interval through the same
 * proxy agent as the poller. Consecutive probe failures (or a real inbound update
 * — see {@link markPollActivity}) drive a single boolean liveness state.
 *
 * Recovery: after {@link MAX_FAILURES} consecutive failures the process exits with
 * code 1, letting Docker's `restart: unless-stopped` bring up a fresh process with
 * a fresh socket pool. {@link getPollHealth} exposes the same state to `/health`
 * so an external orchestrator (Dokploy / autoheal) can react too.
 */

const log = createLogger("poll-watchdog");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const INTERVAL_MS = envInt("POLL_WATCHDOG_INTERVAL_MS", 60_000);
const TIMEOUT_MS = envInt("POLL_WATCHDOG_TIMEOUT_MS", 15_000);
const MAX_FAILURES = envInt("POLL_WATCHDOG_MAX_FAILURES", 3);

export interface PollHealth {
  /** False once the poller is presumed wedged (drives HTTP 503 on /health). */
  healthy: boolean;
  /** ms since epoch when the watchdog was started. */
  startedAt: number;
  /** ms since epoch of the last completed probe (null before the first). */
  lastProbeAt: number | null;
  /** Whether the most recent liveness signal (probe or update) succeeded. */
  lastProbeOk: boolean;
  /** ms since epoch of the last positive liveness signal (probe or update). */
  lastOkAt: number | null;
  /** ms since epoch of the last real inbound update delivered by the poller. */
  lastActivityAt: number | null;
  /** Consecutive failed probes since the last success. */
  consecutiveFailures: number;
  /** Failure count at which the process self-restarts. */
  maxFailures: number;
  /** Message of the most recent probe failure (null when healthy). */
  lastError: string | null;
}

const state: Omit<PollHealth, "healthy" | "maxFailures"> = {
  startedAt: Date.now(),
  lastProbeAt: null,
  lastProbeOk: true,
  lastOkAt: null,
  lastActivityAt: null,
  consecutiveFailures: 0,
  lastError: null,
};

let timer: ReturnType<typeof setInterval> | null = null;
let probeInFlight = false;

/**
 * Record proof of life from a real inbound update. Called by the top-level bot
 * middleware: a delivered update means getUpdates succeeded, so the poller is
 * demonstrably alive — clear any accumulated probe failures.
 */
export function markPollActivity(): void {
  const now = Date.now();
  state.lastActivityAt = now;
  state.lastOkAt = now;
  state.lastProbeOk = true;
  if (state.consecutiveFailures > 0) {
    log.info(
      "Inbound update received — clearing %d watchdog failure(s).",
      state.consecutiveFailures,
    );
    state.consecutiveFailures = 0;
    state.lastError = null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`probe timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    );
  });
}

async function probe(bot: Telegraf): Promise<void> {
  // A hung getMe() keeps its underlying request pending past the timeout; skip
  // overlapping probes so we count one failure per interval, not a pile-up.
  if (probeInFlight) return;
  probeInFlight = true;
  try {
    await withTimeout(bot.telegram.getMe(), TIMEOUT_MS);
    if (state.consecutiveFailures > 0) {
      log.info("Watchdog probe recovered after %d failure(s).", state.consecutiveFailures);
    }
    state.lastProbeAt = Date.now();
    state.lastProbeOk = true;
    state.lastOkAt = state.lastProbeAt;
    state.consecutiveFailures = 0;
    state.lastError = null;
  } catch (err) {
    state.lastProbeAt = Date.now();
    state.lastProbeOk = false;
    state.consecutiveFailures += 1;
    state.lastError = err instanceof Error ? err.message : String(err);
    log.error(
      "Watchdog probe failed (%d/%d): %s",
      state.consecutiveFailures,
      MAX_FAILURES,
      state.lastError,
    );
    // Don't force a restart if the watchdog was stopped mid-probe (shutdown in
    // progress) — let the graceful exit run its course.
    if (state.consecutiveFailures >= MAX_FAILURES && timer !== null) {
      const seconds = Math.round((INTERVAL_MS * state.consecutiveFailures) / 1000);
      log.error("=".repeat(60));
      log.error(
        "Telegram unreachable for %d consecutive probes (~%ds) — poller presumed wedged.",
        state.consecutiveFailures,
        seconds,
      );
      log.error("Exiting (code 1) so Docker restarts with a fresh process.");
      log.error("=".repeat(60));
      process.exit(1);
    }
  } finally {
    probeInFlight = false;
  }
}

/**
 * Start the periodic liveness probe. Idempotent — a second call is a no-op.
 * Must be called after the bot has successfully launched.
 */
export function startPollWatchdog(bot: Telegraf): void {
  if (timer) return;
  state.startedAt = Date.now();
  timer = setInterval(() => {
    void probe(bot);
  }, INTERVAL_MS);
  // Don't let the watchdog timer keep the event loop alive on its own.
  if (typeof timer.unref === "function") timer.unref();
  log.info(
    "Poll watchdog started: probe every %ds, timeout %ds, self-restart after %d consecutive failures.",
    INTERVAL_MS / 1000,
    TIMEOUT_MS / 1000,
    MAX_FAILURES,
  );
}

/** Stop the watchdog (graceful shutdown). Idempotent. */
export function stopPollWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Current polling health for the `/health` endpoint. Unhealthy when the failure
 * threshold is reached, or when probes have gone stale (timer silently stopped
 * while the process lives).
 */
export function getPollHealth(): PollHealth {
  const failed = state.consecutiveFailures >= MAX_FAILURES;
  const staleAfterMs = INTERVAL_MS * (MAX_FAILURES + 2);
  const stale =
    timer !== null &&
    state.lastProbeAt !== null &&
    Date.now() - state.lastProbeAt > staleAfterMs;
  return {
    ...state,
    healthy: !failed && !stale,
    maxFailures: MAX_FAILURES,
  };
}
