import { Hono } from "hono";
import {
  getMonthReport,
  getYearReport,
  generateExcel,
  getCategoryDtos,
  undoExpense,
  editExpense,
  addExpenseFromText,
  addMultipleExpenses,
  addExpenseStructured,
  getCategoryDrilldown,
  getComparisonDrilldown,
  getRecentExpenses,
  getMonthLimitInfo,
  setMonthLimit,
} from "../../services/expenseService.js";
import type { UpdateExpenseRequest, SetMonthlyLimitRequest } from "../../shared/types.js";
import type { ApiEnv } from "../authMiddleware.js";
import { logApiAction } from "../../logging/actionLogger.js";
import { parseMskCalendarDate } from "../../utils/date.js";
import { getBotSendDocument } from "../../botInstance.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("api-expenses");

const app = new Hono<ApiEnv>();

/** Build a Content-Disposition value safe for Node's HTTP layer.
 *
 *  Node rejects header values containing bytes outside ISO-8859-1 with
 *  ERR_INVALID_CHAR — so a raw Cyrillic (or any non-latin1) filename throws
 *  500 at the Hono `c.body(...)` step. Per RFC 5987 we ship two filenames:
 *  an ASCII-only `filename=` for legacy clients, and `filename*=UTF-8''…`
 *  with percent-encoded UTF-8 for everyone else (modern browsers, Telegram
 *  WebView, curl, etc.). The output is guaranteed to be ASCII. */
export function buildExcelDispositionHeader(
  filename: string,
  year: number,
  month: number
): string {
  const asciiFallback = `expenses-${year}-${String(month).padStart(2, "0")}.xlsx`;
  const utf8Encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

/** GET /api/expenses — list expenses (monthly report by category) */
app.get("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  const month = parseInt(c.req.query("month") ?? String(new Date().getMonth() + 1), 10);
  const year = parseInt(c.req.query("year") ?? String(new Date().getFullYear()), 10);

  try {
    const report = await getMonthReport(telegramId, year, month);
    return c.json({ ok: true, data: report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get expenses";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/expenses — add expense (text or structured); optional `date` for backdated entries */
app.post("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{
    text?: string;
    categoryId?: number;
    amount?: number;
    subcategory?: string;
    date?: string;
  }>();

  // Optional backdate. For multi-line text we don't honor `date` because it would
  // apply to every parsed item (rarely the desired UX); explicit single entry only.
  let backdate: Date | null = null;
  if (body.date !== undefined && body.date !== null && body.date !== "") {
    if (typeof body.date !== "string") {
      return c.json({ ok: false, error: "Invalid date" }, 400);
    }
    try {
      backdate = parseMskCalendarDate(body.date);
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : "Invalid date" }, 400);
    }
  }

  try {
    // Structured input: categoryId + amount (from Mini App form)
    if (body.categoryId !== undefined && body.amount !== undefined) {
      if (typeof body.categoryId !== "number" || body.categoryId <= 0) {
        return c.json({ ok: false, error: "Invalid categoryId" }, 400);
      }
      if (typeof body.amount !== "number" || body.amount <= 0) {
        return c.json({ ok: false, error: "Invalid amount" }, 400);
      }
      const result = await addExpenseStructured(
        telegramId,
        initData.user.username ?? null,
        initData.user.first_name,
        initData.user.last_name ?? null,
        false,
        body.categoryId,
        body.amount,
        body.subcategory,
        backdate
      );
      logApiAction(telegramId, "expense_add_structured", {
        categoryId: body.categoryId,
        amount: body.amount,
        backdated: backdate ? body.date : undefined,
      });
      return c.json({ ok: true, data: result });
    }

    // Text input: natural language (supports multi-line for bulk entry)
    if (body.text?.trim()) {
      const text = body.text.trim();

      // Try multi-line parsing first (same as bot). Multi-line entries always land in current month.
      if (!backdate) {
        const multiResult = await addMultipleExpenses(
          telegramId,
          initData.user.username ?? null,
          initData.user.first_name,
          initData.user.last_name ?? null,
          false,
          text
        );
        if (multiResult) {
          logApiAction(telegramId, "expense_add_text_multi", { count: multiResult.expenses.length, totalAmount: multiResult.totalAmount });
          return c.json({ ok: true, data: multiResult });
        }
      }

      // Single expense
      const result = await addExpenseFromText(
        telegramId,
        initData.user.username ?? null,
        initData.user.first_name,
        initData.user.last_name ?? null,
        false,
        text,
        backdate
      );
      logApiAction(telegramId, "expense_add_text", { text, backdated: backdate ? body.date : undefined });
      return c.json({ ok: true, data: result });
    }

    return c.json({ ok: false, error: "text or categoryId+amount is required" }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add expense";
    return c.json({ ok: false, error: msg }, 500);
  }
});

// ─── Static-path routes (must be registered BEFORE /:id) ──────────────
// Hono's RegExpRouter favors parametric routes when they collide with literal
// paths in the same method (e.g. PUT /limit vs PUT /:id) — registration order
// is what determines the winner here.

/** GET /api/expenses/limit — current effective limit + override flag */
app.get("/limit", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  const month = parseInt(c.req.query("month") ?? String(new Date().getMonth() + 1), 10);
  const year = parseInt(c.req.query("year") ?? String(new Date().getFullYear()), 10);

  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return c.json({ ok: false, error: "Invalid month" }, 400);
  }
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return c.json({ ok: false, error: "Invalid year" }, 400);
  }

  try {
    const info = await getMonthLimitInfo(telegramId, year, month);
    return c.json({ ok: true, data: info });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get limit";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/expenses/limit — set monthly limit (current month only OR this month + future) */
app.put("/limit", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  const body = await c.req.json<SetMonthlyLimitRequest>();
  if (
    !Number.isFinite(body.year) || body.year < 2000 || body.year > 2100 ||
    !Number.isFinite(body.month) || body.month < 1 || body.month > 12
  ) {
    return c.json({ ok: false, error: "Invalid year/month" }, 400);
  }
  if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0 || body.amount > 100_000_000) {
    return c.json({ ok: false, error: "Invalid amount (must be > 0 and ≤ 100 000 000)" }, 400);
  }
  if (typeof body.applyToFuture !== "boolean") {
    return c.json({ ok: false, error: "Invalid applyToFuture" }, 400);
  }

  try {
    const info = await setMonthLimit(telegramId, body.year, body.month, body.amount, body.applyToFuture);
    logApiAction(telegramId, "expense_limit_set", {
      year: body.year, month: body.month, amount: body.amount, applyToFuture: body.applyToFuture,
    });
    return c.json({ ok: true, data: info });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to set limit";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/**
 * POST /api/expenses/excel/send — generate Excel and deliver it through the bot DM.
 * Used by the Mini App because direct downloads are unreliable inside Telegram WebView
 * (especially on iOS where WKWebView often silently drops `<a download>` clicks).
 */
app.post("/excel/send", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  const body: { year?: number; month?: number } = await c.req
    .json<{ year?: number; month?: number }>()
    .catch(() => ({}));
  const month = typeof body.month === "number" ? body.month : new Date().getMonth() + 1;
  const year = typeof body.year === "number" ? body.year : new Date().getFullYear();

  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return c.json({ ok: false, error: "Invalid month" }, 400);
  }
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return c.json({ ok: false, error: "Invalid year" }, 400);
  }

  const sendDocument = getBotSendDocument();
  if (!sendDocument) {
    return c.json({ ok: false, error: "Бот недоступен. Попробуйте позже." }, 503);
  }

  try {
    const result = await generateExcel(telegramId, year, month);
    if (!result) {
      return c.json({ ok: false, error: "За этот месяц нет трат" }, 404);
    }

    try {
      await sendDocument(
        telegramId,
        { source: result.buffer, filename: result.filename },
        { caption: `📥 ${result.filename}` }
      );
    } catch (err) {
      // Most common: 403 — user hasn't started a chat with the bot, or has blocked it.
      const msg = err instanceof Error ? err.message : String(err);
      log.error("Excel delivery via bot failed for %d: %s", telegramId, msg);
      if (/403|blocked|chat not found/i.test(msg)) {
        return c.json(
          { ok: false, error: "Откройте чат с ботом и нажмите /start, чтобы получить файл." },
          400
        );
      }
      return c.json({ ok: false, error: "Не удалось отправить файл через бота." }, 502);
    }

    logApiAction(telegramId, "expense_excel_sent_via_bot", { year, month });
    return c.json({ ok: true, data: { filename: result.filename } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate Excel";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/expenses/:id — undo expense */
app.delete("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const expenseId = parseInt(c.req.param("id"), 10);

  if (isNaN(expenseId)) {
    return c.json({ ok: false, error: "Invalid expense ID" }, 400);
  }

  try {
    const deleted = await undoExpense(telegramId, expenseId);
    logApiAction(telegramId, "expense_undo", { expenseId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to undo expense";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/expenses/:id — edit expense (amount, category, subcategory, date) */
app.put("/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const expenseId = parseInt(c.req.param("id"), 10);

  if (isNaN(expenseId)) {
    return c.json({ ok: false, error: "Invalid expense ID" }, 400);
  }

  const body = await c.req.json<UpdateExpenseRequest>();

  if (
    body.amount === undefined &&
    body.categoryId === undefined &&
    body.subcategory === undefined &&
    body.date === undefined
  ) {
    return c.json({ ok: false, error: "No fields to update" }, 400);
  }

  if (body.amount !== undefined && (typeof body.amount !== "number" || body.amount <= 0)) {
    return c.json({ ok: false, error: "Invalid amount" }, 400);
  }

  if (body.categoryId !== undefined && (typeof body.categoryId !== "number" || body.categoryId <= 0)) {
    return c.json({ ok: false, error: "Invalid categoryId" }, 400);
  }

  // Translate the optional ISO `date` field into a Date for the service layer.
  let createdAt: Date | undefined;
  if (body.date !== undefined && body.date !== null && body.date !== "") {
    if (typeof body.date !== "string") {
      return c.json({ ok: false, error: "Invalid date" }, 400);
    }
    try {
      createdAt = parseMskCalendarDate(body.date);
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : "Invalid date" }, 400);
    }
  }

  try {
    const updated = await editExpense(telegramId, expenseId, {
      amount: body.amount,
      categoryId: body.categoryId,
      subcategory: body.subcategory,
      createdAt,
    });
    if (!updated) {
      return c.json({ ok: false, error: "Expense not found or access denied" }, 404);
    }
    logApiAction(telegramId, "expense_edit", { expenseId, fields: Object.keys(body) });
    return c.json({ ok: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to edit expense";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/expenses/report — monthly report */
app.get("/report", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  const month = parseInt(c.req.query("month") ?? String(new Date().getMonth() + 1), 10);
  const year = parseInt(c.req.query("year") ?? String(new Date().getFullYear()), 10);

  try {
    const report = await getMonthReport(telegramId, year, month);
    return c.json({ ok: true, data: report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get report";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/expenses/year — year report (monthly totals) */
app.get("/year", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const year = parseInt(c.req.query("year") ?? String(new Date().getFullYear()), 10);

  try {
    const data = await getYearReport(telegramId, year);
    return c.json({ ok: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get year report";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/expenses/excel — download Excel file */
app.get("/excel", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  const month = parseInt(c.req.query("month") ?? String(new Date().getMonth() + 1), 10);
  const year = parseInt(c.req.query("year") ?? String(new Date().getFullYear()), 10);

  try {
    const result = await generateExcel(telegramId, year, month);
    if (!result) {
      return c.json({ ok: false, error: "No data for this period" }, 404);
    }

    c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    c.header("Content-Disposition", buildExcelDispositionHeader(result.filename, year, month));
    return c.body(result.buffer as unknown as ArrayBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate Excel";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/expenses/drilldown — individual expenses by category */
app.get("/drilldown", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  const categoryId = parseInt(c.req.query("categoryId") ?? "0", 10);
  const month = parseInt(c.req.query("month") ?? String(new Date().getMonth() + 1), 10);
  const year = parseInt(c.req.query("year") ?? String(new Date().getFullYear()), 10);
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 50);
  const offset = (page - 1) * limit;

  if (!categoryId) {
    return c.json({ ok: false, error: "categoryId is required" }, 400);
  }

  try {
    const result = await getCategoryDrilldown(telegramId, categoryId, year, month, limit, offset);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get expenses";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/expenses/comparison-drilldown — expenses by category for both months */
app.get("/comparison-drilldown", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  const categoryId = parseInt(c.req.query("categoryId") ?? "0", 10);
  const month = parseInt(c.req.query("month") ?? String(new Date().getMonth() + 1), 10);
  const year = parseInt(c.req.query("year") ?? String(new Date().getFullYear()), 10);
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 50);
  const offset = (page - 1) * limit;

  if (!categoryId) {
    return c.json({ ok: false, error: "categoryId is required" }, 400);
  }

  try {
    const result = await getComparisonDrilldown(telegramId, categoryId, year, month, limit, offset);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get comparison drilldown";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/expenses/categories — list categories */
app.get("/categories", async (c) => {
  try {
    const categories = await getCategoryDtos();
    return c.json({ ok: true, data: categories });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get categories";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/expenses/recent — paginated expenses across tribe */
app.get("/recent", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 50);
  const page = Math.max(parseInt(c.req.query("page") ?? "1", 10), 1);

  try {
    const data = await getRecentExpenses(telegramId, limit, page);
    return c.json({ ok: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get recent expenses";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
