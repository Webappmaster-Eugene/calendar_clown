-- Task Works (projects/workspaces)
CREATE TABLE task_works (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  emoji VARCHAR(10) NOT NULL DEFAULT '📋',
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT task_works_user_name_key UNIQUE (user_id, name)
);
CREATE INDEX idx_task_works_user ON task_works(user_id);

-- Task Items (individual tasks within a work)
CREATE TABLE task_items (
  id SERIAL PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES task_works(id) ON DELETE CASCADE,
  text VARCHAR(500) NOT NULL,
  deadline TIMESTAMPTZ NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  input_method VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (input_method IN ('text', 'voice')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_task_items_work ON task_items(work_id);
CREATE INDEX idx_task_items_deadline_active ON task_items(deadline) WHERE is_completed = false;

-- Task Reminders (automatic deadline reminders)
CREATE TABLE task_reminders (
  id SERIAL PRIMARY KEY,
  task_item_id INTEGER NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  remind_at TIMESTAMPTZ NOT NULL,
  reminder_type VARCHAR(20) NOT NULL CHECK (reminder_type IN ('day_before', '4h_before', '1h_before')),
  sent BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_task_reminders_pending ON task_reminders(remind_at) WHERE sent = false;
