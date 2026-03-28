CREATE TABLE "action_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"telegram_id" bigint,
	"action" varchar(100) NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blogger_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"channel_username" varchar(255),
	"channel_title" varchar(255) NOT NULL,
	"niche_description" text,
	"style_samples" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blogger_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"topic" varchar(500) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"generated_text" text,
	"model_used" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_at" timestamp with time zone,
	CONSTRAINT "blogger_posts_status_check" CHECK ("blogger_posts"."status" IN ('draft', 'collecting', 'generating', 'generated', 'published'))
);
--> statement-breakpoint
CREATE TABLE "blogger_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"title" varchar(500),
	"parsed_content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blogger_sources_type_check" CHECK ("blogger_sources"."source_type" IN ('text', 'voice', 'link', 'forward', 'web_search'))
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tribe_id" integer NOT NULL,
	"google_event_id" varchar(1024),
	"summary" text NOT NULL,
	"description" text,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"recurrence" text[],
	"input_method" varchar(10) NOT NULL,
	"status" varchar(10) DEFAULT 'created' NOT NULL,
	"error_message" text,
	"html_link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "calendar_events_input_method_check" CHECK ("calendar_events"."input_method" IN ('text', 'voice')),
	CONSTRAINT "calendar_events_status_check" CHECK ("calendar_events"."status" IN ('created', 'deleted', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"emoji" varchar(10) DEFAULT '' NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "chat_dialogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(200) DEFAULT 'Новый диалог' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"dialog_id" integer NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"model_used" varchar(100),
	"tokens_used" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_role_check" CHECK ("chat_messages"."role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "digest_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"rubric_id" integer NOT NULL,
	"channel_username" varchar(100) NOT NULL,
	"channel_title" varchar(255),
	"subscriber_count" integer,
	"is_active" boolean DEFAULT true,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_channels_rubric_id_channel_username_key" UNIQUE("rubric_id","channel_username")
);
--> statement-breakpoint
CREATE TABLE "digest_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"rubric_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"channel_username" varchar(100) NOT NULL,
	"channel_title" varchar(255),
	"telegram_message_id" bigint NOT NULL,
	"message_url" text,
	"original_text" text,
	"summary" text,
	"post_date" timestamp with time zone NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"forwards" integer DEFAULT 0 NOT NULL,
	"reactions_count" integer DEFAULT 0 NOT NULL,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"engagement_score" real DEFAULT 0 NOT NULL,
	"is_from_tracked_channel" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_posts_run_id_channel_username_telegram_message_id_key" UNIQUE("run_id","channel_username","telegram_message_id")
);
--> statement-breakpoint
CREATE TABLE "digest_rubrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"emoji" varchar(10),
	"keywords" text[] DEFAULT '{}',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_rubrics_user_id_name_key" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "digest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"rubric_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"channels_parsed" integer DEFAULT 0 NOT NULL,
	"posts_found" integer DEFAULT 0 NOT NULL,
	"posts_selected" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tribe_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"subcategory" varchar(500),
	"amount" numeric(12, 2) NOT NULL,
	"input_method" varchar(10) DEFAULT 'text' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "expenses_amount_check" CHECK ("expenses"."amount" > 0),
	CONSTRAINT "expenses_amount_range" CHECK ("expenses"."amount" >= 1 AND "expenses"."amount" <= 10000000),
	CONSTRAINT "expenses_input_method_check" CHECK ("expenses"."input_method" IN ('text', 'voice'))
);
--> statement-breakpoint
CREATE TABLE "gandalf_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"tribe_id" integer,
	"name" varchar(100) NOT NULL,
	"emoji" varchar(10) DEFAULT '📁',
	"created_by_user_id" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "gandalf_categories_tribe_id_name_key" UNIQUE("tribe_id","name")
);
--> statement-breakpoint
CREATE TABLE "gandalf_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"tribe_id" integer,
	"category_id" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"price" numeric(12, 2),
	"added_by_user_id" integer NOT NULL,
	"next_date" timestamp with time zone,
	"additional_info" text,
	"input_method" varchar(10) DEFAULT 'text',
	"is_important" boolean DEFAULT false,
	"is_urgent" boolean DEFAULT false,
	"visibility" varchar(10) DEFAULT 'tribe' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "gandalf_entries_price_check" CHECK ("gandalf_entries"."price" IS NULL OR "gandalf_entries"."price" >= 0),
	CONSTRAINT "gandalf_entries_input_method_check" CHECK ("gandalf_entries"."input_method" IN ('text', 'voice')),
	CONSTRAINT "gandalf_entries_visibility_check" CHECK ("gandalf_entries"."visibility" IN ('tribe', 'private'))
);
--> statement-breakpoint
CREATE TABLE "gandalf_entry_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"telegram_file_id" varchar(255) NOT NULL,
	"file_type" varchar(20) NOT NULL,
	"file_name" varchar(255),
	"mime_type" varchar(100),
	"file_size_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "goal_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_set_id" integer NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"sent" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_set_viewers" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_set_id" integer NOT NULL,
	"viewer_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_set_viewers_unique" UNIQUE("goal_set_id","viewer_user_id")
);
--> statement-breakpoint
CREATE TABLE "goal_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"emoji" varchar(10) DEFAULT '🎯',
	"period" varchar(20) DEFAULT 'current' NOT NULL,
	"visibility" varchar(10) DEFAULT 'private' NOT NULL,
	"deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_sets_user_name_key" UNIQUE("user_id","name"),
	CONSTRAINT "goal_sets_period_check" CHECK ("goal_sets"."period" IN ('current', 'month', 'year', '5years')),
	CONSTRAINT "goal_sets_visibility_check" CHECK ("goal_sets"."visibility" IN ('public', 'private'))
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_set_id" integer NOT NULL,
	"text" varchar(500) NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"input_method" varchar(10) DEFAULT 'text' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notable_dates" (
	"id" serial PRIMARY KEY NOT NULL,
	"tribe_id" integer NOT NULL,
	"added_by_user_id" integer,
	"name" varchar(255) NOT NULL,
	"date_month" smallint NOT NULL,
	"date_day" smallint NOT NULL,
	"event_type" varchar(50) DEFAULT 'birthday' NOT NULL,
	"description" text,
	"greeting_template" text,
	"emoji" varchar(10) DEFAULT '🎂',
	"is_priority" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "notable_dates_date_month_check" CHECK ("notable_dates"."date_month" BETWEEN 1 AND 12),
	CONSTRAINT "notable_dates_date_day_check" CHECK ("notable_dates"."date_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE "osint_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"query" text NOT NULL,
	"parsed_subject" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"search_queries" jsonb,
	"raw_results" jsonb,
	"report" text,
	"sources_count" integer DEFAULT 0 NOT NULL,
	"input_method" varchar(10) DEFAULT 'text' NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "osint_searches_status_check" CHECK ("osint_searches"."status" IN ('pending', 'searching', 'analyzing', 'completed', 'failed')),
	CONSTRAINT "osint_searches_input_method_check" CHECK ("osint_searches"."input_method" IN ('text', 'voice'))
);
--> statement-breakpoint
CREATE TABLE "reminder_subscribers" (
	"id" serial PRIMARY KEY NOT NULL,
	"reminder_id" integer NOT NULL,
	"subscriber_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_subscribers_unique" UNIQUE("reminder_id","subscriber_user_id")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tribe_id" integer,
	"text" varchar(500) NOT NULL,
	"schedule" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_fired_at" timestamp with time zone,
	"input_method" varchar(10) DEFAULT 'text' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_input_method_check" CHECK ("reminders"."input_method" IN ('text', 'voice'))
);
--> statement-breakpoint
CREATE TABLE "task_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_id" integer NOT NULL,
	"text" varchar(500) NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"input_method" varchar(10) DEFAULT 'text' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_items_input_method_check" CHECK ("task_items"."input_method" IN ('text', 'voice'))
);
--> statement-breakpoint
CREATE TABLE "task_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_item_id" integer NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"reminder_type" varchar(20) NOT NULL,
	"sent" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_reminders_type_check" CHECK ("task_reminders"."reminder_type" IN ('day_before', '4h_before', '1h_before'))
);
--> statement-breakpoint
CREATE TABLE "task_works" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"emoji" varchar(10) DEFAULT '📋' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_works_user_name_key" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "telegram_mtproto_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_string" text NOT NULL,
	"phone_hint" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_mtproto_sessions_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "thought_simplifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"input_type" varchar(10) DEFAULT 'text' NOT NULL,
	"original_text" text NOT NULL,
	"simplified_text" text,
	"model_used" varchar(100),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"simplified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tribes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"monthly_limit" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tribes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"username" varchar(255),
	"first_name" varchar(255) DEFAULT '' NOT NULL,
	"last_name" varchar(255),
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"status" varchar(20) DEFAULT 'approved' NOT NULL,
	"mode" varchar(20) DEFAULT 'calendar' NOT NULL,
	"tribe_id" integer,
	"active_dialog_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('admin', 'user'))
);
--> statement-breakpoint
CREATE TABLE "voice_transcriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"telegram_file_id" varchar(255) NOT NULL,
	"telegram_file_unique_id" varchar(255) NOT NULL,
	"duration_seconds" integer NOT NULL,
	"file_size_bytes" integer,
	"forwarded_from_name" varchar(255),
	"forwarded_date" timestamp with time zone,
	"transcript" text,
	"model_used" varchar(100),
	"audio_file_path" varchar(500),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"sequence_number" integer NOT NULL,
	"is_delivered" boolean DEFAULT false NOT NULL,
	"chat_id" bigint,
	"status_message_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transcribed_at" timestamp with time zone,
	CONSTRAINT "voice_transcriptions_telegram_file_unique_id_unique" UNIQUE("telegram_file_unique_id")
);
--> statement-breakpoint
CREATE TABLE "wishlist_item_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"telegram_file_id" varchar(255) NOT NULL,
	"file_type" varchar(20) NOT NULL,
	"file_name" varchar(255),
	"mime_type" varchar(100),
	"file_size_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"wishlist_id" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"link" text,
	"priority" integer DEFAULT 1 NOT NULL,
	"is_reserved" boolean DEFAULT false,
	"reserved_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"tribe_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"emoji" varchar(10) DEFAULT '🎁',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "work_achievements" (
	"id" serial PRIMARY KEY NOT NULL,
	"workplace_id" integer NOT NULL,
	"text" text NOT NULL,
	"input_method" varchar(10) DEFAULT 'text' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_achievements_input_method_check" CHECK ("work_achievements"."input_method" IN ('text', 'voice'))
);
--> statement-breakpoint
CREATE TABLE "workplaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"company" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_logs" ADD CONSTRAINT "action_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blogger_channels" ADD CONSTRAINT "blogger_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blogger_posts" ADD CONSTRAINT "blogger_posts_channel_id_blogger_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."blogger_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blogger_posts" ADD CONSTRAINT "blogger_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blogger_sources" ADD CONSTRAINT "blogger_sources_post_id_blogger_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blogger_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tribe_id_tribes_id_fk" FOREIGN KEY ("tribe_id") REFERENCES "public"."tribes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_dialogs" ADD CONSTRAINT "chat_dialogs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_dialog_id_chat_dialogs_id_fk" FOREIGN KEY ("dialog_id") REFERENCES "public"."chat_dialogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_channels" ADD CONSTRAINT "digest_channels_rubric_id_digest_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."digest_rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_posts" ADD CONSTRAINT "digest_posts_run_id_digest_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."digest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_posts" ADD CONSTRAINT "digest_posts_rubric_id_digest_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."digest_rubrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_posts" ADD CONSTRAINT "digest_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_rubrics" ADD CONSTRAINT "digest_rubrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_runs" ADD CONSTRAINT "digest_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_runs" ADD CONSTRAINT "digest_runs_rubric_id_digest_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."digest_rubrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tribe_id_tribes_id_fk" FOREIGN KEY ("tribe_id") REFERENCES "public"."tribes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gandalf_categories" ADD CONSTRAINT "gandalf_categories_tribe_id_tribes_id_fk" FOREIGN KEY ("tribe_id") REFERENCES "public"."tribes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gandalf_categories" ADD CONSTRAINT "gandalf_categories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gandalf_entries" ADD CONSTRAINT "gandalf_entries_tribe_id_tribes_id_fk" FOREIGN KEY ("tribe_id") REFERENCES "public"."tribes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gandalf_entries" ADD CONSTRAINT "gandalf_entries_category_id_gandalf_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."gandalf_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gandalf_entries" ADD CONSTRAINT "gandalf_entries_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gandalf_entry_files" ADD CONSTRAINT "gandalf_entry_files_entry_id_gandalf_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."gandalf_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_reminders" ADD CONSTRAINT "goal_reminders_goal_set_id_goal_sets_id_fk" FOREIGN KEY ("goal_set_id") REFERENCES "public"."goal_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_set_viewers" ADD CONSTRAINT "goal_set_viewers_goal_set_id_goal_sets_id_fk" FOREIGN KEY ("goal_set_id") REFERENCES "public"."goal_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_set_viewers" ADD CONSTRAINT "goal_set_viewers_viewer_user_id_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_sets" ADD CONSTRAINT "goal_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_goal_set_id_goal_sets_id_fk" FOREIGN KEY ("goal_set_id") REFERENCES "public"."goal_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notable_dates" ADD CONSTRAINT "notable_dates_tribe_id_tribes_id_fk" FOREIGN KEY ("tribe_id") REFERENCES "public"."tribes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notable_dates" ADD CONSTRAINT "notable_dates_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "osint_searches" ADD CONSTRAINT "osint_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_subscribers" ADD CONSTRAINT "reminder_subscribers_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_subscribers" ADD CONSTRAINT "reminder_subscribers_subscriber_user_id_users_id_fk" FOREIGN KEY ("subscriber_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_tribe_id_tribes_id_fk" FOREIGN KEY ("tribe_id") REFERENCES "public"."tribes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_items" ADD CONSTRAINT "task_items_work_id_task_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."task_works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_item_id_task_items_id_fk" FOREIGN KEY ("task_item_id") REFERENCES "public"."task_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_works" ADD CONSTRAINT "task_works_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_mtproto_sessions" ADD CONSTRAINT "telegram_mtproto_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thought_simplifications" ADD CONSTRAINT "thought_simplifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tribe_id_tribes_id_fk" FOREIGN KEY ("tribe_id") REFERENCES "public"."tribes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_transcriptions" ADD CONSTRAINT "voice_transcriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_item_files" ADD CONSTRAINT "wishlist_item_files_item_id_wishlist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."wishlist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_reserved_by_user_id_users_id_fk" FOREIGN KEY ("reserved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_tribe_id_tribes_id_fk" FOREIGN KEY ("tribe_id") REFERENCES "public"."tribes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_achievements" ADD CONSTRAINT "work_achievements_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workplaces" ADD CONSTRAINT "workplaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_action_logs_user" ON "action_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_action_logs_action" ON "action_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_action_logs_created" ON "action_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_blogger_channels_user" ON "blogger_channels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_blogger_posts_channel" ON "blogger_posts" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_blogger_posts_user" ON "blogger_posts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_blogger_sources_post" ON "blogger_sources" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_user_created" ON "calendar_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_tribe_created" ON "calendar_events" USING btree ("tribe_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_google_id" ON "calendar_events" USING btree ("google_event_id") WHERE google_event_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_calendar_events_status" ON "calendar_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_chat_dialogs_user_id" ON "chat_dialogs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_user_id" ON "chat_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_dialog_id" ON "chat_messages" USING btree ("dialog_id");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_created_at" ON "chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_digest_channels_rubric" ON "digest_channels" USING btree ("rubric_id");--> statement-breakpoint
CREATE INDEX "idx_digest_posts_rubric_date" ON "digest_posts" USING btree ("rubric_id","post_date");--> statement-breakpoint
CREATE INDEX "idx_digest_posts_user_date" ON "digest_posts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_digest_rubrics_user" ON "digest_rubrics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_digest_runs_user" ON "digest_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_expenses_tribe_created" ON "expenses" USING btree ("tribe_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_expenses_category" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_expenses_user_created" ON "expenses" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gandalf_categories_tribe" ON "gandalf_categories" USING btree ("tribe_id");--> statement-breakpoint
CREATE INDEX "idx_gandalf_entries_tribe_created" ON "gandalf_entries" USING btree ("tribe_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gandalf_entries_category" ON "gandalf_entries" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_gandalf_entries_user_created" ON "gandalf_entries" USING btree ("added_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gandalf_entries_important" ON "gandalf_entries" USING btree ("is_important") WHERE is_important = true;--> statement-breakpoint
CREATE INDEX "idx_gandalf_entries_urgent" ON "gandalf_entries" USING btree ("is_urgent") WHERE is_urgent = true;--> statement-breakpoint
CREATE INDEX "idx_gandalf_entries_visibility" ON "gandalf_entries" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "idx_gandalf_entry_files_entry" ON "gandalf_entry_files" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "idx_goal_reminders_pending" ON "goal_reminders" USING btree ("remind_at") WHERE sent = false;--> statement-breakpoint
CREATE INDEX "idx_goal_sets_user" ON "goal_sets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_goals_goal_set" ON "goals" USING btree ("goal_set_id");--> statement-breakpoint
CREATE INDEX "idx_notable_dates_tribe" ON "notable_dates" USING btree ("tribe_id");--> statement-breakpoint
CREATE INDEX "idx_notable_dates_month_day" ON "notable_dates" USING btree ("date_month","date_day");--> statement-breakpoint
CREATE INDEX "idx_osint_searches_user_created" ON "osint_searches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_osint_searches_status" ON "osint_searches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_reminder_subscribers_reminder" ON "reminder_subscribers" USING btree ("reminder_id");--> statement-breakpoint
CREATE INDEX "idx_reminders_user" ON "reminders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_reminders_active" ON "reminders" USING btree ("is_active") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_task_items_work" ON "task_items" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "idx_task_items_deadline_active" ON "task_items" USING btree ("deadline") WHERE is_completed = false;--> statement-breakpoint
CREATE INDEX "idx_task_reminders_pending" ON "task_reminders" USING btree ("remind_at") WHERE sent = false;--> statement-breakpoint
CREATE INDEX "idx_task_works_user" ON "task_works" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_mtproto_sessions_user" ON "telegram_mtproto_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_thought_simplifications_user_created" ON "thought_simplifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_telegram_id" ON "users" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "idx_voice_transcriptions_user_id" ON "voice_transcriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_voice_transcriptions_status" ON "voice_transcriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_voice_transcriptions_created_at" ON "voice_transcriptions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_vt_delivery" ON "voice_transcriptions" USING btree ("user_id","sequence_number") WHERE is_delivered = false;--> statement-breakpoint
CREATE INDEX "idx_wishlist_item_files_item" ON "wishlist_item_files" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "idx_wishlist_items_wishlist" ON "wishlist_items" USING btree ("wishlist_id");--> statement-breakpoint
CREATE INDEX "idx_wishlists_tribe" ON "wishlists" USING btree ("tribe_id");--> statement-breakpoint
CREATE INDEX "idx_wishlists_user" ON "wishlists" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlists_user_id_name_key" ON "wishlists" USING btree ("user_id","name") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_work_achievements_workplace" ON "work_achievements" USING btree ("workplace_id");--> statement-breakpoint
CREATE INDEX "idx_workplaces_user" ON "workplaces" USING btree ("user_id");