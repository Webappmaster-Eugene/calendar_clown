-- Fix: allow creating a new task work with the same name as an archived one.
-- Replace full unique constraint with a partial unique index
-- that only enforces uniqueness among non-archived works.
-- Uses LOWER(name) for case-insensitive uniqueness (consistent with getTaskWorkByName).

ALTER TABLE task_works DROP CONSTRAINT task_works_user_name_key;

CREATE UNIQUE INDEX task_works_user_name_active_key
  ON task_works (user_id, LOWER(name))
  WHERE is_archived = false;
