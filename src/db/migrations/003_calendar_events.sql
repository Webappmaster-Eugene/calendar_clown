CREATE TABLE IF NOT EXISTS calendar_events (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  tribe_id        INTEGER NOT NULL REFERENCES tribes(id),
  google_event_id VARCHAR(1024),
  summary         TEXT NOT NULL,
  description     TEXT,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  recurrence      TEXT[],
  input_method    VARCHAR(10) NOT NULL CHECK (input_method IN ('text', 'voice')),
  status          VARCHAR(10) NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'deleted', 'failed')),
  error_message   TEXT,
  html_link       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_calendar_events_user_created ON calendar_events (user_id, created_at);
CREATE INDEX idx_calendar_events_tribe_created ON calendar_events (tribe_id, created_at);
CREATE INDEX idx_calendar_events_google_id ON calendar_events (google_event_id) WHERE google_event_id IS NOT NULL;
CREATE INDEX idx_calendar_events_status ON calendar_events (status);
