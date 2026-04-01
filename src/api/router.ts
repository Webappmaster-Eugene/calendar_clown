/**
 * Main API router. Aggregates all route modules under /api prefix.
 * Mounted on the existing HTTP server in oauthServer.ts.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiAuthMiddleware, requireApproved } from "./authMiddleware.js";
import { requestLoggerMiddleware } from "./requestLoggerMiddleware.js";
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

const log = createLogger("api");

export function createApiApp(): Hono<ApiEnv> {
  const api = new Hono<ApiEnv>().basePath("/api");

  // ── Global middleware ───────────────────────────────────────
  api.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 86400,
  }));

  // Auth middleware for all API routes
  api.use("*", apiAuthMiddleware());

  // Require approved status for all routes
  api.use("*", requireApproved());

  // Audit: log every API request to action_logs
  api.use("*", requestLoggerMiddleware());

  // ── Health check (no auth needed — registered before middleware) ──
  // Note: health is mounted on the parent, not here

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
