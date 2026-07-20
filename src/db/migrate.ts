/**
 * On prod the baseline is pre-seeded in drizzle.__drizzle_migrations, so the
 * migrator skips it and only applies genuinely new migrations. A failure here
 * is intentionally fatal — an inconsistent schema must not boot silently.
 */

import { join } from "path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getPool } from "./connection.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("db");

export async function runDrizzleMigrations(): Promise<void> {
  const drizzleDir = process.env.DRIZZLE_DIR || join(process.cwd(), "drizzle");
  const db = drizzle(getPool());
  await migrate(db, { migrationsFolder: drizzleDir });
  log.info("Drizzle migrations applied.");
}
