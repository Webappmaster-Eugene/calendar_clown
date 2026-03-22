import http from "node:http";
import https from "node:https";
import { createLogger } from "./logger.js";

const log = createLogger("proxy");

let cachedAgent: http.Agent | undefined;

/**
 * Initialize proxy agent from TELEGRAM_PROXY env variable.
 * Supports socks5:// and http(s):// protocols.
 * Must be called once at startup, before creating the bot.
 */
export async function initProxyAgent(): Promise<http.Agent | undefined> {
  const proxyUrl = process.env.TELEGRAM_PROXY?.trim();
  if (!proxyUrl) {
    log.warn("TELEGRAM_PROXY not set — direct connection to Telegram API");
    return undefined;
  }

  const url = new URL(proxyUrl);
  const protocol = url.protocol.replace(":", "");

  if (protocol === "socks5" || protocol === "socks5h" || protocol === "socks4") {
    const { SocksProxyAgent } = await import("socks-proxy-agent");
    cachedAgent = new SocksProxyAgent(proxyUrl);
    log.info(`Telegram proxy configured: ${protocol}://${url.hostname}:${url.port}`);
  } else if (protocol === "http" || protocol === "https") {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    cachedAgent = new HttpsProxyAgent(proxyUrl);
    log.info(`Telegram proxy configured: ${protocol}://${url.hostname}:${url.port}`);
  } else {
    throw new Error(`Unsupported proxy protocol: ${protocol}. Use socks5://, http://, or https://`);
  }

  return cachedAgent;
}

/**
 * Get the cached proxy agent (or undefined if no proxy configured).
 */
export function getTelegramAgent(): http.Agent | undefined {
  return cachedAgent;
}

type TelegramFetchResult = {
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
};

/**
 * Single-attempt fetch using the Telegram proxy agent (if configured).
 * Uses native node:https to avoid CJS/ESM bundling issues with node-fetch.
 */
function telegramFetchOnce(
  url: string,
  timeoutMs: number,
): Promise<TelegramFetchResult> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(new Error(`telegramFetch timed out after ${timeoutMs}ms: ${url}`));
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
    };

    const req = https.get(url, { agent: cachedAgent as https.Agent | undefined }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        cleanup();
        if (settled) return;
        settled = true;
        const buffer = Buffer.concat(chunks);
        const status = res.statusCode ?? 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          text: async () => buffer.toString("utf-8"),
        });
      });
      res.on("error", (err) => {
        cleanup();
        if (settled) return;
        settled = true;
        reject(err);
      });
    });

    req.on("error", (err) => {
      cleanup();
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/**
 * Fetch a URL using the Telegram proxy agent (if configured).
 * Retries once after a 2-second delay on failure.
 *
 * @param url       — URL to fetch
 * @param options   — optional settings
 * @param options.timeoutMs — overall request timeout per attempt in ms (default: 120 000 = 2 min)
 * @param options.retries   — number of retry attempts on failure (default: 1)
 */
export async function telegramFetch(
  url: string,
  options?: { timeoutMs?: number; retries?: number },
): Promise<TelegramFetchResult> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const retries = options?.retries ?? 1;

  log.debug(`telegramFetch: ${url.substring(0, 80)}… proxy=${cachedAgent ? "yes" : "no"}, timeout=${timeoutMs}ms`);

  try {
    return await telegramFetchOnce(url, timeoutMs);
  } catch (err) {
    if (retries <= 0) throw err;

    const message = err instanceof Error ? err.message : String(err);
    log.warn(`telegramFetch failed (${message}), retrying in 2s… (${retries} retries left)`);

    await new Promise((r) => setTimeout(r, 2_000));
    return telegramFetch(url, { timeoutMs, retries: retries - 1 });
  }
}
