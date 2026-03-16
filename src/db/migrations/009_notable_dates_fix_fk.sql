-- Add missing FK constraint to notable_dates.tribe_id -> tribes.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notable_dates_tribe_id_fkey'
      AND table_name = 'notable_dates'
  ) THEN
    ALTER TABLE notable_dates
      ADD CONSTRAINT notable_dates_tribe_id_fkey
      FOREIGN KEY (tribe_id) REFERENCES tribes(id);
  END IF;
END $$;

-- Add missing FK constraint to notable_dates.added_by_user_id -> users.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notable_dates_added_by_user_id_fkey'
      AND table_name = 'notable_dates'
  ) THEN
    ALTER TABLE notable_dates
      ADD CONSTRAINT notable_dates_added_by_user_id_fkey
      FOREIGN KEY (added_by_user_id) REFERENCES users(id);
  END IF;
END $$;
