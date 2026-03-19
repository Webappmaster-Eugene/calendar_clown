-- Migration 019: Merge "Notes" into "Gandalf" (renamed to "База знаний")
-- Adds is_important, is_urgent, visibility columns to gandalf_entries.
-- Makes tribe_id nullable for personal (non-tribe) use.
-- Drops notes/note_topics tables.

-- New columns in gandalf_entries
ALTER TABLE gandalf_entries ADD COLUMN IF NOT EXISTS is_important BOOLEAN DEFAULT false;
ALTER TABLE gandalf_entries ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN DEFAULT false;
ALTER TABLE gandalf_entries ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'tribe';
ALTER TABLE gandalf_entries ADD CONSTRAINT gandalf_entries_visibility_check
  CHECK (visibility IN ('tribe', 'private'));

-- Allow personal entries/categories (tribe_id = NULL for users without a tribe)
ALTER TABLE gandalf_entries ALTER COLUMN tribe_id DROP NOT NULL;
ALTER TABLE gandalf_categories ALTER COLUMN tribe_id DROP NOT NULL;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_gandalf_entries_important ON gandalf_entries(is_important) WHERE is_important = true;
CREATE INDEX IF NOT EXISTS idx_gandalf_entries_urgent ON gandalf_entries(is_urgent) WHERE is_urgent = true;
CREATE INDEX IF NOT EXISTS idx_gandalf_entries_visibility ON gandalf_entries(visibility);
CREATE INDEX IF NOT EXISTS idx_gandalf_entries_added_user ON gandalf_entries(added_by_user_id);

-- Unique constraint for personal categories (without tribe)
CREATE UNIQUE INDEX IF NOT EXISTS gandalf_categories_user_name_key
  ON gandalf_categories(created_by_user_id, name) WHERE tribe_id IS NULL AND is_active = true;

-- Drop notes tables
DROP TABLE IF EXISTS notes CASCADE;
DROP TABLE IF EXISTS note_topics CASCADE;
