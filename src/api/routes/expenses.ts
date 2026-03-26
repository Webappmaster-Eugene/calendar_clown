import { Hono } from "hono";
import {
  getMonthReport,
  generateExcel,
  getCategoryDtos,
  undoExpense,
  editExpense,
  addExpenseFromText,
  getCategoryDrilldown,
} from "../../services/expenseService.js";
import type { UpdateExpenseRequest } from "../../shared/types.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

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

/** POST /api/expenses — add expense from text */
app.post("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ text: string }>();

  if (!body.text?.trim()) {
    return c.json({ ok: false, error: "text is required" }, 400);
  }

  try {
    const result = await addExpenseFromText(
      telegramId,
      initData.user.username ?? null,
      initData.user.first_name,
      initData.user.last_name ?? null,
      false,
      body.text.trim()
    );
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add expense";
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
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to undo expense";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** PUT /api/expenses/:id — edit expense */
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
    body.subcategory === undefined
  ) {
    return c.json({ ok: false, error: "No fields to update" }, 400);
  }

  if (body.amount !== undefined && (typeof body.amount !== "number" || body.amount <= 0)) {
    return c.json({ ok: false, error: "Invalid amount" }, 400);
  }

  if (body.categoryId !== undefined && (typeof body.categoryId !== "number" || body.categoryId <= 0)) {
    return c.json({ ok: false, error: "Invalid categoryId" }, 400);
  }

  try {
    const updated = await editExpense(telegramId, expenseId, body);
    if (!updated) {
      return c.json({ ok: false, error: "Expense not found or access denied" }, 404);
    }
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
    c.header("Content-Disposition", `attachment; filename="${result.filename}"`);
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

export default app;
