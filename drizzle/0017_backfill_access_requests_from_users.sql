-- Backfill the request history for people who were already let in before
-- `access_requests` existed. Their real application timestamp is lost, so the row
-- reuses `users.created_at` — the moment they first appeared — and leaves
-- `decided_by` NULL because the deciding admin was never recorded either.
-- Rejected applicants cannot be recovered at all: rejection deletes the user row.
--
-- Excluded: the seed row (telegram_id = 0) and admins, who never applied.
-- Guard: anti-join on telegram_id, so re-running is a no-op (no unique key here,
-- since a person may legitimately have several requests over time).
INSERT INTO access_requests (telegram_id, username, first_name, last_name, status, decided_at, created_at)
SELECT u.telegram_id, u.username, u.first_name, u.last_name, 'approved', u.created_at, u.created_at
FROM users u
WHERE u.telegram_id > 0
  AND u.role <> 'admin'
  AND COALESCE(u.status, 'approved') = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM access_requests ar WHERE ar.telegram_id = u.telegram_id
  );
