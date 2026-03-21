-- Migration 020: Reminders (Напоминатор) feature
-- Flexible recurring reminders with schedule stored as JSONB

CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tribe_id INTEGER REFERENCES tribes(id),
  text VARCHAR(500) NOT NULL,
  schedule JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_fired_at TIMESTAMPTZ,
  input_method VARCHAR(10) NOT NULL DEFAULT 'text',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reminders_input_method_check CHECK (input_method IN ('text', 'voice'))
);

CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_active ON reminders(is_active) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS reminder_subscribers (
  id SERIAL PRIMARY KEY,
  reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  subscriber_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reminder_subscribers_unique UNIQUE (reminder_id, subscriber_user_id)
);

CREATE INDEX IF NOT EXISTS idx_reminder_subscribers_reminder ON reminder_subscribers(reminder_id);
