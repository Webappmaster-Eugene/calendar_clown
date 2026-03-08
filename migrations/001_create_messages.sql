-- Inbound/outbound messages and voice transcripts
CREATE TABLE IF NOT EXISTS messages (
  id                         bigserial PRIMARY KEY,
  telegram_message_id        bigint NOT NULL,
  chat_id                    bigint NOT NULL,
  user_id                    bigint,
  direction                  varchar(10) NOT NULL DEFAULT 'inbound',
  kind                       varchar(20) NOT NULL,
  content_text                text,
  content_voice_file_id       varchar(255),
  content_voice_duration_sec int,
  transcript                 text,
  intent_type                varchar(50),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, telegram_message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_telegram ON messages (chat_id, telegram_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);
