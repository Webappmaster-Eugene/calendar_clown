-- Tribes (family groups)
CREATE TABLE IF NOT EXISTS tribes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL UNIQUE,
  username VARCHAR(255),
  first_name VARCHAR(255) NOT NULL DEFAULT '',
  last_name VARCHAR(255),
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  tribe_id INTEGER NOT NULL REFERENCES tribes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id ON users (telegram_id);

-- Categories (fixed list)
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  emoji VARCHAR(10) NOT NULL DEFAULT '',
  aliases TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tribe_id INTEGER NOT NULL REFERENCES tribes(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  subcategory VARCHAR(500),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  input_method VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (input_method IN ('text', 'voice')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_expenses_tribe_created ON expenses (tribe_id, created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_user_created ON expenses (user_id, created_at);

-- Seed default tribe
INSERT INTO tribes (name) VALUES ('Надточеевы JR')
ON CONFLICT (name) DO NOTHING;

-- Seed categories
INSERT INTO categories (name, emoji, aliases, sort_order) VALUES
  ('Продукты',                          '🛒', ARRAY['продукты', 'еда', 'grocery', 'продукт'], 1),
  ('Здоровье (врачи и процедуры)',      '🏥', ARRAY['здоровье', 'врач', 'врачи', 'процедуры', 'медицина', 'клиника'], 2),
  ('Маркетплейсы и подарки',            '🎁', ARRAY['маркетплейс', 'маркетплейсы', 'подарки', 'подарок', 'озон', 'wildberries', 'вайлдберриз', 'wb'], 3),
  ('Кафе, доставка, фастфуд',           '🍔', ARRAY['кафе', 'доставка', 'фастфуд', 'ресторан', 'еда доставка', 'бургер'], 4),
  ('Ремонт машины и эксплуатация',      '🔧', ARRAY['ремонт машины', 'ремонт авто', 'автосервис', 'сто', 'эксплуатация'], 5),
  ('Аптека',                            '💊', ARRAY['аптека', 'лекарства', 'лекарство', 'таблетки'], 6),
  ('Массаж',                            '💆', ARRAY['массаж'], 7),
  ('Путешествия и билеты',              '✈️', ARRAY['путешествия', 'путешествие', 'билеты', 'билет', 'перелет', 'отпуск'], 8),
  ('Бензин и расходники на машину',     '⛽', ARRAY['бензин', 'заправка', 'расходники', 'топливо', 'газ'], 9),
  ('Спорт взрослых',                    '🏋️', ARRAY['спорт', 'фитнес', 'бассейн', 'тренировка', 'зал', 'спортзал'], 10),
  ('Садик',                             '👶', ARRAY['садик', 'детский сад', 'детсад'], 11),
  ('Кружки и секции детей',             '⚽', ARRAY['кружки', 'кружок', 'секции', 'секция', 'дети секция', 'спорт дети'], 12),
  ('Сервисы, интернет, связь',          '📱', ARRAY['сервисы', 'интернет', 'связь', 'телефон', 'мобильная', 'подписки', 'подписка'], 13),
  ('ЖКХ',                              '🏠', ARRAY['жкх', 'коммуналка', 'квартплата', 'электричество', 'вода', 'газ дом'], 14),
  ('Такси',                             '🚕', ARRAY['такси', 'яндекс такси', 'убер'], 15),
  ('Ипотека',                           '🏦', ARRAY['ипотека', 'кредит', 'ипотечный'], 16),
  ('Развлечения (кино, театр)',         '🎬', ARRAY['развлечения', 'кино', 'театр', 'концерт', 'шоу'], 17),
  ('Услуги (стрижка, эпиляция)',       '✂️', ARRAY['услуги', 'стрижка', 'парикмахер', 'эпиляция', 'маникюр', 'салон'], 18),
  ('Хобби',                             '🎨', ARRAY['хобби', 'ораторское', 'курсы', 'обучение'], 19)
ON CONFLICT (name) DO UPDATE SET
  emoji = EXCLUDED.emoji,
  aliases = EXCLUDED.aliases,
  sort_order = EXCLUDED.sort_order;
