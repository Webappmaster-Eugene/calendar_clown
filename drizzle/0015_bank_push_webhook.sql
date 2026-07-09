-- Bank push-notification webhook (Вариант B): auto-import T-Bank card spends.
--
-- NOTE: db:generate re-emitted a large amount of already-applied DDL because the
-- Drizzle meta snapshots in this repo are stale (tables like nutrition_products,
-- support_reports, tribe_monthly_limits were created by migrations 0006–0011).
-- This file was hand-trimmed to contain ONLY the changes for this feature; the
-- refreshed 0015 snapshot absorbs the prior drift so future diffs stay clean.

-- expenses: distinguish auto-imported bank operations and dedupe repeated pushes.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "source" varchar(20) DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "dedup_hash" varchar(64);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_source_check" CHECK ("expenses"."source" IN ('text', 'voice', 'bank_push'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_expenses_dedup_hash" ON "expenses" USING btree ("dedup_hash") WHERE "expenses"."dedup_hash" IS NOT NULL;--> statement-breakpoint

-- users: per-user webhook secret (NULL until enabled; regenerable to revoke the URL).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "webhook_secret" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_webhook_secret" ON "users" USING btree ("webhook_secret");
