-- Digest mode: rubrics, channels, runs, posts

CREATE TABLE digest_rubrics (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  emoji VARCHAR(10),
  keywords TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);

CREATE TABLE digest_channels (
  id SERIAL PRIMARY KEY,
  rubric_id INTEGER NOT NULL REFERENCES digest_rubrics(id) ON DELETE CASCADE,
  channel_username VARCHAR(100) NOT NULL,
  channel_title VARCHAR(255),
  subscriber_count INTEGER,
  is_active BOOLEAN DEFAULT true,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(rubric_id, channel_username)
);

CREATE TABLE digest_runs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rubric_id INTEGER NOT NULL REFERENCES digest_rubrics(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  channels_parsed INTEGER NOT NULL DEFAULT 0,
  posts_found INTEGER NOT NULL DEFAULT 0,
  posts_selected INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE digest_posts (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES digest_runs(id),
  rubric_id INTEGER NOT NULL REFERENCES digest_rubrics(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  channel_username VARCHAR(100) NOT NULL,
  channel_title VARCHAR(255),
  telegram_message_id BIGINT NOT NULL,
  message_url TEXT,
  original_text TEXT,
  summary TEXT,
  post_date TIMESTAMPTZ NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  forwards INTEGER NOT NULL DEFAULT 0,
  reactions_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  engagement_score REAL NOT NULL DEFAULT 0,
  is_from_tracked_channel BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, channel_username, telegram_message_id)
);

CREATE INDEX idx_digest_rubrics_user ON digest_rubrics(user_id);
CREATE INDEX idx_digest_channels_rubric ON digest_channels(rubric_id);
CREATE INDEX idx_digest_runs_user ON digest_runs(user_id, created_at DESC);
CREATE INDEX idx_digest_posts_rubric_date ON digest_posts(rubric_id, post_date DESC);
CREATE INDEX idx_digest_posts_user_date ON digest_posts(user_id, created_at DESC);
