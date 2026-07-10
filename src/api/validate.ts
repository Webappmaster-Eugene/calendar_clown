/**
 * Shared Zod validator for API routes. On failure it returns the app's standard
 * { ok: false, error } JSON (400) instead of Hono's default, so the Mini App gets
 * a consistent error shape. Use exactly like @hono/zod-validator's zValidator:
 *   app.post("/", zValidator("json", Schema), (c) => { const body = c.req.valid("json"); ... })
 */
import { zValidator as honoZValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodSchema } from "zod";

export function zValidator<Target extends keyof ValidationTargets, T extends ZodSchema>(
  target: Target,
  schema: T,
) {
  return honoZValidator(target, schema, (result, c) => {
    if (!result.success) {
      const msg = result.error.issues
        .map((i) => `${i.path.join(".") || target}: ${i.message}`)
        .join("; ");
      return c.json({ ok: false, error: msg }, 400);
    }
  });
}
