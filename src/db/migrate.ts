/**
 * @legacy — Кастомная система миграций.
 *
 * Этот файл и SQL-файлы в src/db/migrations/ обслуживают уже применённые миграции (001–006).
 * Новые миграции создаются через Drizzle Kit:
 *   npm run db:generate  — сгенерировать миграцию из изменений в src/db/schema.ts
 *   npm run db:migrate   — применить миграции
 *
 * НЕ добавляйте новые SQL-файлы сюда. Используйте Drizzle-схему (src/db/schema.ts).
 */

import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getPool } from "./connection.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("db");

// Migrations are copied to /app/migrations in Docker, or relative in dev
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || join(process.cwd(), "src", "db", "migrations");

/** Run all pending SQL migrations from the migrations directory (transactional). */
export async function runMigrations(): Promise<void> {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows: applied } = await pool.query<{ name: string }>(
    "SELECT name FROM _migrations ORDER BY name"
  );
  const appliedSet = new Set(applied.map((r) => r.name));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    log.info(`Running migration: ${file}`);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO _migrations (name) VALUES ($1)",
        [file]
      );
      await client.query("COMMIT");
      log.info(`Migration applied: ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(
        `Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      client.release();
    }
  }
}

/** Run Drizzle Kit migrations from the drizzle/ directory (if it exists). */
export async function runDrizzleMigrations(): Promise<void> {
  const drizzleDir = process.env.DRIZZLE_DIR || join(process.cwd(), "drizzle");

  try {
    await readFile(join(drizzleDir, "meta", "_journal.json"), "utf8");
  } catch {
    log.info("No Drizzle migrations found, skipping.");
    return;
  }

  const pool = getPool();
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: drizzleDir });
  log.info("Drizzle migrations applied.");
}
