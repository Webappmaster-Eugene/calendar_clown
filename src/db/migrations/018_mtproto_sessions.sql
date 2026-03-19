-- Per-user MTProto sessions for Telegram folder import
CREATE TABLE IF NOT EXISTS telegram_mtproto_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) UNIQUE,
  session_string TEXT NOT NULL,
  phone_hint VARCHAR(20),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mtproto_sessions_user ON telegram_mtproto_sessions(user_id);
