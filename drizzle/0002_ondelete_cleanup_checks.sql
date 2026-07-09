-- Phase 4 (part 2): FK onDelete policy, cleanup of redundant objects, and CHECK reconciliation.
-- Guarded (IF EXISTS / IF NOT EXISTS) so it is idempotent on BOTH the existing prod DB
-- (which carries historical check names + is missing chat_messages_role_check) and a fresh
-- DB built from 0000_baseline. No data change.

-- ── Cleanup: drop redundant objects ──────────────────────────────────────────
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_telegram_id_unique";--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_amount_check";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_gandalf_entries_added_user";--> statement-breakpoint

-- ── Align DESC index NULLS ordering to the Drizzle form (cosmetic; columns are NOT NULL) ──
DROP INDEX IF EXISTS "idx_digest_posts_rubric_date";--> statement-breakpoint
CREATE INDEX "idx_digest_posts_rubric_date" ON "digest_posts" USING btree ("rubric_id","post_date" DESC NULLS LAST);--> statement-breakpoint
DROP INDEX IF EXISTS "idx_digest_posts_user_date";--> statement-breakpoint
CREATE INDEX "idx_digest_posts_user_date" ON "digest_posts" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
DROP INDEX IF EXISTS "idx_digest_runs_user";--> statement-breakpoint
CREATE INDEX "idx_digest_runs_user" ON "digest_runs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
DROP INDEX IF EXISTS "idx_voice_transcriptions_created_at";--> statement-breakpoint
CREATE INDEX "idx_voice_transcriptions_created_at" ON "voice_transcriptions" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint

-- ── CHECK reconciliation: unify names to the descriptive prod form ───────────
ALTER TABLE "blogger_sources" DROP CONSTRAINT IF EXISTS "blogger_sources_type_check";--> statement-breakpoint
ALTER TABLE "task_reminders" DROP CONSTRAINT IF EXISTS "task_reminders_type_check";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='blogger_sources_source_type_check' AND conrelid='"blogger_sources"'::regclass) THEN
    ALTER TABLE "blogger_sources" ADD CONSTRAINT "blogger_sources_source_type_check" CHECK ("blogger_sources"."source_type" IN ('text', 'voice', 'link', 'forward', 'web_search'));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='task_reminders_reminder_type_check' AND conrelid='"task_reminders"'::regclass) THEN
    ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_reminder_type_check" CHECK ("task_reminders"."reminder_type" IN ('day_before', '4h_before', '1h_before'));
  END IF;
END $$;--> statement-breakpoint

-- ── CHECK reconciliation: checks on prod but absent from the baseline snapshot ──
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='thought_simplifications_input_type_check' AND conrelid='"thought_simplifications"'::regclass) THEN
    ALTER TABLE "thought_simplifications" ADD CONSTRAINT "thought_simplifications_input_type_check" CHECK ("thought_simplifications"."input_type" IN ('text', 'voice', 'mixed'));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='thought_simplifications_status_check' AND conrelid='"thought_simplifications"'::regclass) THEN
    ALTER TABLE "thought_simplifications" ADD CONSTRAINT "thought_simplifications_status_check" CHECK ("thought_simplifications"."status" IN ('pending', 'processing', 'completed', 'failed'));
  END IF;
END $$;--> statement-breakpoint

-- ── CHECK reconciliation: check in the baseline but missing on prod (add it there) ──
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chat_messages_role_check' AND conrelid='"chat_messages"'::regclass) THEN
    ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_role_check" CHECK ("chat_messages"."role" IN ('user', 'assistant'));
  END IF;
END $$;--> statement-breakpoint

-- ── FK onDelete policy: nullable actor references → SET NULL ──────────────────
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_created_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "gandalf_categories" DROP CONSTRAINT IF EXISTS "gandalf_categories_created_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "notable_dates" DROP CONSTRAINT IF EXISTS "notable_dates_added_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "support_reports" DROP CONSTRAINT IF EXISTS "support_reports_resolved_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "wishlist_items" DROP CONSTRAINT IF EXISTS "wishlist_items_reserved_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gandalf_categories" ADD CONSTRAINT "gandalf_categories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notable_dates" ADD CONSTRAINT "notable_dates_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_reports" ADD CONSTRAINT "support_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_reserved_by_user_id_users_id_fk" FOREIGN KEY ("reserved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
