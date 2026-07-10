-- Normalize constraint names to the Drizzle convention. Guarded with IF EXISTS so it
-- renames the historical _fkey/_key names on an existing DB, yet no-ops on a fresh DB
-- (built from 0000_baseline, which already uses Drizzle names). Metadata only.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='action_logs_user_id_fkey' AND conrelid='"action_logs"'::regclass) THEN
    ALTER TABLE "action_logs" RENAME CONSTRAINT "action_logs_user_id_fkey" TO "action_logs_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='blogger_channels_user_id_fkey' AND conrelid='"blogger_channels"'::regclass) THEN
    ALTER TABLE "blogger_channels" RENAME CONSTRAINT "blogger_channels_user_id_fkey" TO "blogger_channels_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='blogger_posts_channel_id_fkey' AND conrelid='"blogger_posts"'::regclass) THEN
    ALTER TABLE "blogger_posts" RENAME CONSTRAINT "blogger_posts_channel_id_fkey" TO "blogger_posts_channel_id_blogger_channels_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='blogger_posts_user_id_fkey' AND conrelid='"blogger_posts"'::regclass) THEN
    ALTER TABLE "blogger_posts" RENAME CONSTRAINT "blogger_posts_user_id_fkey" TO "blogger_posts_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='blogger_sources_post_id_fkey' AND conrelid='"blogger_sources"'::regclass) THEN
    ALTER TABLE "blogger_sources" RENAME CONSTRAINT "blogger_sources_post_id_fkey" TO "blogger_sources_post_id_blogger_posts_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='calendar_events_tribe_id_fkey' AND conrelid='"calendar_events"'::regclass) THEN
    ALTER TABLE "calendar_events" RENAME CONSTRAINT "calendar_events_tribe_id_fkey" TO "calendar_events_tribe_id_tribes_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='calendar_events_user_id_fkey' AND conrelid='"calendar_events"'::regclass) THEN
    ALTER TABLE "calendar_events" RENAME CONSTRAINT "calendar_events_user_id_fkey" TO "calendar_events_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='categories_created_by_user_id_fkey' AND conrelid='"categories"'::regclass) THEN
    ALTER TABLE "categories" RENAME CONSTRAINT "categories_created_by_user_id_fkey" TO "categories_created_by_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chat_dialogs_user_id_fkey' AND conrelid='"chat_dialogs"'::regclass) THEN
    ALTER TABLE "chat_dialogs" RENAME CONSTRAINT "chat_dialogs_user_id_fkey" TO "chat_dialogs_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chat_messages_dialog_id_fkey' AND conrelid='"chat_messages"'::regclass) THEN
    ALTER TABLE "chat_messages" RENAME CONSTRAINT "chat_messages_dialog_id_fkey" TO "chat_messages_dialog_id_chat_dialogs_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chat_messages_user_id_fkey' AND conrelid='"chat_messages"'::regclass) THEN
    ALTER TABLE "chat_messages" RENAME CONSTRAINT "chat_messages_user_id_fkey" TO "chat_messages_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='digest_channels_rubric_id_fkey' AND conrelid='"digest_channels"'::regclass) THEN
    ALTER TABLE "digest_channels" RENAME CONSTRAINT "digest_channels_rubric_id_fkey" TO "digest_channels_rubric_id_digest_rubrics_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='digest_posts_rubric_id_fkey' AND conrelid='"digest_posts"'::regclass) THEN
    ALTER TABLE "digest_posts" RENAME CONSTRAINT "digest_posts_rubric_id_fkey" TO "digest_posts_rubric_id_digest_rubrics_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='digest_posts_run_id_fkey' AND conrelid='"digest_posts"'::regclass) THEN
    ALTER TABLE "digest_posts" RENAME CONSTRAINT "digest_posts_run_id_fkey" TO "digest_posts_run_id_digest_runs_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='digest_posts_user_id_fkey' AND conrelid='"digest_posts"'::regclass) THEN
    ALTER TABLE "digest_posts" RENAME CONSTRAINT "digest_posts_user_id_fkey" TO "digest_posts_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='digest_rubrics_user_id_fkey' AND conrelid='"digest_rubrics"'::regclass) THEN
    ALTER TABLE "digest_rubrics" RENAME CONSTRAINT "digest_rubrics_user_id_fkey" TO "digest_rubrics_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='digest_runs_rubric_id_fkey' AND conrelid='"digest_runs"'::regclass) THEN
    ALTER TABLE "digest_runs" RENAME CONSTRAINT "digest_runs_rubric_id_fkey" TO "digest_runs_rubric_id_digest_rubrics_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='digest_runs_user_id_fkey' AND conrelid='"digest_runs"'::regclass) THEN
    ALTER TABLE "digest_runs" RENAME CONSTRAINT "digest_runs_user_id_fkey" TO "digest_runs_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='expenses_category_id_fkey' AND conrelid='"expenses"'::regclass) THEN
    ALTER TABLE "expenses" RENAME CONSTRAINT "expenses_category_id_fkey" TO "expenses_category_id_categories_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='expenses_tribe_id_fkey' AND conrelid='"expenses"'::regclass) THEN
    ALTER TABLE "expenses" RENAME CONSTRAINT "expenses_tribe_id_fkey" TO "expenses_tribe_id_tribes_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='expenses_user_id_fkey' AND conrelid='"expenses"'::regclass) THEN
    ALTER TABLE "expenses" RENAME CONSTRAINT "expenses_user_id_fkey" TO "expenses_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gandalf_categories_created_by_user_id_fkey' AND conrelid='"gandalf_categories"'::regclass) THEN
    ALTER TABLE "gandalf_categories" RENAME CONSTRAINT "gandalf_categories_created_by_user_id_fkey" TO "gandalf_categories_created_by_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gandalf_categories_tribe_id_fkey' AND conrelid='"gandalf_categories"'::regclass) THEN
    ALTER TABLE "gandalf_categories" RENAME CONSTRAINT "gandalf_categories_tribe_id_fkey" TO "gandalf_categories_tribe_id_tribes_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gandalf_entries_added_by_user_id_fkey' AND conrelid='"gandalf_entries"'::regclass) THEN
    ALTER TABLE "gandalf_entries" RENAME CONSTRAINT "gandalf_entries_added_by_user_id_fkey" TO "gandalf_entries_added_by_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gandalf_entries_category_id_fkey' AND conrelid='"gandalf_entries"'::regclass) THEN
    ALTER TABLE "gandalf_entries" RENAME CONSTRAINT "gandalf_entries_category_id_fkey" TO "gandalf_entries_category_id_gandalf_categories_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gandalf_entries_tribe_id_fkey' AND conrelid='"gandalf_entries"'::regclass) THEN
    ALTER TABLE "gandalf_entries" RENAME CONSTRAINT "gandalf_entries_tribe_id_fkey" TO "gandalf_entries_tribe_id_tribes_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gandalf_entry_files_entry_id_fkey' AND conrelid='"gandalf_entry_files"'::regclass) THEN
    ALTER TABLE "gandalf_entry_files" RENAME CONSTRAINT "gandalf_entry_files_entry_id_fkey" TO "gandalf_entry_files_entry_id_gandalf_entries_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='goal_reminders_goal_set_id_fkey' AND conrelid='"goal_reminders"'::regclass) THEN
    ALTER TABLE "goal_reminders" RENAME CONSTRAINT "goal_reminders_goal_set_id_fkey" TO "goal_reminders_goal_set_id_goal_sets_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='goal_set_viewers_goal_set_id_fkey' AND conrelid='"goal_set_viewers"'::regclass) THEN
    ALTER TABLE "goal_set_viewers" RENAME CONSTRAINT "goal_set_viewers_goal_set_id_fkey" TO "goal_set_viewers_goal_set_id_goal_sets_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='goal_set_viewers_viewer_user_id_fkey' AND conrelid='"goal_set_viewers"'::regclass) THEN
    ALTER TABLE "goal_set_viewers" RENAME CONSTRAINT "goal_set_viewers_viewer_user_id_fkey" TO "goal_set_viewers_viewer_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='goal_sets_user_id_fkey' AND conrelid='"goal_sets"'::regclass) THEN
    ALTER TABLE "goal_sets" RENAME CONSTRAINT "goal_sets_user_id_fkey" TO "goal_sets_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='goals_goal_set_id_fkey' AND conrelid='"goals"'::regclass) THEN
    ALTER TABLE "goals" RENAME CONSTRAINT "goals_goal_set_id_fkey" TO "goals_goal_set_id_goal_sets_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notable_dates_added_by_user_id_fkey' AND conrelid='"notable_dates"'::regclass) THEN
    ALTER TABLE "notable_dates" RENAME CONSTRAINT "notable_dates_added_by_user_id_fkey" TO "notable_dates_added_by_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notable_dates_tribe_id_fkey' AND conrelid='"notable_dates"'::regclass) THEN
    ALTER TABLE "notable_dates" RENAME CONSTRAINT "notable_dates_tribe_id_fkey" TO "notable_dates_tribe_id_tribes_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='osint_searches_user_id_fkey' AND conrelid='"osint_searches"'::regclass) THEN
    ALTER TABLE "osint_searches" RENAME CONSTRAINT "osint_searches_user_id_fkey" TO "osint_searches_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reminder_subscribers_reminder_id_fkey' AND conrelid='"reminder_subscribers"'::regclass) THEN
    ALTER TABLE "reminder_subscribers" RENAME CONSTRAINT "reminder_subscribers_reminder_id_fkey" TO "reminder_subscribers_reminder_id_reminders_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reminder_subscribers_subscriber_user_id_fkey' AND conrelid='"reminder_subscribers"'::regclass) THEN
    ALTER TABLE "reminder_subscribers" RENAME CONSTRAINT "reminder_subscribers_subscriber_user_id_fkey" TO "reminder_subscribers_subscriber_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reminders_tribe_id_fkey' AND conrelid='"reminders"'::regclass) THEN
    ALTER TABLE "reminders" RENAME CONSTRAINT "reminders_tribe_id_fkey" TO "reminders_tribe_id_tribes_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reminders_user_id_fkey' AND conrelid='"reminders"'::regclass) THEN
    ALTER TABLE "reminders" RENAME CONSTRAINT "reminders_user_id_fkey" TO "reminders_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_reports_resolved_by_fkey' AND conrelid='"support_reports"'::regclass) THEN
    ALTER TABLE "support_reports" RENAME CONSTRAINT "support_reports_resolved_by_fkey" TO "support_reports_resolved_by_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_reports_user_id_fkey' AND conrelid='"support_reports"'::regclass) THEN
    ALTER TABLE "support_reports" RENAME CONSTRAINT "support_reports_user_id_fkey" TO "support_reports_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='task_items_work_id_fkey' AND conrelid='"task_items"'::regclass) THEN
    ALTER TABLE "task_items" RENAME CONSTRAINT "task_items_work_id_fkey" TO "task_items_work_id_task_works_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='task_reminders_task_item_id_fkey' AND conrelid='"task_reminders"'::regclass) THEN
    ALTER TABLE "task_reminders" RENAME CONSTRAINT "task_reminders_task_item_id_fkey" TO "task_reminders_task_item_id_task_items_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='task_works_user_id_fkey' AND conrelid='"task_works"'::regclass) THEN
    ALTER TABLE "task_works" RENAME CONSTRAINT "task_works_user_id_fkey" TO "task_works_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='telegram_mtproto_sessions_user_id_fkey' AND conrelid='"telegram_mtproto_sessions"'::regclass) THEN
    ALTER TABLE "telegram_mtproto_sessions" RENAME CONSTRAINT "telegram_mtproto_sessions_user_id_fkey" TO "telegram_mtproto_sessions_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='thought_simplifications_user_id_fkey' AND conrelid='"thought_simplifications"'::regclass) THEN
    ALTER TABLE "thought_simplifications" RENAME CONSTRAINT "thought_simplifications_user_id_fkey" TO "thought_simplifications_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tribe_monthly_limits_tribe_id_fkey' AND conrelid='"tribe_monthly_limits"'::regclass) THEN
    ALTER TABLE "tribe_monthly_limits" RENAME CONSTRAINT "tribe_monthly_limits_tribe_id_fkey" TO "tribe_monthly_limits_tribe_id_tribes_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_active_dialog_id_fkey' AND conrelid='"users"'::regclass) THEN
    ALTER TABLE "users" RENAME CONSTRAINT "users_active_dialog_id_fkey" TO "users_active_dialog_id_chat_dialogs_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_tribe_id_fkey' AND conrelid='"users"'::regclass) THEN
    ALTER TABLE "users" RENAME CONSTRAINT "users_tribe_id_fkey" TO "users_tribe_id_tribes_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='voice_transcriptions_user_id_fkey' AND conrelid='"voice_transcriptions"'::regclass) THEN
    ALTER TABLE "voice_transcriptions" RENAME CONSTRAINT "voice_transcriptions_user_id_fkey" TO "voice_transcriptions_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wishlist_item_files_item_id_fkey' AND conrelid='"wishlist_item_files"'::regclass) THEN
    ALTER TABLE "wishlist_item_files" RENAME CONSTRAINT "wishlist_item_files_item_id_fkey" TO "wishlist_item_files_item_id_wishlist_items_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wishlist_items_reserved_by_user_id_fkey' AND conrelid='"wishlist_items"'::regclass) THEN
    ALTER TABLE "wishlist_items" RENAME CONSTRAINT "wishlist_items_reserved_by_user_id_fkey" TO "wishlist_items_reserved_by_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wishlist_items_wishlist_id_fkey' AND conrelid='"wishlist_items"'::regclass) THEN
    ALTER TABLE "wishlist_items" RENAME CONSTRAINT "wishlist_items_wishlist_id_fkey" TO "wishlist_items_wishlist_id_wishlists_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wishlists_tribe_id_fkey' AND conrelid='"wishlists"'::regclass) THEN
    ALTER TABLE "wishlists" RENAME CONSTRAINT "wishlists_tribe_id_fkey" TO "wishlists_tribe_id_tribes_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wishlists_user_id_fkey' AND conrelid='"wishlists"'::regclass) THEN
    ALTER TABLE "wishlists" RENAME CONSTRAINT "wishlists_user_id_fkey" TO "wishlists_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='work_achievements_workplace_id_fkey' AND conrelid='"work_achievements"'::regclass) THEN
    ALTER TABLE "work_achievements" RENAME CONSTRAINT "work_achievements_workplace_id_fkey" TO "work_achievements_workplace_id_workplaces_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workplaces_user_id_fkey' AND conrelid='"workplaces"'::regclass) THEN
    ALTER TABLE "workplaces" RENAME CONSTRAINT "workplaces_user_id_fkey" TO "workplaces_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='categories_name_key' AND conrelid='"categories"'::regclass) THEN
    ALTER TABLE "categories" RENAME CONSTRAINT "categories_name_key" TO "categories_name_unique";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='telegram_mtproto_sessions_user_id_key' AND conrelid='"telegram_mtproto_sessions"'::regclass) THEN
    ALTER TABLE "telegram_mtproto_sessions" RENAME CONSTRAINT "telegram_mtproto_sessions_user_id_key" TO "telegram_mtproto_sessions_user_id_unique";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tribes_name_key' AND conrelid='"tribes"'::regclass) THEN
    ALTER TABLE "tribes" RENAME CONSTRAINT "tribes_name_key" TO "tribes_name_unique";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_telegram_id_key' AND conrelid='"users"'::regclass) THEN
    ALTER TABLE "users" RENAME CONSTRAINT "users_telegram_id_key" TO "users_telegram_id_unique";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='voice_transcriptions_telegram_file_unique_id_key' AND conrelid='"voice_transcriptions"'::regclass) THEN
    ALTER TABLE "voice_transcriptions" RENAME CONSTRAINT "voice_transcriptions_telegram_file_unique_id_key" TO "voice_transcriptions_telegram_file_unique_id_unique";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='goal_sets_user_name_key' AND conrelid='"goal_sets"'::regclass) THEN
    ALTER TABLE "goal_sets" ADD CONSTRAINT "goal_sets_user_name_key" UNIQUE USING INDEX "goal_sets_user_name_key";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='goal_set_viewers_unique' AND conrelid='"goal_set_viewers"'::regclass) THEN
    ALTER TABLE "goal_set_viewers" ADD CONSTRAINT "goal_set_viewers_unique" UNIQUE USING INDEX "goal_set_viewers_unique";
  END IF;
END $$;
