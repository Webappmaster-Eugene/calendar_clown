import http from "http";
import { saveTokenFromCode } from "./calendar/auth.js";

const DEFAULT_PORT = 18790;

const OAUTH_SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Календарь привязан</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem;text-align:center"><p style="font-size:1.25rem">Календарь привязан.</p><p>Закройте вкладку и вернитесь в Telegram.</p></body></html>`;

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.writeHead(status);
  res.end(html);
}

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function parsePathAndQuery(rawUrl: string): { pathname: string; searchParams: URLSearchParams } {
  const [pathname = "", search = ""] = rawUrl.split("?");
  return { pathname: pathname || "/", searchParams: new URLSearchParams(search) };
}

export interface OAuthServerOptions {
  oauthRedirectUri?: string;
}

/**
 * Start HTTP server for GET OAuth callback.
 * Starts only when oauthRedirectUri is set. Listens on host and port from env.
 */
export function startOAuthServer(options: OAuthServerOptions): http.Server | null {
  const oauthRedirectUri = options.oauthRedirectUri?.trim();
  if (!oauthRedirectUri) {
    return null;
  }

  const port = Number(process.env.SEND_MESSAGE_API_PORT) || DEFAULT_PORT;
  const host = process.env.SEND_MESSAGE_API_HOST ?? "127.0.0.1";
  const oauthCallbackPath = new URL(oauthRedirectUri).pathname;

  const server = http.createServer(async (req, res) => {
    const { pathname, searchParams } = parsePathAndQuery(req.url ?? "/");

    if (req.method === "GET" && pathname === oauthCallbackPath) {
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

    sendJson(res, 404, { error: "Not Found" });
  });

  server.listen(port, host, () => {
    console.log(`HTTP server listening on http://${host}:${port} (GET ${oauthCallbackPath})`);
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
