-- Add columns for ordered delivery of simplification results
ALTER TABLE thought_simplifications
  ADD COLUMN sequence_number BIGINT,
  ADD COLUMN is_delivered BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN chat_id BIGINT,
  ADD COLUMN status_message_id INTEGER;

-- Backfill: all existing completed/failed records are already delivered
UPDATE thought_simplifications SET is_delivered = true WHERE status IN ('completed', 'failed');

-- Backfill sequence_number by creation order per user
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) AS seq
  FROM thought_simplifications
)
UPDATE thought_simplifications ts SET sequence_number = n.seq FROM numbered n WHERE ts.id = n.id;

-- Handle empty table case: set default for rows with NULL sequence_number
UPDATE thought_simplifications SET sequence_number = 0 WHERE sequence_number IS NULL;

ALTER TABLE thought_simplifications ALTER COLUMN sequence_number SET NOT NULL;

-- Partial index for efficient delivery queries
CREATE INDEX idx_ts_delivery ON thought_simplifications(user_id, sequence_number) WHERE is_delivered = false;
