-- Migration 007: Notes, action logs, schema extensions for Task 13

-- Add status to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved';

-- Add monthly_limit to tribes
ALTER TABLE tribes ADD COLUMN IF NOT EXISTS monthly_limit NUMERIC(12, 2);

-- Add reminder flags to notable_dates
ALTER TABLE notable_dates ADD COLUMN IF NOT EXISTS remind_7days BOOLEAN DEFAULT true;
ALTER TABLE notable_dates ADD COLUMN IF NOT EXISTS remind_3days BOOLEAN DEFAULT true;
ALTER TABLE notable_dates ADD COLUMN IF NOT EXISTS remind_1day BOOLEAN DEFAULT true;

-- Action logs table
CREATE TABLE IF NOT EXISTS action_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  telegram_id BIGINT,
  action VARCHAR(100) NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_logs_user ON action_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_action ON action_logs(action);
CREATE INDEX IF NOT EXISTS idx_action_logs_created ON action_logs(created_at);

-- Note topics table
CREATE TABLE IF NOT EXISTS note_topics (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  emoji VARCHAR(10) DEFAULT '📁',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_note_topics_user ON note_topics(user_id);

-- Notes table
CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  topic_id INTEGER REFERENCES note_topics(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  is_important BOOLEAN DEFAULT false,
  is_urgent BOOLEAN DEFAULT false,
  has_image BOOLEAN DEFAULT false,
  image_file_path VARCHAR(500),
  input_method VARCHAR(10) NOT NULL DEFAULT 'text',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_topic ON notes(topic_id);
CREATE INDEX IF NOT EXISTS idx_notes_flags ON notes(is_important, is_urgent);
CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at);
