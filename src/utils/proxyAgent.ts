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

/**
 * Fetch a URL using the Telegram proxy agent (if configured).
 * Uses node-fetch@2 which supports the `agent` option, unlike native fetch.
 */
export async function telegramFetch(url: string): Promise<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
}> {
  const nodeFetch = (await import("node-fetch")).default;
  const agent = cachedAgent;

  const response = await nodeFetch(url, {
    agent: agent as https.Agent | undefined,
  });

  return {
    ok: response.ok,
    status: response.status,
    arrayBuffer: () => response.arrayBuffer(),
    text: () => response.text(),
  };
}
