import os from "node:os";
import { isDatabaseAvailable, query } from "../db/connection.js";
import { getPollHealth } from "../health/pollWatchdog.js";
import { getQueueStatus, isTranscribeAvailable } from "../transcribe/queue.js";
import { BUILD_COMMIT, BUILD_DATE, COMMIT_DATE } from "../buildInfo.js";
import { TIMEZONE_MSK } from "../shared/constants.js";
import type { AdminSystemInfoDto } from "../shared/types.js";

const MB = 1024 * 1024;

function mb(bytes: number): number {
  return Math.round(bytes / MB);
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days > 0 ? `${days}д ${hours}ч ${minutes}м` : `${hours}ч ${minutes}м`;
}

/**
 * Average CPU share since process start — a cheap, sample-free number. It smooths
 * over spikes, so it answers "is this process busy in general?", not "right now".
 */
function averageCpuPercent(): number {
  const uptimeMs = process.uptime() * 1000;
  if (uptimeMs <= 0) return 0;
  const { user, system } = process.cpuUsage();
  const usedMs = (user + system) / 1000;
  const cores = Math.max(os.cpus().length, 1);
  return Math.round((usedMs / (uptimeMs * cores)) * 1000) / 10;
}

/** Round-trip time of a trivial query; null when the DB is not connected. */
async function probeDatabase(): Promise<{ up: boolean; latencyMs: number | null; error: string | null }> {
  if (!isDatabaseAvailable()) {
    return { up: false, latencyMs: null, error: "not connected" };
  }
  const started = Date.now();
  try {
    await query("SELECT 1");
    return { up: true, latencyMs: Date.now() - started, error: null };
  } catch (err) {
    return { up: false, latencyMs: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function isConfigured(...vars: string[]): boolean {
  return vars.every((v) => Boolean(process.env[v]?.trim()));
}

export async function collectSystemInfo(): Promise<AdminSystemInfoDto> {
  const uptimeSeconds = Math.floor(process.uptime());
  const mem = process.memoryUsage();
  const cpus = os.cpus();

  const [database, queue] = await Promise.all([probeDatabase(), getQueueStatus()]);
  const poll = getPollHealth();

  return {
    build: {
      commitHash: BUILD_COMMIT,
      buildDate: BUILD_DATE,
      commitDate: COMMIT_DATE,
      env: process.env.NODE_ENV ?? "production",
    },
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: formatUptime(uptimeSeconds),
      uptimeSeconds,
      startedAt: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
      serverTime: new Date().toISOString(),
      timezone: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? TIMEZONE_MSK,
      hostname: os.hostname(),
    },
    memory: {
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
      heapTotalMb: mb(mem.heapTotal),
      externalMb: mb(mem.external),
      systemTotalMb: mb(os.totalmem()),
      systemFreeMb: mb(os.freemem()),
    },
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model?.trim() ?? "unknown",
      loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
      averagePercent: averageCpuPercent(),
    },
    services: {
      database,
      polling: {
        healthy: poll.healthy,
        lastActivityAt: poll.lastActivityAt ? new Date(poll.lastActivityAt).toISOString() : null,
        lastOkAt: poll.lastOkAt ? new Date(poll.lastOkAt).toISOString() : null,
        consecutiveFailures: poll.consecutiveFailures,
        maxFailures: poll.maxFailures,
        lastError: poll.lastError,
      },
      transcribeQueue: isTranscribeAvailable() ? queue : null,
    },
    // Names must mirror what the runtime actually reads, or the lamp lies: the
    // OpenRouter proxy falls back to TELEGRAM_PROXY (utils/proxyAgent.ts) and the
    // MTProto client reads TELEGRAM_PARSER_* (digest/telegramClient.ts).
    integrations: {
      googleCalendar: isConfigured("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "OAUTH_REDIRECT_URI"),
      openRouter: isConfigured("OPENROUTER_API_KEY"),
      openRouterProxy: isConfigured("OPENROUTER_PROXY") || isConfigured("TELEGRAM_PROXY"),
      telegramProxy: isConfigured("TELEGRAM_PROXY"),
      tavily: isConfigured("TAVILY_API_KEY"),
      mtproto: isConfigured("TELEGRAM_PARSER_API_ID", "TELEGRAM_PARSER_API_HASH"),
      redis: isConfigured("REDIS_URL"),
      bankWebhook: isConfigured("OAUTH_REDIRECT_URI"),
      telemetry: isConfigured("OTEL_EXPORTER_OTLP_ENDPOINT"),
    },
  };
}
