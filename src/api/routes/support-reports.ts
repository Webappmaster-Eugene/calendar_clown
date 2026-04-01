import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { db } from "../../db/drizzle.js";
import { supportReports, users } from "../../db/schema.js";
import { isBootstrapAdmin } from "../../middleware/auth.js";
import { logApiAction } from "../../logging/actionLogger.js";
import { getBotSendMessage } from "../../botInstance.js";
import type { ApiEnv } from "../authMiddleware.js";
import type { SupportReportDto, CreateSupportReportRequest } from "../../shared/types.js";

const app = new Hono<ApiEnv>();

// ─── User: submit report ─────────────────────────────────────

/** POST /api/support-reports — user submits a report */
app.post("/", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<CreateSupportReportRequest>();

  if (!body.diagnostics) {
    return c.json({ ok: false, error: "diagnostics is required" }, 400);
  }

  try {
    // db imported from drizzle.ts singleton

    // Find user id.
    const [user] = await db
      .select({ id: users.id, firstName: users.firstName })
      .from(users)
      .where(eq(users.telegramId, BigInt(telegramId)))
      .limit(1);

    if (!user) {
      return c.json({ ok: false, error: "User not found" }, 404);
    }

    const [report] = await db
      .insert(supportReports)
      .values({
        userId: user.id,
        telegramId: BigInt(telegramId),
        category: body.category ?? "home_screen",
        diagnostics: body.diagnostics,
        platform: body.platform ?? null,
        appVersion: body.appVersion ?? null,
        userMessage: body.userMessage ?? null,
      })
      .returning({ id: supportReports.id });

    logApiAction(telegramId, "support_report_create", {
      reportId: report.id,
      category: body.category ?? "home_screen",
    });

    // Notify admin via bot.
    const sendMessage = getBotSendMessage();
    if (sendMessage) {
      const adminId = Number(process.env.ADMIN_TELEGRAM_ID);
      if (adminId) {
        const lines = [
          `📋 Обращение #${report.id}`,
          `👤 ${user.firstName ?? "?"} (${telegramId})`,
          `📱 ${body.platform ?? "?"} v${body.appVersion ?? "?"}`,
          `📂 ${body.category ?? "home_screen"}`,
        ];
        if (body.userMessage) {
          lines.push(`💬 ${body.userMessage}`);
        }
        lines.push("", "Откройте /admin → Обращения для ответа");
        try {
          await sendMessage(adminId, lines.join("\n"));
        } catch {
          // Non-critical — admin notification failed.
        }
      }
    }

    return c.json({ ok: true, data: { id: report.id } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create report";
    return c.json({ ok: false, error: msg }, 500);
  }
});

// ─── Admin: list reports ─────────────────────────────────────

/** GET /api/support-reports/admin — admin lists reports */
app.get("/admin", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  if (!isBootstrapAdmin(telegramId)) {
    return c.json({ ok: false, error: "Admin access required" }, 403);
  }

  const status = c.req.query("status"); // "open" | "resolved" | undefined (all)

  try {
    // db imported from drizzle.ts singleton

    let query = db
      .select({
        id: supportReports.id,
        telegramId: supportReports.telegramId,
        firstName: users.firstName,
        category: supportReports.category,
        status: supportReports.status,
        diagnostics: supportReports.diagnostics,
        platform: supportReports.platform,
        appVersion: supportReports.appVersion,
        userMessage: supportReports.userMessage,
        adminResponse: supportReports.adminResponse,
        createdAt: supportReports.createdAt,
        resolvedAt: supportReports.resolvedAt,
      })
      .from(supportReports)
      .leftJoin(users, eq(users.id, supportReports.userId))
      .orderBy(desc(supportReports.createdAt))
      .$dynamic();

    if (status === "open" || status === "resolved") {
      query = query.where(eq(supportReports.status, status));
    }

    const rows = await query.limit(100);

    const data: SupportReportDto[] = rows.map((r) => ({
      id: r.id,
      telegramId: Number(r.telegramId),
      firstName: r.firstName ?? "?",
      category: r.category,
      status: r.status as "open" | "resolved",
      diagnostics: r.diagnostics,
      platform: r.platform,
      appVersion: r.appVersion,
      userMessage: r.userMessage,
      adminResponse: r.adminResponse,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }));

    return c.json({ ok: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list reports";
    return c.json({ ok: false, error: msg }, 500);
  }
});

// ─── Admin: respond to report ────────────────────────────────

/** PUT /api/support-reports/admin/:id/respond — admin sends response */
app.put("/admin/:id/respond", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  if (!isBootstrapAdmin(telegramId)) {
    return c.json({ ok: false, error: "Admin access required" }, 403);
  }

  const reportId = Number(c.req.param("id"));
  const { response } = await c.req.json<{ response: string }>();
  if (!response?.trim()) {
    return c.json({ ok: false, error: "response is required" }, 400);
  }

  try {
    // db imported from drizzle.ts singleton

    // Find admin user id.
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, BigInt(telegramId)))
      .limit(1);

    const [updated] = await db
      .update(supportReports)
      .set({
        adminResponse: response.trim(),
        resolvedBy: admin?.id ?? null,
        status: "resolved",
        resolvedAt: new Date(),
      })
      .where(eq(supportReports.id, reportId))
      .returning({
        id: supportReports.id,
        userTelegramId: supportReports.telegramId,
      });

    if (!updated) {
      return c.json({ ok: false, error: "Report not found" }, 404);
    }

    logApiAction(telegramId, "support_report_respond", { reportId, response: response.trim() });

    // Send response to user via bot.
    const sendMessage = getBotSendMessage();
    if (sendMessage) {
      try {
        await sendMessage(
          Number(updated.userTelegramId),
          `💬 Ответ от поддержки:\n\n${response.trim()}`,
        );
      } catch {
        // Non-critical.
      }
    }

    return c.json({ ok: true, data: { id: updated.id } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to respond";
    return c.json({ ok: false, error: msg }, 500);
  }
});

// ─── Admin: resolve without response ─────────────────────────

/** PUT /api/support-reports/admin/:id/resolve — mark as resolved */
app.put("/admin/:id/resolve", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  if (!isBootstrapAdmin(telegramId)) {
    return c.json({ ok: false, error: "Admin access required" }, 403);
  }

  const reportId = Number(c.req.param("id"));

  try {
    // db imported from drizzle.ts singleton
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, BigInt(telegramId)))
      .limit(1);

    const [updated] = await db
      .update(supportReports)
      .set({
        status: "resolved",
        resolvedBy: admin?.id ?? null,
        resolvedAt: new Date(),
      })
      .where(eq(supportReports.id, reportId))
      .returning({ id: supportReports.id });

    if (!updated) {
      return c.json({ ok: false, error: "Report not found" }, 404);
    }

    logApiAction(telegramId, "support_report_resolve", { reportId });
    return c.json({ ok: true, data: { id: updated.id } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to resolve";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
