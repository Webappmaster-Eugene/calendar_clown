-- Thought Simplifier: history of text simplifications
CREATE TABLE thought_simplifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  input_type VARCHAR(10) NOT NULL DEFAULT 'text'
    CHECK (input_type IN ('text', 'voice', 'mixed')),
  original_text TEXT NOT NULL,
  simplified_text TEXT,
  model_used VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  simplified_at TIMESTAMPTZ
);

CREATE INDEX idx_thought_simplifications_user_created
  ON thought_simplifications(user_id, created_at);
