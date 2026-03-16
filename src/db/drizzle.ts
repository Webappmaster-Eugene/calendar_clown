import { drizzle } from "drizzle-orm/node-postgres";
import { getPool } from "./connection.js";
import * as schema from "./schema.js";

/** Drizzle ORM client — reuses the existing pg.Pool singleton from connection.ts. */
export const db = drizzle(getPool(), { schema });
