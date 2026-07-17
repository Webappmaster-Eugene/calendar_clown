import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration test for the reference-data seed migrations (0004–0007) against a
 * real DB. The collapsed DDL-only baseline no longer carries seed rows, so these
 * migrations re-add them idempotently. This guards against the seed gap regressing:
 * a fresh DB must come up with the default tribe, the current expense categories,
 * and the 5 built-in reminder sounds — each present exactly once (no duplicates).
 *
 * The expected set reflects the net of all category seed migrations: 0004 seeds 23,
 * 0006 adds "Одежда и обувь" + "Товары для красоты", 0007 drops "Массаж" (folded
 * into "Услуги (стрижка, эпиляция)") and adds "Помощь родителям" + "Дача" → 26.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/seed.integration.test.ts
 */

const SEED_CATEGORY_NAMES = [
  "Продукты", "Здоровье (врачи и процедуры)", "Подарки", "Кафе, доставка, фастфуд",
  "Ремонт машины и эксплуатация", "Аптека", "Путешествия и билеты",
  "Бензин и расходники на машину", "Спорт взрослых", "Садик", "Кружки и секции детей",
  "Сервисы, интернет, связь", "ЖКХ", "Такси", "Ипотека", "Развлечения (кино, театр)",
  "Услуги (стрижка, эпиляция)", "Хобби", "Ремонт и обустройство квартиры",
  "Детские товары", "Товары для дома", "Другое",
  "Одежда и обувь", "Товары для красоты", "Помощь родителям", "Дача",
];

const SEED_SOUND_FILES = [
  "gentle-bell.mp3", "morning-melody.mp3", "alarm-classic.mp3", "piano-soft.mp3", "notification-bright.mp3",
];

let db: typeof import("../src/db/drizzle.js").db;
let schema: typeof import("../src/db/schema.js");

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb } = await import("./helpers/testDb.js");
  await setupTestDb(); // runs migrations, including the seeds under test
  db = (await import("../src/db/drizzle.js")).db;
  schema = await import("../src/db/schema.js");
});

after(async () => {
  const { closeTestDb } = await import("./helpers/testDb.js");
  await closeTestDb();
});

describe("reference-data seeds", () => {
  it("seeds a default tribe (0004)", async () => {
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(schema.tribes).where(eq(schema.tribes.name, "Семья"));
    assert.equal(rows.length, 1, "default tribe 'Семья' must exist exactly once");
  });

  it("seeds all 26 expense categories, each exactly once (0004+0006+0007)", async () => {
    const rows = await db.select().from(schema.categories);
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
    for (const name of SEED_CATEGORY_NAMES) {
      assert.equal(counts.get(name), 1, `category "${name}" must be present exactly once (no dup, no missing)`);
    }
    // 0007 removed the standalone "Массаж" (folded into "Услуги (стрижка, эпиляция)").
    assert.equal(counts.get("Массаж"), undefined, `category "Массаж" must be removed by 0007`);
  });

  it("gives every category a non-empty description (0008)", async () => {
    const rows = await db.select().from(schema.categories);
    const byName = new Map(rows.map((r) => [r.name, r.description]));
    for (const name of SEED_CATEGORY_NAMES) {
      const descr = byName.get(name);
      assert.ok(descr && descr.trim().length > 0, `category "${name}" must have a description`);
    }
  });

  it("preserves category metadata (emoji + sort order)", async () => {
    const { eq } = await import("drizzle-orm");
    const [produkty] = await db.select().from(schema.categories).where(eq(schema.categories.name, "Продукты"));
    assert.equal(produkty.emoji, "🛒");
    assert.equal(produkty.sortOrder, 1);
    const [other] = await db.select().from(schema.categories).where(eq(schema.categories.name, "Другое"));
    assert.equal(other.emoji, "📦");
    assert.equal(other.sortOrder, 100);
  });

  it("seeds all 5 built-in reminder sounds, each exactly once (0005)", async () => {
    const rows = await db.select().from(schema.reminderSounds);
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.filename, (counts.get(r.filename) ?? 0) + 1);
    for (const file of SEED_SOUND_FILES) {
      assert.equal(counts.get(file), 1, `reminder sound "${file}" must be present exactly once`);
    }
  });
});
