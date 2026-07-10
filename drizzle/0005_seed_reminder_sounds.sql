-- Seed the 5 built-in reminder sounds (reference data the DDL-only 0000_baseline
-- no longer carries; the .mp3 assets live in data/sounds/). reminder_sounds has
-- no unique constraint, so idempotency is a per-filename anti-join: no-op on an
-- existing DB (all filenames present), seeds a fresh one, backfills a partial one.

INSERT INTO "reminder_sounds" ("name", "emoji", "filename", "sort_order")
SELECT v.name, v.emoji, v.filename, v.sort_order
FROM (VALUES
  ('Мягкий звон', '🔔', 'gentle-bell.mp3', 1),
  ('Утренняя мелодия', '🌅', 'morning-melody.mp3', 2),
  ('Классический будильник', '⏰', 'alarm-classic.mp3', 3),
  ('Тихое пианино', '🎹', 'piano-soft.mp3', 4),
  ('Яркое уведомление', '🎵', 'notification-bright.mp3', 5)
) AS v("name", "emoji", "filename", "sort_order")
WHERE NOT EXISTS (
  SELECT 1 FROM "reminder_sounds" rs WHERE rs.filename = v.filename
);
