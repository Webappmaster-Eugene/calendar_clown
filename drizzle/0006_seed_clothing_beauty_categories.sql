-- Seed two additional expense categories (reference data). Idempotent via
-- ON CONFLICT (name) DO NOTHING — no-op on a DB that already has them, seeds the
-- rest. Same guarded pattern as 0004_seed_default_tribe_and_categories.

INSERT INTO "categories" ("name", "emoji", "sort_order", "aliases") VALUES
  ('Одежда и обувь', '👗', 23, ARRAY['одежда','обувь','одежда и обувь','ботинки','кроссовки','куртка','джинсы','платье','футболка','штаны','кофта','носки','сапоги']),
  ('Товары для красоты', '💄', 24, ARRAY['товары для красоты','красота','косметика','макияж','уход','крем','парфюм','духи','шампунь','маска для лица','тушь','помада','сыворотка'])
ON CONFLICT ("name") DO NOTHING;
