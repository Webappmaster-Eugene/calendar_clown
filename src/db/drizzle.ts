import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getPool } from "./connection.js";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

let instance: Database | null = null;

function resolve(): Database {
  if (!instance) instance = drizzle(getPool(), { schema });
  return instance;
}

// Lazy handle: importing a repository must NOT force a DB connection, or the
// calendar-only degraded mode (no DATABASE_URL → getPool throws) would crash at
// import time. The proxy defers drizzle()/getPool() to the first actual query and
// binds methods to the real instance so `db.select()`/`db.transaction()` work.
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const value = Reflect.get(resolve() as object, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
