-- Gandalf mode: tribe-wide structured information tracker

-- ─── Categories ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gandalf_categories (
  id SERIAL PRIMARY KEY,
  tribe_id INTEGER NOT NULL REFERENCES tribes(id),
  name VARCHAR(100) NOT NULL,
  emoji VARCHAR(10) DEFAULT '📁',
  created_by_user_id INTEGER REFERENCES users(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tribe_id, name)
);

CREATE INDEX IF NOT EXISTS idx_gandalf_categories_tribe ON gandalf_categories(tribe_id);

-- ─── Entries ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gandalf_entries (
  id SERIAL PRIMARY KEY,
  tribe_id INTEGER NOT NULL REFERENCES tribes(id),
  category_id INTEGER NOT NULL REFERENCES gandalf_categories(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  price NUMERIC(12,2),
  added_by_user_id INTEGER NOT NULL REFERENCES users(id),
  next_date TIMESTAMPTZ,
  additional_info TEXT,
  input_method VARCHAR(10) DEFAULT 'text',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT gandalf_entries_price_check CHECK (price IS NULL OR price >= 0),
  CONSTRAINT gandalf_entries_input_method_check CHECK (input_method IN ('text', 'voice'))
);

CREATE INDEX IF NOT EXISTS idx_gandalf_entries_tribe_created ON gandalf_entries(tribe_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gandalf_entries_category ON gandalf_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_gandalf_entries_user_created ON gandalf_entries(added_by_user_id, created_at);

-- ─── Entry Files ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gandalf_entry_files (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES gandalf_entries(id) ON DELETE CASCADE,
  telegram_file_id VARCHAR(255) NOT NULL,
  file_type VARCHAR(20) NOT NULL,
  file_name VARCHAR(255),
  mime_type VARCHAR(100),
  file_size_bytes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gandalf_entry_files_entry ON gandalf_entry_files(entry_id);
