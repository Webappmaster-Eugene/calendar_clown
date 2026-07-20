import http from "node:http";
import https from "node:https";
import { createLogger } from "./logger.js";

const log = createLogger("proxy");

let cachedAgent: http.Agent | undefined;

/** Must be called once at startup, before creating the bot. */
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

let openRouterAgent: http.Agent | undefined;

// Needed because openrouter.ai edge-blocks some datacenter IPs. Call once at startup.
export async function initOpenRouterAgent(): Promise<http.Agent | undefined> {
  const proxyUrl = process.env.OPENROUTER_PROXY?.trim() || process.env.TELEGRAM_PROXY?.trim();
  if (!proxyUrl) {
    log.warn("OPENROUTER_PROXY/TELEGRAM_PROXY not set — direct connection to OpenRouter");
    return undefined;
  }

  const url = new URL(proxyUrl);
  const protocol = url.protocol.replace(":", "");

  if (protocol === "socks5" || protocol === "socks5h" || protocol === "socks4") {
    const { SocksProxyAgent } = await import("socks-proxy-agent");
    openRouterAgent = new SocksProxyAgent(proxyUrl);
  } else if (protocol === "http" || protocol === "https") {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    openRouterAgent = new HttpsProxyAgent(proxyUrl);
  } else {
    throw new Error(`Unsupported OPENROUTER_PROXY protocol: ${protocol}. Use socks5://, http://, or https://`);
  }

  log.info(`OpenRouter proxy configured: ${protocol}://${url.hostname}:${url.port}`);
  return openRouterAgent;
}

export interface OpenRouterHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  stream?: http.IncomingMessage;
}

async function readAll(res: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of res) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

// Native node:https request honouring the OpenRouter proxy agent — undici `fetch`
// can't use a SOCKS `http.Agent`. Rejects with an `AbortError`-named error on
// timeout (callers special-case it). With `stream: true`, resolves at response
// headers and exposes the raw `stream`; the timeout then only guards setup.
export function openRouterRequest(
  targetUrl: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
    stream?: boolean;
  },
): Promise<OpenRouterHttpResponse> {
  const { method = "GET", headers = {}, body, timeoutMs, stream = false } = opts;

  return new Promise((resolve, reject) => {
    let settled = false;
    const u = new URL(targetUrl);

    const finalHeaders: Record<string, string> = { ...headers };
    if (body != null && finalHeaders["Content-Length"] == null) {
      finalHeaders["Content-Length"] = String(Buffer.byteLength(body));
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      const err = new Error(`OpenRouter request timed out after ${timeoutMs}ms`);
      err.name = "AbortError";
      reject(err);
    }, timeoutMs);

    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers: finalHeaders,
        agent: openRouterAgent as https.Agent | undefined,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const ok = status >= 200 && status < 300;

        if (stream) {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          resolve({
            ok,
            status,
            stream: res,
            text: () => readAll(res),
            json: async () => JSON.parse(await readAll(res)),
          });
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          const text = Buffer.concat(chunks).toString("utf-8");
          resolve({
            ok,
            status,
            text: async () => text,
            json: async () => JSON.parse(text),
          });
        });
        res.on("error", (err) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          reject(err);
        });
      },
    );

    req.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(err);
    });

    if (body != null) req.write(body);
    req.end();
  });
}

type TelegramFetchResult = {
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
};

// Uses native node:https to avoid CJS/ESM bundling issues with node-fetch.
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
