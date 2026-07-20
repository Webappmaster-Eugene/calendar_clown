import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiAuthMiddleware, requireApproved } from "./authMiddleware.js";
import { requestLoggerMiddleware } from "./requestLoggerMiddleware.js";
import { rateLimit } from "./rateLimitMiddleware.js";
import type { ApiEnv } from "./authMiddleware.js";
import { createLogger } from "../utils/logger.js";

import userRoutes from "./routes/user.js";
import calendarRoutes from "./routes/calendar.js";
import expensesRoutes from "./routes/expenses.js";
import gandalfRoutes from "./routes/gandalf.js";
import goalsRoutes from "./routes/goals.js";
import remindersRoutes from "./routes/reminders.js";
import wishlistRoutes from "./routes/wishlist.js";
import notableDatesRoutes from "./routes/notable-dates.js";
import digestRoutes from "./routes/digest.js";
import osintRoutes from "./routes/osint.js";
import chatRoutes from "./routes/chat.js";
import transcribeRoutes from "./routes/transcribe.js";
import simplifierRoutes from "./routes/simplifier.js";
import summarizerRoutes from "./routes/summarizer.js";
import bloggerRoutes from "./routes/blogger.js";
import broadcastRoutes from "./routes/broadcast.js";
import adminRoutes from "./routes/admin.js";
import tasksRoutes from "./routes/tasks.js";
import nutritionistRoutes from "./routes/nutritionist.js";
import voiceRoutes from "./routes/voice.js";
import supportReportsRoutes from "./routes/support-reports.js";
import bankhookRoutes from "./routes/bankhook.js";

const log = createLogger("api");

export function createApiApp(): Hono<ApiEnv> {
  const api = new Hono<ApiEnv>().basePath("/api");

  // ── Global middleware ───────────────────────────────────────
  // CORS: lock to WEBAPP_URL when set; fall back to wildcard for local dev.
  // The Authorization header is what carries the Telegram InitData, so leaving
  // the origin open in production lets any site relay an init-data they obtained
  // and is unsafe.
  const corsOrigin = process.env.WEBAPP_URL?.trim() ?? "*";
  if (corsOrigin === "*" && process.env.NODE_ENV === "production") {
    log.warn("CORS origin is '*' in production — set WEBAPP_URL to lock it down");
  }
  api.use("*", cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 86400,
  }));

  api.use("*", apiAuthMiddleware());

  api.use("*", requireApproved());

  api.use("*", requestLoggerMiddleware());

  // Global per-user soft cap to prevent client loops from hammering the API.
  api.use("*", rateLimit({ bucket: "all", windowMs: 60_000, max: 120 }));

  // Tighter cap on endpoints that hit paid upstreams (LLM/STT) or do heavy work.
  const heavyLimit = rateLimit({ bucket: "heavy", windowMs: 60_000, max: 20 });
  api.use("/voice/*", heavyLimit);
  api.use("/transcribe/*", heavyLimit);
  api.use("/simplifier/*", heavyLimit);
  api.use("/blogger/*", heavyLimit);
  api.use("/osint/*", heavyLimit);
  api.use("/chat/*", heavyLimit);
  api.use("/nutritionist/*", heavyLimit);
  api.use("/broadcast/*", heavyLimit);

  // Health is mounted on the parent, not here.

  // ── Route modules ──────────────────────────────────────────
  api.route("/user", userRoutes);
  api.route("/calendar", calendarRoutes);
  api.route("/expenses", expensesRoutes);
  api.route("/gandalf", gandalfRoutes);
  api.route("/goals", goalsRoutes);
  api.route("/reminders", remindersRoutes);
  api.route("/wishlist", wishlistRoutes);
  api.route("/notable-dates", notableDatesRoutes);
  api.route("/digest", digestRoutes);
  api.route("/osint", osintRoutes);
  api.route("/chat", chatRoutes);
  api.route("/transcribe", transcribeRoutes);
  api.route("/simplifier", simplifierRoutes);
  api.route("/summarizer", summarizerRoutes);
  api.route("/blogger", bloggerRoutes);
  api.route("/broadcast", broadcastRoutes);
  api.route("/admin", adminRoutes);
  api.route("/tasks", tasksRoutes);
  api.route("/nutritionist", nutritionistRoutes);
  api.route("/voice", voiceRoutes);
  api.route("/support-reports", supportReportsRoutes);
  api.route("/bankhook", bankhookRoutes);

  // ── Global error handler ───────────────────────────────────
  api.onError((err, c) => {
    log.error("Unhandled API error: %s", err.message);
    return c.json({ ok: false, error: "Internal server error" }, 500);
  });

  // ── 404 handler ────────────────────────────────────────────
  api.notFound((c) => {
    return c.json({ ok: false, error: "API endpoint not found" }, 404);
  });

  return api;
}
