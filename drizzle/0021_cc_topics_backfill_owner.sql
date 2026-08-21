-- Every topic that exists today belongs to the bridge's only user so far: the
-- bootstrap admin. Assign them an owner before the column becomes NOT NULL in
-- the next migration.
--
-- Idempotent: touches only rows still missing an owner, and does nothing at all
-- on a fresh database (no rows, no admin).
UPDATE cc_topics
SET user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)
WHERE user_id IS NULL
  AND EXISTS (SELECT 1 FROM users WHERE role = 'admin');
