/**
 * Drizzle migration runner — the single source of schema truth.
 *
 * Schema:      src/db/schema.ts
 * Migrations:  drizzle/  (0000_baseline is the collapsed starting point)
 *   npm run db:generate  — generate a migration from schema.ts changes
 *   npm run db:migrate   — apply migrations
 *
 * On prod the baseline is pre-seeded in drizzle.__drizzle_migrations, so the
 * migrator skips it and only applies genuinely new migrations. A failure here
 * is intentionally fatal (see src/index.ts) — an inconsistent schema must not
 * boot silently.
 */

import { join } from "path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getPool } from "./connection.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("db");

/** Apply all pending Drizzle migrations from the drizzle/ directory. */
export async function runDrizzleMigrations(): Promise<void> {
  const drizzleDir = process.env.DRIZZLE_DIR || join(process.cwd(), "drizzle");
  const db = drizzle(getPool());
  await migrate(db, { migrationsFolder: drizzleDir });
  log.info("Drizzle migrations applied.");
}
