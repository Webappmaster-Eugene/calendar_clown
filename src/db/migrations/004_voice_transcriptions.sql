-- Voice transcriptions table for the transcriber mode
CREATE TABLE IF NOT EXISTS voice_transcriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),

  -- Telegram metadata
  telegram_file_id VARCHAR(255) NOT NULL,
  telegram_file_unique_id VARCHAR(255) NOT NULL UNIQUE,
  duration_seconds INTEGER NOT NULL,
  file_size_bytes INTEGER,

  -- Forwarded message info
  forwarded_from_name VARCHAR(255),
  forwarded_date TIMESTAMPTZ,

  -- Transcription result
  transcript TEXT,
  model_used VARCHAR(100),

  -- File storage
  audio_file_path VARCHAR(500),

  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  transcribed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_voice_transcriptions_user_id ON voice_transcriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_transcriptions_status ON voice_transcriptions(status);
CREATE INDEX IF NOT EXISTS idx_voice_transcriptions_created_at ON voice_transcriptions(created_at DESC);
