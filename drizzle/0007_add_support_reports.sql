CREATE TABLE support_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  telegram_id BIGINT NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'home_screen',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  diagnostics TEXT NOT NULL,
  platform VARCHAR(50),
  app_version VARCHAR(20),
  user_message TEXT,
  admin_response TEXT,
  resolved_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_support_reports_status ON support_reports(status);
CREATE INDEX idx_support_reports_user ON support_reports(user_id);
