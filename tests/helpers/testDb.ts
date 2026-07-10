/**
 * Integration-test DB helper.
 *
 * Integration tests run against a REAL Postgres (the query builder + schema are
 * the thing under test), but never against production. Point `DATABASE_URL` at a
 * disposable database, e.g. a local Docker postgres:
 *   docker run -d --name pg_test -e POSTGRES_USER=bot -e POSTGRES_PASSWORD=bot \
 *     -e POSTGRES_DB=test -p 55450:5432 postgres:16
 *   DATABASE_URL=postgres://bot:bot@localhost:55450/test npm run test:integration
 *
 * `setupTestDb()` guards against prod, applies migrations, and seeds the minimal
 * reference fixtures (a tribe + a few categories) that the collapsed baseline no
 * longer carries. Each test file cleans up its own rows (by a unique telegram id).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../src/db/drizzle.js";
import { categories, tribes, users } from "../../src/db/schema.js";

const PROD_MARKERS = ["217.199.254.38", "podbor-minuta", "sovetnik-db"];

/** Apply migrations to the configured test DB (refuses to touch production). */
export async function setupTestDb(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Integration tests require DATABASE_URL pointing at a DISPOSABLE test database (see tests/helpers/testDb.ts).",
    );
  }
  if (PROD_MARKERS.some((m) => url.includes(m))) {
    throw new Error("Refusing to run integration tests against the production database. Use a throwaway DB.");
  }
  const { runDrizzleMigrations } = await import("../../src/db/migrate.js");
  await runDrizzleMigrations();

  // Service-layer functions guard on isDatabaseAvailable(); mark it up for tests.
  const { setDatabaseAvailable } = await import("../../src/db/connection.js");
  setDatabaseAvailable(true);
}

export interface Fixtures {
  tribeId: number;
  categoryIds: number[];
}

/** Seed the minimal reference data expenses/expense-category tests rely on. Idempotent. */
export async function seedFixtures(): Promise<Fixtures> {
  const [existingTribe] = await db.select({ id: tribes.id }).from(tribes).limit(1);
  const tribeId =
    existingTribe?.id ??
    (await db.insert(tribes).values({ name: "Тест-Семья" }).returning({ id: tribes.id }))[0].id;

  await db
    .insert(categories)
    .values([
      { name: "Продукты", emoji: "🛒", sortOrder: 1 },
      { name: "Такси", emoji: "🚕", sortOrder: 2 },
      { name: "Другое", emoji: "📦", sortOrder: 100 },
    ])
    .onConflictDoNothing();

  // The expenses repo caches categories in-memory; drop it so getCategories() re-reads.
  const { invalidateCategoriesCache } = await import("../../src/expenses/repository.js");
  invalidateCategoriesCache();

  const cats = await db.select({ id: categories.id }).from(categories);
  return { tribeId, categoryIds: cats.map((c) => c.id) };
}

/** Delete a test user and their expenses (call in `after()` with your test telegram id). */
export async function cleanupTestUser(telegramId: number): Promise<void> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.telegramId, BigInt(telegramId)));
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    // Remove FK-dependent rows first, then the user.
    await db.execute(sql`DELETE FROM expenses WHERE user_id IN (${sql.join(ids, sql`, `)})`);
    await db.delete(users).where(inArray(users.id, ids));
  }
}

/** Close the pool (call once in the final test file's `after()`). */
export async function closeTestDb(): Promise<void> {
  const { closePool } = await import("../../src/db/connection.js");
  await closePool();
}

export { and, eq };
