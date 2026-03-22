-- Summarizer: Workplaces
CREATE TABLE workplaces (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_workplaces_user ON workplaces(user_id);

-- Summarizer: Work Achievements
CREATE TABLE work_achievements (
  id SERIAL PRIMARY KEY,
  workplace_id INTEGER NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  input_method VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (input_method IN ('text', 'voice')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_work_achievements_workplace ON work_achievements(workplace_id);

-- Blogger: Channels
CREATE TABLE blogger_channels (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  channel_username VARCHAR(255),
  channel_title VARCHAR(255) NOT NULL,
  niche_description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_blogger_channels_user ON blogger_channels(user_id);

-- Blogger: Posts
CREATE TABLE blogger_posts (
  id SERIAL PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES blogger_channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  topic VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'collecting', 'generating', 'generated', 'published')),
  generated_text TEXT,
  model_used VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_at TIMESTAMPTZ
);
CREATE INDEX idx_blogger_posts_channel ON blogger_posts(channel_id);
CREATE INDEX idx_blogger_posts_user ON blogger_posts(user_id, created_at);

-- Blogger: Sources
CREATE TABLE blogger_sources (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES blogger_posts(id) ON DELETE CASCADE,
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('text', 'voice', 'link', 'forward', 'web_search')),
  content TEXT NOT NULL,
  title VARCHAR(500),
  parsed_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_blogger_sources_post ON blogger_sources(post_id);
