import http from "http";
import { saveTokenFromCode } from "./calendar/auth.js";
import { getAuthStateByToken, submitCodeViaWeb, submit2faViaWeb } from "./commands/digestAuth.js";
import type { WebAuthResult } from "./commands/digestAuth.js";
import { createLogger } from "./utils/logger.js";

const log = createLogger("oauth");

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

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) {
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
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

  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const host = process.env.HOST ?? "0.0.0.0";
  const oauthCallbackPath = new URL(oauthRedirectUri).pathname;

  const server = http.createServer(async (req, res) => {
    const { pathname, searchParams } = parsePathAndQuery(req.url ?? "/");

    if (req.method === "GET" && pathname === oauthCallbackPath) {
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      if (!code || !state) {
        log.warn("OAuth callback: missing code or state");
        sendHtml(res, 400, `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Не хватает параметров (code или state). Вернитесь в Telegram и нажмите «Войти через Google» снова.</p></body></html>`);
        return;
      }
      try {
        await saveTokenFromCode(code, state);
        log.info(`OAuth callback: success for state=${state}`);
        sendHtml(res, 200, OAUTH_SUCCESS_HTML);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`OAuth callback: error for state=${state} - ${message}`);
        sendHtml(res, 500, `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Ошибка привязки: ${escapeHtml(message)}</p><p>Вернитесь в Telegram и попробуйте снова или отправьте /auth и код из браузера.</p></body></html>`);
      }
      return;
    }

    // MTProto web auth routes: /auth/mtproto/<64-char hex token>
    const mtprotoMatch = pathname.match(/^\/auth\/mtproto\/([a-f0-9]{64})$/);
    if (mtprotoMatch) {
      const token = mtprotoMatch[1];
      try {
        if (req.method === "GET") {
          await handleMtprotoGet(token, res);
        } else if (req.method === "POST") {
          await handleMtprotoPost(token, req, res);
        } else {
          res.writeHead(405);
          res.end();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`MTProto web auth error: ${message}`);
        sendHtml(res, 500, mtprotoErrorHtml("Внутренняя ошибка сервера."));
      }
      return;
    }

    sendJson(res, 404, { error: "Not Found" });
  });

  server.listen(port, host, () => {
    log.info(`HTTP server listening on http://${host}:${port} (GET ${oauthCallbackPath})`);
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

/* ── MTProto web auth HTML templates ── */

const MTPROTO_STYLE = `
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 400px; margin: 2rem auto; padding: 0 1rem; color: #333; }
  h2 { text-align: center; font-size: 1.25rem; margin-bottom: 1.5rem; }
  .form-group { margin-bottom: 1rem; }
  label { display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.9rem; }
  input[type="text"], input[type="password"] {
    width: 100%; padding: 0.75rem; font-size: 1.1rem; border: 1px solid #ccc;
    border-radius: 8px; box-sizing: border-box; text-align: center; letter-spacing: 0.25em;
  }
  input:focus { outline: none; border-color: #2481cc; box-shadow: 0 0 0 2px rgba(36,129,204,0.2); }
  button {
    width: 100%; padding: 0.75rem; font-size: 1rem; font-weight: 600;
    background: #2481cc; color: #fff; border: none; border-radius: 8px; cursor: pointer;
  }
  button:hover { background: #1a6fb5; }
  .error { color: #d32f2f; font-size: 0.9rem; text-align: center; margin-bottom: 1rem; }
  .success { text-align: center; }
  .success p { font-size: 1.1rem; }
`.trim();

function mtprotoPageHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${MTPROTO_STYLE}</style></head><body>${body}</body></html>`;
}

function mtprotoCodeFormHtml(token: string, error?: string): string {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  return mtprotoPageHtml("Ввод кода авторизации", `
    <h2>Введите код авторизации</h2>
    ${errorHtml}
    <form method="POST">
      <div class="form-group">
        <label for="code">Код из Telegram</label>
        <input type="text" id="code" name="code" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" required autofocus placeholder="12345">
      </div>
      <button type="submit">Подтвердить</button>
    </form>
  `);
}

function mtprotoPasswordFormHtml(token: string, error?: string): string {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  return mtprotoPageHtml("Пароль 2FA", `
    <h2>Введите пароль 2FA</h2>
    ${errorHtml}
    <form method="POST">
      <div class="form-group">
        <label for="password">Пароль двухфакторной аутентификации</label>
        <input type="password" id="password" name="password" required autofocus>
      </div>
      <button type="submit">Подтвердить</button>
    </form>
  `);
}

function mtprotoSuccessHtml(phoneHint: string): string {
  return mtprotoPageHtml("Аккаунт привязан", `
    <div class="success">
      <p>✅ Telegram-аккаунт привязан (${escapeHtml(phoneHint)})!</p>
      <p>Закройте эту вкладку и вернитесь в Telegram.</p>
    </div>
  `);
}

function mtprotoErrorHtml(message: string): string {
  return mtprotoPageHtml("Ошибка", `
    <div class="success">
      <p>❌ ${escapeHtml(message)}</p>
      <p>Вернитесь в Telegram и попробуйте снова.</p>
    </div>
  `);
}

async function handleMtprotoGet(
  token: string,
  res: http.ServerResponse
): Promise<void> {
  const entry = getAuthStateByToken(token);
  if (!entry) {
    sendHtml(res, 410, mtprotoErrorHtml("Ссылка истекла или недействительна."));
    return;
  }

  if (entry.state.step === "password") {
    sendHtml(res, 200, mtprotoPasswordFormHtml(token));
  } else {
    sendHtml(res, 200, mtprotoCodeFormHtml(token));
  }
}

async function handleMtprotoPost(
  token: string,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let body: string;
  try {
    body = await parseBody(req);
  } catch {
    sendHtml(res, 413, mtprotoErrorHtml("Запрос слишком большой."));
    return;
  }

  const params = new URLSearchParams(body);
  const code = params.get("code");
  const password = params.get("password");

  let result: WebAuthResult;

  if (password) {
    result = await submit2faViaWeb(token, password);
  } else if (code) {
    result = await submitCodeViaWeb(token, code);
  } else {
    sendHtml(res, 400, mtprotoErrorHtml("Пустой запрос."));
    return;
  }

  switch (result.status) {
    case "success":
      sendHtml(res, 200, mtprotoSuccessHtml(result.phoneHint));
      break;
    case "2fa_required":
      // Redirect to GET to show password form
      res.writeHead(303, { Location: `/auth/mtproto/${token}` });
      res.end();
      break;
    case "invalid_code":
      if (password) {
        sendHtml(res, 200, mtprotoPasswordFormHtml(token, result.message));
      } else {
        sendHtml(res, 200, mtprotoCodeFormHtml(token, result.message));
      }
      break;
    case "expired":
      sendHtml(res, 410, mtprotoErrorHtml("Код истёк. Вернитесь в Telegram и начните заново."));
      break;
    case "invalid_token":
      sendHtml(res, 410, mtprotoErrorHtml("Ссылка истекла или недействительна."));
      break;
    case "flood":
      sendHtml(res, 429, mtprotoErrorHtml(`Слишком много попыток. Подождите ${result.waitSeconds} сек.`));
      break;
    case "error":
      sendHtml(res, 500, mtprotoErrorHtml(result.message));
      break;
  }
}
