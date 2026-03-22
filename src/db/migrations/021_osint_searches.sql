-- Migration 021: OSINT Searches
-- Web-based people/entity search with AI analysis

CREATE TABLE IF NOT EXISTS osint_searches (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  query TEXT NOT NULL,
  parsed_subject JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'searching', 'analyzing', 'completed', 'failed')),
  search_queries JSONB,
  raw_results JSONB,
  report TEXT,
  sources_count INTEGER NOT NULL DEFAULT 0,
  input_method VARCHAR(10) NOT NULL DEFAULT 'text'
    CHECK (input_method IN ('text', 'voice')),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_osint_searches_user_created ON osint_searches (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_osint_searches_status ON osint_searches (status);
