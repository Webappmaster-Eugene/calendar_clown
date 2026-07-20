// Auth reuses the Mini App model (`Authorization: tma <initData>`); the
// MCP_ACTOR_TELEGRAM_ID env fallback is honored only when no initData is presented.
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { validateInitData } from "../api/authMiddleware.js";
import { resolveActor } from "../actions/guard.js";
import { buildMcpServer } from "./server.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("mcp");

function resolvePrincipal(req: IncomingMessage): number | null {
  const auth = req.headers["authorization"];
  const raw = typeof auth === "string" && auth.startsWith("tma ") ? auth.slice(4) : null;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (raw && botToken) {
    const parsed = validateInitData(raw, botToken);
    if (parsed) return parsed.user.id;
    return null; // invalid initData → do not silently fall back to env principal
  }
  const envActor = process.env.MCP_ACTOR_TELEGRAM_ID;
  return envActor ? Number(envActor) || null : null;
}

export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const telegramId = resolvePrincipal(req);
  if (telegramId == null) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
    return;
  }

  let actx;
  try {
    actx = await resolveActor(telegramId);
  } catch (err) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "forbidden" }));
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildMcpServer(actx);
  res.on("close", () => {
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    log.error("MCP request failed", { error: err instanceof Error ? err.message : String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "MCP request failed" }));
    }
  }
}
