-- Add columns for ordered delivery of transcription results
ALTER TABLE voice_transcriptions
  ADD COLUMN sequence_number INTEGER,
  ADD COLUMN is_delivered BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN chat_id BIGINT,
  ADD COLUMN status_message_id INTEGER;

-- Backfill: all existing completed/failed records are already delivered
UPDATE voice_transcriptions SET is_delivered = true WHERE status IN ('completed', 'failed');

-- Backfill sequence_number by creation order per user
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) AS seq
  FROM voice_transcriptions
)
UPDATE voice_transcriptions vt SET sequence_number = n.seq FROM numbered n WHERE vt.id = n.id;

ALTER TABLE voice_transcriptions ALTER COLUMN sequence_number SET NOT NULL;

-- Partial index for efficient delivery queries
CREATE INDEX idx_vt_delivery ON voice_transcriptions(user_id, sequence_number) WHERE is_delivered = false;
