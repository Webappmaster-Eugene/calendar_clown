-- Новые категории расходов (по анализу бакета «Другое») + усиление aliases существующих.
-- Data-миграция (не генерится drizzle-kit), образец — 0008_add_other_category.sql.

-- 1. Новые категории (идемпотентно: ON CONFLICT по уникальному name).
INSERT INTO categories (name, emoji, aliases, sort_order)
VALUES
  ('Ремонт и обустройство квартиры', '🛠️',
   ARRAY['ремонт квартиры', 'ремонт дома', 'стройка', 'строй контроль', 'стройматериалы', 'мебель', 'инструменты', 'обустройство'],
   20),
  ('Детские товары', '🧸',
   ARRAY['детские товары', 'детская одежда', 'игрушки', 'одежда ребенку', 'детское', 'памперсы', 'подгузники', 'коляска'],
   21),
  ('Товары для дома', '🧴',
   ARRAY['товары для дома', 'хозтовары', 'фикс прайс', 'бытовая химия', 'посуда', 'для дома', 'свечи'],
   22)
ON CONFLICT (name) DO UPDATE SET
  emoji = EXCLUDED.emoji,
  aliases = EXCLUDED.aliases,
  sort_order = EXCLUDED.sort_order;

-- 2. Усиление aliases существующих категорий.
-- Идемпотентно: сохраняем текущие aliases, добавляем новые, убираем дубли.
UPDATE categories
SET aliases = ARRAY(SELECT DISTINCT unnest(
  aliases || ARRAY['лор', 'узи', 'анализы', 'стоматолог', 'зубной', 'нейропсихолог', 'диагностика', 'окулист']
))
WHERE name = 'Здоровье (врачи и процедуры)';

UPDATE categories
SET aliases = ARRAY(SELECT DISTINCT unnest(
  aliases || ARRAY['бусти', 'boosty', 'донат', 'хостинг', 'сервер', 'домен', 'прокси', 'подписка на блогера', 'сим-карта']
))
WHERE name = 'Сервисы, интернет, связь';

UPDATE categories
SET aliases = ARRAY(SELECT DISTINCT unnest(
  aliases || ARRAY['платная дорога', 'парковка', 'платон', 'автодороги']
))
WHERE name = 'Бензин и расходники на машину';

UPDATE categories
SET aliases = ARRAY(SELECT DISTINCT unnest(
  aliases || ARRAY['ozon']
))
WHERE name = 'Маркетплейсы и подарки';
