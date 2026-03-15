-- Notable dates: birthdays, anniversaries, holidays
CREATE TABLE IF NOT EXISTS notable_dates (
  id SERIAL PRIMARY KEY,
  tribe_id INTEGER NOT NULL REFERENCES tribes(id),
  added_by_user_id INTEGER REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  date_month SMALLINT NOT NULL CHECK (date_month BETWEEN 1 AND 12),
  date_day SMALLINT NOT NULL CHECK (date_day BETWEEN 1 AND 31),
  event_type VARCHAR(50) NOT NULL DEFAULT 'birthday',
  description TEXT,
  greeting_template TEXT,
  emoji VARCHAR(10) DEFAULT '🎂',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notable_dates_tribe ON notable_dates(tribe_id);
CREATE INDEX IF NOT EXISTS idx_notable_dates_month_day ON notable_dates(date_month, date_day);

-- Seed Russian holidays
INSERT INTO notable_dates (tribe_id, name, date_month, date_day, event_type, emoji, greeting_template, is_active)
SELECT 1, name, date_month, date_day, 'holiday', emoji, greeting_template, true
FROM (VALUES
  ('Новый год', 1, 1, '🎄', 'С Новым годом! Пусть новый год принесёт счастье, здоровье и исполнение желаний!'),
  ('Рождество Христово', 1, 7, '⭐', 'С Рождеством Христовым! Пусть этот светлый праздник наполнит ваш дом теплом и радостью!'),
  ('День защитника Отечества', 2, 23, '🎖', 'С Днём защитника Отечества! Желаем мужества, силы и мирного неба!'),
  ('Международный женский день', 3, 8, '💐', 'С 8 Марта! Желаем весеннего настроения, красоты и любви!'),
  ('Праздник Весны и Труда', 5, 1, '🌷', 'С Первомаем! Пусть весна дарит радость и вдохновение!'),
  ('День Победы', 5, 9, '🎗', 'С Днём Победы! Помним, гордимся. Мирного неба над головой!'),
  ('День России', 6, 12, '🇷🇺', 'С Днём России! Любви к Родине и процветания!'),
  ('День народного единства', 11, 4, '🤝', 'С Днём народного единства! Вместе мы — сила!'),
  ('День кино', 12, 28, '🎬', 'С Днём кино! Пусть жизнь будет ярче любого фильма!')
) AS h(name, date_month, date_day, emoji, greeting_template)
WHERE NOT EXISTS (SELECT 1 FROM notable_dates WHERE event_type = 'holiday' AND notable_dates.date_month = h.date_month AND notable_dates.date_day = h.date_day);

-- Add mode 'notable_dates' to valid modes
-- (handled in code, not in DB constraint)
