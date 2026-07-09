-- Phase 4 (part 1): normalize all constraint names to the Drizzle convention.
-- Renames prod's historical _fkey/_key names to <table>_<col>_<reftable>_id_fk / _unique,
-- and promotes two bare unique indexes (goal_sets, goal_set_viewers) to unique constraints,
-- so prod matches the collapsed baseline snapshot exactly. Pure metadata — no data change.

ALTER TABLE "action_logs" RENAME CONSTRAINT "action_logs_user_id_fkey" TO "action_logs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "blogger_channels" RENAME CONSTRAINT "blogger_channels_user_id_fkey" TO "blogger_channels_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "blogger_posts" RENAME CONSTRAINT "blogger_posts_channel_id_fkey" TO "blogger_posts_channel_id_blogger_channels_id_fk";
--> statement-breakpoint
ALTER TABLE "blogger_posts" RENAME CONSTRAINT "blogger_posts_user_id_fkey" TO "blogger_posts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "blogger_sources" RENAME CONSTRAINT "blogger_sources_post_id_fkey" TO "blogger_sources_post_id_blogger_posts_id_fk";
--> statement-breakpoint
ALTER TABLE "calendar_events" RENAME CONSTRAINT "calendar_events_tribe_id_fkey" TO "calendar_events_tribe_id_tribes_id_fk";
--> statement-breakpoint
ALTER TABLE "calendar_events" RENAME CONSTRAINT "calendar_events_user_id_fkey" TO "calendar_events_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "categories" RENAME CONSTRAINT "categories_created_by_user_id_fkey" TO "categories_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "chat_dialogs" RENAME CONSTRAINT "chat_dialogs_user_id_fkey" TO "chat_dialogs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "chat_messages" RENAME CONSTRAINT "chat_messages_dialog_id_fkey" TO "chat_messages_dialog_id_chat_dialogs_id_fk";
--> statement-breakpoint
ALTER TABLE "chat_messages" RENAME CONSTRAINT "chat_messages_user_id_fkey" TO "chat_messages_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "digest_channels" RENAME CONSTRAINT "digest_channels_rubric_id_fkey" TO "digest_channels_rubric_id_digest_rubrics_id_fk";
--> statement-breakpoint
ALTER TABLE "digest_posts" RENAME CONSTRAINT "digest_posts_rubric_id_fkey" TO "digest_posts_rubric_id_digest_rubrics_id_fk";
--> statement-breakpoint
ALTER TABLE "digest_posts" RENAME CONSTRAINT "digest_posts_run_id_fkey" TO "digest_posts_run_id_digest_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "digest_posts" RENAME CONSTRAINT "digest_posts_user_id_fkey" TO "digest_posts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "digest_rubrics" RENAME CONSTRAINT "digest_rubrics_user_id_fkey" TO "digest_rubrics_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "digest_runs" RENAME CONSTRAINT "digest_runs_rubric_id_fkey" TO "digest_runs_rubric_id_digest_rubrics_id_fk";
--> statement-breakpoint
ALTER TABLE "digest_runs" RENAME CONSTRAINT "digest_runs_user_id_fkey" TO "digest_runs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" RENAME CONSTRAINT "expenses_category_id_fkey" TO "expenses_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" RENAME CONSTRAINT "expenses_tribe_id_fkey" TO "expenses_tribe_id_tribes_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" RENAME CONSTRAINT "expenses_user_id_fkey" TO "expenses_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "gandalf_categories" RENAME CONSTRAINT "gandalf_categories_created_by_user_id_fkey" TO "gandalf_categories_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "gandalf_categories" RENAME CONSTRAINT "gandalf_categories_tribe_id_fkey" TO "gandalf_categories_tribe_id_tribes_id_fk";
--> statement-breakpoint
ALTER TABLE "gandalf_entries" RENAME CONSTRAINT "gandalf_entries_added_by_user_id_fkey" TO "gandalf_entries_added_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "gandalf_entries" RENAME CONSTRAINT "gandalf_entries_category_id_fkey" TO "gandalf_entries_category_id_gandalf_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "gandalf_entries" RENAME CONSTRAINT "gandalf_entries_tribe_id_fkey" TO "gandalf_entries_tribe_id_tribes_id_fk";
--> statement-breakpoint
ALTER TABLE "gandalf_entry_files" RENAME CONSTRAINT "gandalf_entry_files_entry_id_fkey" TO "gandalf_entry_files_entry_id_gandalf_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "goal_reminders" RENAME CONSTRAINT "goal_reminders_goal_set_id_fkey" TO "goal_reminders_goal_set_id_goal_sets_id_fk";
--> statement-breakpoint
ALTER TABLE "goal_set_viewers" RENAME CONSTRAINT "goal_set_viewers_goal_set_id_fkey" TO "goal_set_viewers_goal_set_id_goal_sets_id_fk";
--> statement-breakpoint
ALTER TABLE "goal_set_viewers" RENAME CONSTRAINT "goal_set_viewers_viewer_user_id_fkey" TO "goal_set_viewers_viewer_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "goal_sets" RENAME CONSTRAINT "goal_sets_user_id_fkey" TO "goal_sets_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "goals" RENAME CONSTRAINT "goals_goal_set_id_fkey" TO "goals_goal_set_id_goal_sets_id_fk";
--> statement-breakpoint
ALTER TABLE "notable_dates" RENAME CONSTRAINT "notable_dates_added_by_user_id_fkey" TO "notable_dates_added_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "notable_dates" RENAME CONSTRAINT "notable_dates_tribe_id_fkey" TO "notable_dates_tribe_id_tribes_id_fk";
--> statement-breakpoint
ALTER TABLE "osint_searches" RENAME CONSTRAINT "osint_searches_user_id_fkey" TO "osint_searches_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "reminder_subscribers" RENAME CONSTRAINT "reminder_subscribers_reminder_id_fkey" TO "reminder_subscribers_reminder_id_reminders_id_fk";
--> statement-breakpoint
ALTER TABLE "reminder_subscribers" RENAME CONSTRAINT "reminder_subscribers_subscriber_user_id_fkey" TO "reminder_subscribers_subscriber_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "reminders" RENAME CONSTRAINT "reminders_tribe_id_fkey" TO "reminders_tribe_id_tribes_id_fk";
--> statement-breakpoint
ALTER TABLE "reminders" RENAME CONSTRAINT "reminders_user_id_fkey" TO "reminders_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "support_reports" RENAME CONSTRAINT "support_reports_resolved_by_fkey" TO "support_reports_resolved_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "support_reports" RENAME CONSTRAINT "support_reports_user_id_fkey" TO "support_reports_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "task_items" RENAME CONSTRAINT "task_items_work_id_fkey" TO "task_items_work_id_task_works_id_fk";
--> statement-breakpoint
ALTER TABLE "task_reminders" RENAME CONSTRAINT "task_reminders_task_item_id_fkey" TO "task_reminders_task_item_id_task_items_id_fk";
--> statement-breakpoint
ALTER TABLE "task_works" RENAME CONSTRAINT "task_works_user_id_fkey" TO "task_works_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "telegram_mtproto_sessions" RENAME CONSTRAINT "telegram_mtproto_sessions_user_id_fkey" TO "telegram_mtproto_sessions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "thought_simplifications" RENAME CONSTRAINT "thought_simplifications_user_id_fkey" TO "thought_simplifications_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tribe_monthly_limits" RENAME CONSTRAINT "tribe_monthly_limits_tribe_id_fkey" TO "tribe_monthly_limits_tribe_id_tribes_id_fk";
--> statement-breakpoint
ALTER TABLE "users" RENAME CONSTRAINT "users_active_dialog_id_fkey" TO "users_active_dialog_id_chat_dialogs_id_fk";
--> statement-breakpoint
ALTER TABLE "users" RENAME CONSTRAINT "users_tribe_id_fkey" TO "users_tribe_id_tribes_id_fk";
--> statement-breakpoint
ALTER TABLE "voice_transcriptions" RENAME CONSTRAINT "voice_transcriptions_user_id_fkey" TO "voice_transcriptions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "wishlist_item_files" RENAME CONSTRAINT "wishlist_item_files_item_id_fkey" TO "wishlist_item_files_item_id_wishlist_items_id_fk";
--> statement-breakpoint
ALTER TABLE "wishlist_items" RENAME CONSTRAINT "wishlist_items_reserved_by_user_id_fkey" TO "wishlist_items_reserved_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "wishlist_items" RENAME CONSTRAINT "wishlist_items_wishlist_id_fkey" TO "wishlist_items_wishlist_id_wishlists_id_fk";
--> statement-breakpoint
ALTER TABLE "wishlists" RENAME CONSTRAINT "wishlists_tribe_id_fkey" TO "wishlists_tribe_id_tribes_id_fk";
--> statement-breakpoint
ALTER TABLE "wishlists" RENAME CONSTRAINT "wishlists_user_id_fkey" TO "wishlists_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "work_achievements" RENAME CONSTRAINT "work_achievements_workplace_id_fkey" TO "work_achievements_workplace_id_workplaces_id_fk";
--> statement-breakpoint
ALTER TABLE "workplaces" RENAME CONSTRAINT "workplaces_user_id_fkey" TO "workplaces_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "categories" RENAME CONSTRAINT "categories_name_key" TO "categories_name_unique";
--> statement-breakpoint
ALTER TABLE "telegram_mtproto_sessions" RENAME CONSTRAINT "telegram_mtproto_sessions_user_id_key" TO "telegram_mtproto_sessions_user_id_unique";
--> statement-breakpoint
ALTER TABLE "tribes" RENAME CONSTRAINT "tribes_name_key" TO "tribes_name_unique";
--> statement-breakpoint
ALTER TABLE "users" RENAME CONSTRAINT "users_telegram_id_key" TO "users_telegram_id_unique";
--> statement-breakpoint
ALTER TABLE "voice_transcriptions" RENAME CONSTRAINT "voice_transcriptions_telegram_file_unique_id_key" TO "voice_transcriptions_telegram_file_unique_id_unique";
--> statement-breakpoint
ALTER TABLE "goal_sets" ADD CONSTRAINT "goal_sets_user_name_key" UNIQUE USING INDEX "goal_sets_user_name_key";
--> statement-breakpoint
ALTER TABLE "goal_set_viewers" ADD CONSTRAINT "goal_set_viewers_unique" UNIQUE USING INDEX "goal_set_viewers_unique";
