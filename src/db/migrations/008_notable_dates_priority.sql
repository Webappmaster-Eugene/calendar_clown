-- Add is_priority column for advance reminders (7, 3, 1 days before)
ALTER TABLE notable_dates ADD COLUMN IF NOT EXISTS is_priority BOOLEAN DEFAULT false;

-- Seed Orthodox holidays (fixed dates only; Пасха и Троица — переходящие, не включены)
INSERT INTO notable_dates (tribe_id, name, date_month, date_day, event_type, emoji, greeting_template, is_active, is_priority)
SELECT 1, name, date_month, date_day, 'holiday', emoji, greeting_template, true, false
FROM (VALUES
  ('Крещение Господне', 1, 19, '✝️', 'С Крещением Господним! Пусть святая вода очистит душу и дарует благодать!'),
  ('Сретение Господне', 2, 15, '✝️', 'Со Сретением Господним! Пусть встреча с верой наполнит сердце светом!'),
  ('Благовещение Пресвятой Богородицы', 4, 7, '✝️', 'С Благовещением! Пусть благая весть принесёт мир и радость!'),
  ('Преображение Господне', 8, 19, '✝️', 'С Преображением Господним! Пусть свет преобразит жизнь к лучшему!'),
  ('Успение Пресвятой Богородицы', 8, 28, '✝️', 'С Успением Пресвятой Богородицы! Пусть Её покров хранит вас!'),
  ('Рождество Пресвятой Богородицы', 9, 21, '✝️', 'С Рождеством Пресвятой Богородицы! Пусть Матерь Божия дарует защиту и любовь!'),
  ('Воздвижение Креста Господня', 9, 27, '✝️', 'С Воздвижением Креста Господня! Пусть вера укрепляет дух!'),
  ('Введение во храм Пресвятой Богородицы', 12, 4, '✝️', 'С Введением во храм! Пусть этот праздник наполнит душу благодатью!')
) AS h(name, date_month, date_day, emoji, greeting_template)
WHERE NOT EXISTS (
  SELECT 1 FROM notable_dates
  WHERE event_type = 'holiday'
    AND notable_dates.date_month = h.date_month
    AND notable_dates.date_day = h.date_day
);

-- Seed Старый Новый год (unofficial but popular)
INSERT INTO notable_dates (tribe_id, name, date_month, date_day, event_type, emoji, greeting_template, is_active, is_priority)
SELECT 1, 'Старый Новый год', 1, 14, 'holiday', '🎄', 'Со Старым Новым годом! Пусть ещё один новый год принесёт удачу!', true, false
WHERE NOT EXISTS (
  SELECT 1 FROM notable_dates
  WHERE event_type = 'holiday' AND date_month = 1 AND date_day = 14
);

-- Mark all birthdays as priority by default (they get advance reminders)
UPDATE notable_dates SET is_priority = true WHERE event_type = 'birthday';
