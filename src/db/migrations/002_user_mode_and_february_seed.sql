-- Add mode column to users table (for stateless mode switching)
ALTER TABLE users ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'calendar';

-- Add amount constraints for anti-abuse
DO $$ BEGIN
  ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_amount_range;
  ALTER TABLE expenses ADD CONSTRAINT expenses_amount_range CHECK (amount >= 1 AND amount <= 10000000);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Seed February 2026 expense data from provided document.
-- First ensure admin user exists (telegram_id will be updated on first real interaction).
-- Using a temporary user_id=1 approach: insert a placeholder if users table is empty.
DO $$
DECLARE
  v_tribe_id INTEGER;
  v_user_id INTEGER;
  v_cat_id INTEGER;
BEGIN
  -- Get default tribe
  SELECT id INTO v_tribe_id FROM tribes ORDER BY id LIMIT 1;
  IF v_tribe_id IS NULL THEN
    INSERT INTO tribes (name) VALUES ('Надточеевы JR') RETURNING id INTO v_tribe_id;
  END IF;

  -- Get or create a seed user
  SELECT id INTO v_user_id FROM users ORDER BY id LIMIT 1;
  IF v_user_id IS NULL THEN
    INSERT INTO users (telegram_id, first_name, role, tribe_id)
    VALUES (0, 'Seed', 'admin', v_tribe_id) RETURNING id INTO v_user_id;
  END IF;

  -- Only seed if no February 2026 data exists
  IF NOT EXISTS (
    SELECT 1 FROM expenses
    WHERE created_at >= '2026-02-01T00:00:00+03:00'
      AND created_at < '2026-03-01T00:00:00+03:00'
    LIMIT 1
  ) THEN
    -- Продукты 55000
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Продукты';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 55000, 'text', '2026-02-15T12:00:00+03:00');

    -- Здоровье 14000
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Здоровье (врачи и процедуры)';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 14000, 'text', '2026-02-15T12:00:00+03:00');

    -- Маркетплейсы 32500
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Маркетплейсы и подарки';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 32500, 'text', '2026-02-15T12:00:00+03:00');

    -- Кафе 15000
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Кафе, доставка, фастфуд';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 15000, 'text', '2026-02-15T12:00:00+03:00');

    -- Ремонт машины 18500
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Ремонт машины и эксплуатация';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 18500, 'text', '2026-02-15T12:00:00+03:00');

    -- Аптека 15800
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Аптека';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 15800, 'text', '2026-02-15T12:00:00+03:00');

    -- Массаж 8400
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Массаж';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 8400, 'text', '2026-02-15T12:00:00+03:00');

    -- Путешествия 9000
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Путешествия и билеты';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 9000, 'text', '2026-02-15T12:00:00+03:00');

    -- Бензин 13400
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Бензин и расходники на машину';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 13400, 'text', '2026-02-15T12:00:00+03:00');

    -- Спорт 3210
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Спорт взрослых';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 3210, 'text', '2026-02-15T12:00:00+03:00');

    -- Садик 37990
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Садик';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 37990, 'text', '2026-02-15T12:00:00+03:00');

    -- Кружки детей 13200
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Кружки и секции детей';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 13200, 'text', '2026-02-15T12:00:00+03:00');

    -- Сервисы, связь 16000
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Сервисы, интернет, связь';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 16000, 'text', '2026-02-15T12:00:00+03:00');

    -- ЖКХ 12000
    SELECT id INTO v_cat_id FROM categories WHERE name = 'ЖКХ';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 12000, 'text', '2026-02-15T12:00:00+03:00');

    -- Такси 2000
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Такси';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 2000, 'text', '2026-02-15T12:00:00+03:00');

    -- Ипотека 72200
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Ипотека';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 72200, 'text', '2026-02-15T12:00:00+03:00');

    -- Развлечения 5000
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Развлечения (кино, театр)';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 5000, 'text', '2026-02-15T12:00:00+03:00');

    -- Услуги 2000
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Услуги (стрижка, эпиляция)';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 2000, 'text', '2026-02-15T12:00:00+03:00');

    -- Хобби 5000
    SELECT id INTO v_cat_id FROM categories WHERE name = 'Хобби';
    INSERT INTO expenses (user_id, tribe_id, category_id, amount, input_method, created_at)
    VALUES (v_user_id, v_tribe_id, v_cat_id, 5000, 'text', '2026-02-15T12:00:00+03:00');
  END IF;
END $$;
