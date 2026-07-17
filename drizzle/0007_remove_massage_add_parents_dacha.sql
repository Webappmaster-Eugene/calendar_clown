-- Remove the standalone "Массаж" category (folded into "Услуги (стрижка,
-- эпиляция)") and add two new categories. Forward-only + idempotent: a safe
-- no-op when re-run, and correct whether or not "Массаж" still exists.

-- 1. Keep voice/text routing working: fold the "массаж" alias into Услуги.
UPDATE "categories"
SET "aliases" = array_append("aliases", 'массаж')
WHERE "name" = 'Услуги (стрижка, эпиляция)'
  AND NOT ('массаж' = ANY("aliases"));
--> statement-breakpoint

-- 2. Reassign expenses still pointing at Массаж before deleting it (FK is
-- RESTRICT). No-op once Массаж is gone (subquery → NULL, matches no rows).
UPDATE "expenses"
SET "category_id" = (SELECT "id" FROM "categories" WHERE "name" = 'Услуги (стрижка, эпиляция)'),
    "updated_at" = now()
WHERE "category_id" = (SELECT "id" FROM "categories" WHERE "name" = 'Массаж');
--> statement-breakpoint

-- 3. Drop the now-unused category.
DELETE FROM "categories" WHERE "name" = 'Массаж';
--> statement-breakpoint

-- 4. Add two new reference categories (idempotent via unique name).
INSERT INTO "categories" ("name", "emoji", "sort_order", "aliases") VALUES
  ('Помощь родителям', '👵', 25, ARRAY['помощь родителям','родители','родителям','маме','папе','мама','папа','бабушка','дедушка']),
  ('Дача', '🏡', 26, ARRAY['дача','дачный участок','огород','сад','грядки','рассада','теплица','дачные'])
ON CONFLICT ("name") DO NOTHING;
