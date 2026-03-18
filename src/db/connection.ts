import pg from "pg";
import { createLogger } from "../utils/logger.js";

const log = createLogger("db");
const { Pool } = pg;

let pool: pg.Pool | null = null;
let databaseAvailable = false;

export function isDatabaseAvailable(): boolean {
  return databaseAvailable;
}

export function setDatabaseAvailable(available: boolean): void {
  databaseAvailable = available;
}

/** Get or create the PostgreSQL connection pool (singleton). */
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
    });
    pool.on("error", (err) => {
      log.error("Unexpected PostgreSQL pool error:", err.message);
    });
  }
  return pool;
}

/** Execute a parameterized SQL query against the pool. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/** Gracefully close the connection pool (called on shutdown). */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
