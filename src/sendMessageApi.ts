import http from "http";
import type { Telegraf } from "telegraf";
import { saveTokenFromCode } from "./calendar/auth.js";
import { getChatIdByUsername } from "./userChats.js";

const DEFAULT_PORT = 18790;

const OAUTH_SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Календарь привязан</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem;text-align:center"><p style="font-size:1.25rem">Календарь привязан.</p><p>Закройте вкладку и вернитесь в Telegram.</p></body></html>`;

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.writeHead(status);
  res.end(html);
}

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

function parsePathAndQuery(rawUrl: string): { pathname: string; searchParams: URLSearchParams } {
  const [pathname = "", search = ""] = rawUrl.split("?");
  return { pathname: pathname || "/", searchParams: new URLSearchParams(search) };
}

export interface SendMessageApiOptions {
  apiKey?: string;
  oauthRedirectUri?: string;
}

/**
 * Start HTTP server for POST /send and optionally GET OAuth callback.
 * Starts when apiKey or oauthRedirectUri is set. Listens on host and port from env.
 */
export function startSendMessageApi(bot: Telegraf, options: SendMessageApiOptions): http.Server | null {
  const apiKey = options.apiKey?.trim();
  const oauthRedirectUri = options.oauthRedirectUri?.trim();
  if (!apiKey && !oauthRedirectUri) {
    return null;
  }

  const port = Number(process.env.SEND_MESSAGE_API_PORT) || DEFAULT_PORT;
  const host = process.env.SEND_MESSAGE_API_HOST ?? "127.0.0.1";
  const oauthCallbackPath = oauthRedirectUri ? new URL(oauthRedirectUri).pathname : "";

  const server = http.createServer(async (req, res) => {
    const { pathname, searchParams } = parsePathAndQuery(req.url ?? "/");

    if (oauthCallbackPath && req.method === "GET" && pathname === oauthCallbackPath) {
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      if (!code || !state) {
        console.log("OAuth callback: missing code or state");
        sendHtml(res, 400, `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Не хватает параметров (code или state). Вернитесь в Telegram и нажмите «Войти через Google» снова.</p></body></html>`);
        return;
      }
      try {
        await saveTokenFromCode(code, state);
        console.log("OAuth callback: success for state=%s", state);
        sendHtml(res, 200, OAUTH_SUCCESS_HTML);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log("OAuth callback: error for state=%s - %s", state, message);
        sendHtml(res, 500, `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Ошибка привязки: ${escapeHtml(message)}</p><p>Вернитесь в Telegram и попробуйте снова или отправьте /auth и код из браузера.</p></body></html>`);
      }
      return;
    }

    if (req.method === "POST" && pathname === "/send") {
      if (!apiKey) {
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
      return;
    }

    sendJson(res, 404, { error: "Not Found" });
  });

  server.listen(port, host, () => {
    const parts = [];
    if (apiKey) parts.push("/send");
    if (oauthCallbackPath) parts.push(`GET ${oauthCallbackPath}`);
    console.log(`HTTP server listening on http://${host}:${port} (${parts.join(", ")})`);
  });

  return server;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
