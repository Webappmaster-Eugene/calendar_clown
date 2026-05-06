/**
 * SSRF guard: reject URLs that would resolve to private/loopback/link-local IPs.
 * Used wherever the bot fetches a URL supplied by a user (blogger sources,
 * neuro-chat link previews, OSINT extras, etc.).
 *
 * Caveat: pre-flight DNS lookup does not eliminate DNS-rebinding (the host can
 * resolve differently between this check and the actual fetch). For the bot's
 * threat model — preventing casual abuse of public services — that's acceptable.
 * If we ever fetch with elevated privileges, switch to fetching by-IP after
 * lookup and pinning the Host header.
 */

import { lookup } from "dns/promises";
import { isIP } from "net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const PRIVATE_IPV6_PREFIXES = [
  "::1",       // loopback
  "fc",        // fc00::/7 unique local
  "fd",        // fc00::/7 unique local
  "fe8",       // fe80::/10 link-local
  "fe9",
  "fea",
  "feb",
];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;                       // 10.0.0.0/8
  if (a === 127) return true;                      // 127.0.0.0/8 loopback
  if (a === 0) return true;                        // 0.0.0.0/8
  if (a === 169 && b === 254) return true;         // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;// 172.16.0.0/12
  if (a === 192 && b === 168) return true;         // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true;                       // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::") return true;
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — extract the v4 part
    const v4 = lower.slice("::ffff:".length);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  return PRIVATE_IPV6_PREFIXES.some((p) => lower.startsWith(p));
}

function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // unknown — refuse
}

/**
 * Validates that a URL is safe to fetch user-content from.
 * Throws UnsafeUrlError if the protocol is not http(s) or the host resolves
 * to a private/loopback/link-local IP.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("Невалидный URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Протокол ${url.protocol} не разрешён.`);
  }
  const host = url.hostname;
  if (!host) throw new UnsafeUrlError("Пустой хост в URL.");

  if (isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError("Запрос к приватному IP запрещён.");
    return url;
  }

  // Hostname — resolve and verify all returned addresses.
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError(`Не удалось разрезолвить ${host}.`);
  }
  if (addrs.length === 0) throw new UnsafeUrlError(`Не удалось разрезолвить ${host}.`);
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new UnsafeUrlError(`Хост ${host} резолвится в приватный IP.`);
    }
  }
  return url;
}
