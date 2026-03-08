import http from "http";
import type { Telegraf } from "telegraf";
import { getChatIdByUsername } from "./userChats.js";

const DEFAULT_PORT = 18790;

interface SendBody {
  username?: string;
  text?: string;
}

function parseJsonBody(req: http.IncomingMessage): Promise<SendBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as SendBody);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function getBearerToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match ? match[1] : null;
}

/**
 * Start HTTP server for POST /send. Only starts if apiKey is non-empty.
 * Listens on host (default 127.0.0.1) and port from env.
 */
export function startSendMessageApi(bot: Telegraf, apiKey: string): http.Server {
  const port = Number(process.env.SEND_MESSAGE_API_PORT) || DEFAULT_PORT;
  const host = process.env.SEND_MESSAGE_API_HOST ?? "127.0.0.1";

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/send") {
      sendJson(res, 404, { error: "Not Found" });
      return;
    }

    const token = getBearerToken(req);
    if (!token || token !== apiKey) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    let body: SendBody;
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const username = typeof body.username === "string" ? body.username.trim() : "";
    const text = typeof body.text === "string" ? body.text : "";

    if (!username) {
      sendJson(res, 400, { error: "Missing or empty username" });
      return;
    }

    const chatId = await getChatIdByUsername(username);
    if (chatId == null) {
      sendJson(res, 404, {
        error: "User not found or has no username",
        hint: "User must have started a chat with the bot at least once",
      });
      return;
    }

    try {
      await bot.telegram.sendMessage(chatId, text);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: "Telegram send failed", details: message });
    }
  });

  server.listen(port, host, () => {
    console.log(`Send message API listening on http://${host}:${port}/send`);
  });

  return server;
}
