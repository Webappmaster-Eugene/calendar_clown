/**
 * Run SQL migrations from migrations/ in order.
 * Usage: npm run migrate (requires DATABASE_URL or POSTGRES_* in env)
 */

import dotenv from "dotenv";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(path.dirname(__dirname), "migrations");

function buildConfig(): pg.PoolConfig {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return { connectionString: url };

  const host = process.env.POSTGRES_HOST ?? "localhost";
  const port = parseInt(process.env.POSTGRES_PORT ?? "5432", 10);
  const user = process.env.POSTGRES_USER ?? "bot";
  const password = process.env.POSTGRES_PASSWORD ?? "bot";
  const database = process.env.POSTGRES_DB ?? "bot";
  return { host, port, user, password, database };
}

async function main() {
  const pool = new pg.Pool(buildConfig());

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.log("No migration files found in", migrationsDir);
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name varchar(255) PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const name = file;
      const { rows } = await client.query("SELECT 1 FROM _migrations WHERE name = $1", [name]);
      if (rows.length > 0) {
        console.log("Skip (already applied):", name);
        continue;
      }

      const sqlPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(sqlPath, "utf-8");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
      console.log("Applied:", name);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
