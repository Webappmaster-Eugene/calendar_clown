-- Goal Sets: наборы целей (до 5 на юзера, уникальные имена)
CREATE TABLE goal_sets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  emoji VARCHAR(10) DEFAULT '🎯',
  period VARCHAR(20) NOT NULL DEFAULT 'current',
  visibility VARCHAR(10) NOT NULL DEFAULT 'private',
  deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_goal_sets_user ON goal_sets(user_id);
CREATE UNIQUE INDEX goal_sets_user_name_key ON goal_sets(user_id, name);
ALTER TABLE goal_sets ADD CONSTRAINT goal_sets_period_check
  CHECK (period IN ('current', 'month', 'year', '5years'));
ALTER TABLE goal_sets ADD CONSTRAINT goal_sets_visibility_check
  CHECK (visibility IN ('public', 'private'));

-- Goals: отдельные цели в наборе
CREATE TABLE goals (
  id SERIAL PRIMARY KEY,
  goal_set_id INTEGER NOT NULL REFERENCES goal_sets(id) ON DELETE CASCADE,
  text VARCHAR(500) NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  input_method VARCHAR(10) NOT NULL DEFAULT 'text',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_goals_goal_set ON goals(goal_set_id);

-- Goal Set Viewers: кто из трайба может видеть публичный набор
CREATE TABLE goal_set_viewers (
  id SERIAL PRIMARY KEY,
  goal_set_id INTEGER NOT NULL REFERENCES goal_sets(id) ON DELETE CASCADE,
  viewer_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX goal_set_viewers_unique ON goal_set_viewers(goal_set_id, viewer_user_id);

-- Goal Reminders: предвычисленные напоминания на набор
CREATE TABLE goal_reminders (
  id SERIAL PRIMARY KEY,
  goal_set_id INTEGER NOT NULL REFERENCES goal_sets(id) ON DELETE CASCADE,
  remind_at TIMESTAMPTZ NOT NULL,
  sent BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_goal_reminders_pending ON goal_reminders(remind_at) WHERE sent = false;
