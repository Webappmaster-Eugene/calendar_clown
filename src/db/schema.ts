import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  smallint,
  boolean,
  numeric,
  real,
  bigint,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Tribes ──────────────────────────────────────────────────────────────────

export const tribes = pgTable("tribes", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  monthlyLimit: numeric("monthly_limit", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "bigint" }).notNull().unique(),
    username: varchar("username", { length: 255 }),
    firstName: varchar("first_name", { length: 255 }).notNull().default(""),
    lastName: varchar("last_name", { length: 255 }),
    role: varchar("role", { length: 20 }).notNull().default("user"),
    status: varchar("status", { length: 20 }).notNull().default("approved"),
    mode: varchar("mode", { length: 20 }).notNull().default("calendar"),
    tribeId: integer("tribe_id")
      .references(() => tribes.id),
    activeDialogId: integer("active_dialog_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_users_telegram_id").on(table.telegramId),
    check("users_role_check", sql`${table.role} IN ('admin', 'user')`),
  ],
);

// ─── Categories ──────────────────────────────────────────────────────────────

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  emoji: varchar("emoji", { length: 10 }).notNull().default(""),
  aliases: text("aliases").array().notNull().default(sql`'{}'`),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

// ─── Expenses ────────────────────────────────────────────────────────────────

export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    tribeId: integer("tribe_id")
      .notNull()
      .references(() => tribes.id),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    subcategory: varchar("subcategory", { length: 500 }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    inputMethod: varchar("input_method", { length: 10 }).notNull().default("text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_expenses_tribe_created").on(table.tribeId, table.createdAt),
    index("idx_expenses_category").on(table.categoryId),
    index("idx_expenses_user_created").on(table.userId, table.createdAt),
    check("expenses_amount_check", sql`${table.amount} > 0`),
    check("expenses_amount_range", sql`${table.amount} >= 1 AND ${table.amount} <= 10000000`),
    check(
      "expenses_input_method_check",
      sql`${table.inputMethod} IN ('text', 'voice')`,
    ),
  ],
);

// ─── Calendar Events ─────────────────────────────────────────────────────────

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    tribeId: integer("tribe_id")
      .notNull()
      .references(() => tribes.id),
    googleEventId: varchar("google_event_id", { length: 1024 }),
    summary: text("summary").notNull(),
    description: text("description"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    recurrence: text("recurrence").array(),
    inputMethod: varchar("input_method", { length: 10 }).notNull(),
    status: varchar("status", { length: 10 }).notNull().default("created"),
    errorMessage: text("error_message"),
    htmlLink: text("html_link"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_calendar_events_user_created").on(table.userId, table.createdAt),
    index("idx_calendar_events_tribe_created").on(table.tribeId, table.createdAt),
    index("idx_calendar_events_google_id")
      .on(table.googleEventId)
      .where(sql`google_event_id IS NOT NULL`),
    index("idx_calendar_events_status").on(table.status),
    check(
      "calendar_events_input_method_check",
      sql`${table.inputMethod} IN ('text', 'voice')`,
    ),
    check(
      "calendar_events_status_check",
      sql`${table.status} IN ('created', 'deleted', 'failed')`,
    ),
  ],
);

// ─── Voice Transcriptions ────────────────────────────────────────────────────

export const voiceTranscriptions = pgTable(
  "voice_transcriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    telegramFileId: varchar("telegram_file_id", { length: 255 }).notNull(),
    telegramFileUniqueId: varchar("telegram_file_unique_id", { length: 255 })
      .notNull()
      .unique(),
    durationSeconds: integer("duration_seconds").notNull(),
    fileSizeBytes: integer("file_size_bytes"),
    forwardedFromName: varchar("forwarded_from_name", { length: 255 }),
    forwardedDate: timestamp("forwarded_date", { withTimezone: true }),
    transcript: text("transcript"),
    modelUsed: varchar("model_used", { length: 100 }),
    audioFilePath: varchar("audio_file_path", { length: 500 }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    errorMessage: text("error_message"),
    sequenceNumber: integer("sequence_number").notNull(),
    isDelivered: boolean("is_delivered").notNull().default(false),
    chatId: bigint("chat_id", { mode: "number" }),
    statusMessageId: integer("status_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    transcribedAt: timestamp("transcribed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_voice_transcriptions_user_id").on(table.userId),
    index("idx_voice_transcriptions_status").on(table.status),
    index("idx_voice_transcriptions_created_at").on(table.createdAt),
    index("idx_vt_delivery").on(table.userId, table.sequenceNumber).where(sql`is_delivered = false`),
  ],
);

// ─── Thought Simplifications ─────────────────────────────────────────────────

export const thoughtSimplifications = pgTable(
  "thought_simplifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    inputType: varchar("input_type", { length: 10 }).notNull().default("text"),
    originalText: text("original_text").notNull(),
    simplifiedText: text("simplified_text"),
    modelUsed: varchar("model_used", { length: 100 }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    simplifiedAt: timestamp("simplified_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_thought_simplifications_user_created").on(table.userId, table.createdAt),
  ],
);

// ─── Digest Rubrics ──────────────────────────────────────────────────────────

export const digestRubrics = pgTable(
  "digest_rubrics",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    emoji: varchar("emoji", { length: 10 }),
    keywords: text("keywords").array().default(sql`'{}'`),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_digest_rubrics_user").on(table.userId),
    unique("digest_rubrics_user_id_name_key").on(table.userId, table.name),
  ],
);

// ─── Digest Channels ─────────────────────────────────────────────────────────

export const digestChannels = pgTable(
  "digest_channels",
  {
    id: serial("id").primaryKey(),
    rubricId: integer("rubric_id")
      .notNull()
      .references(() => digestRubrics.id, { onDelete: "cascade" }),
    channelUsername: varchar("channel_username", { length: 100 }).notNull(),
    channelTitle: varchar("channel_title", { length: 255 }),
    subscriberCount: integer("subscriber_count"),
    isActive: boolean("is_active").default(true),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_digest_channels_rubric").on(table.rubricId),
    unique("digest_channels_rubric_id_channel_username_key").on(
      table.rubricId,
      table.channelUsername,
    ),
  ],
);

// ─── Digest Runs ─────────────────────────────────────────────────────────────

export const digestRuns = pgTable(
  "digest_runs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    rubricId: integer("rubric_id")
      .notNull()
      .references(() => digestRubrics.id),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    channelsParsed: integer("channels_parsed").notNull().default(0),
    postsFound: integer("posts_found").notNull().default(0),
    postsSelected: integer("posts_selected").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_digest_runs_user").on(table.userId, table.createdAt),
  ],
);

// ─── Digest Posts ────────────────────────────────────────────────────────────

export const digestPosts = pgTable(
  "digest_posts",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => digestRuns.id),
    rubricId: integer("rubric_id")
      .notNull()
      .references(() => digestRubrics.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    channelUsername: varchar("channel_username", { length: 100 }).notNull(),
    channelTitle: varchar("channel_title", { length: 255 }),
    telegramMessageId: bigint("telegram_message_id", { mode: "bigint" }).notNull(),
    messageUrl: text("message_url"),
    originalText: text("original_text"),
    summary: text("summary"),
    postDate: timestamp("post_date", { withTimezone: true }).notNull(),
    views: integer("views").notNull().default(0),
    forwards: integer("forwards").notNull().default(0),
    reactionsCount: integer("reactions_count").notNull().default(0),
    commentsCount: integer("comments_count").notNull().default(0),
    engagementScore: real("engagement_score").notNull().default(0),
    isFromTrackedChannel: boolean("is_from_tracked_channel").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_digest_posts_rubric_date").on(table.rubricId, table.postDate),
    index("idx_digest_posts_user_date").on(table.userId, table.createdAt),
    unique("digest_posts_run_id_channel_username_telegram_message_id_key").on(
      table.runId,
      table.channelUsername,
      table.telegramMessageId,
    ),
  ],
);

// ─── Telegram MTProto Sessions ───────────────────────────────────────────

export const telegramMtprotoSessions = pgTable(
  "telegram_mtproto_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id)
      .unique(),
    sessionString: text("session_string").notNull(),
    phoneHint: varchar("phone_hint", { length: 20 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_mtproto_sessions_user").on(table.userId),
  ],
);

// ─── Notable Dates ───────────────────────────────────────────────────────────

export const notableDates = pgTable(
  "notable_dates",
  {
    id: serial("id").primaryKey(),
    tribeId: integer("tribe_id")
      .notNull()
      .references(() => tribes.id),
    addedByUserId: integer("added_by_user_id").references(() => users.id),
    name: varchar("name", { length: 255 }).notNull(),
    dateMonth: smallint("date_month").notNull(),
    dateDay: smallint("date_day").notNull(),
    eventType: varchar("event_type", { length: 50 }).notNull().default("birthday"),
    description: text("description"),
    greetingTemplate: text("greeting_template"),
    emoji: varchar("emoji", { length: 10 }).default("🎂"),
    isPriority: boolean("is_priority").default(false),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_notable_dates_tribe").on(table.tribeId),
    index("idx_notable_dates_month_day").on(table.dateMonth, table.dateDay),
    check("notable_dates_date_month_check", sql`${table.dateMonth} BETWEEN 1 AND 12`),
    check("notable_dates_date_day_check", sql`${table.dateDay} BETWEEN 1 AND 31`),
  ],
);

// ─── Action Logs ──────────────────────────────────────────────────────────────

export const actionLogs = pgTable(
  "action_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id),
    telegramId: bigint("telegram_id", { mode: "bigint" }),
    action: varchar("action", { length: 100 }).notNull(),
    details: text("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_action_logs_user").on(table.userId),
    index("idx_action_logs_action").on(table.action),
    index("idx_action_logs_created").on(table.createdAt),
  ],
);


// ─── Gandalf Categories ─────────────────────────────────────────────────────

export const gandalfCategories = pgTable(
  "gandalf_categories",
  {
    id: serial("id").primaryKey(),
    tribeId: integer("tribe_id")
      .references(() => tribes.id),
    name: varchar("name", { length: 100 }).notNull(),
    emoji: varchar("emoji", { length: 10 }).default("📁"),
    createdByUserId: integer("created_by_user_id").references(() => users.id),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_gandalf_categories_tribe").on(table.tribeId),
    unique("gandalf_categories_tribe_id_name_key").on(table.tribeId, table.name),
  ],
);

// ─── Gandalf Entries ────────────────────────────────────────────────────────

export const gandalfEntries = pgTable(
  "gandalf_entries",
  {
    id: serial("id").primaryKey(),
    tribeId: integer("tribe_id")
      .references(() => tribes.id),
    categoryId: integer("category_id")
      .notNull()
      .references(() => gandalfCategories.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    price: numeric("price", { precision: 12, scale: 2 }),
    addedByUserId: integer("added_by_user_id")
      .notNull()
      .references(() => users.id),
    nextDate: timestamp("next_date", { withTimezone: true }),
    additionalInfo: text("additional_info"),
    inputMethod: varchar("input_method", { length: 10 }).default("text"),
    isImportant: boolean("is_important").default(false),
    isUrgent: boolean("is_urgent").default(false),
    visibility: varchar("visibility", { length: 10 }).notNull().default("tribe"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_gandalf_entries_tribe_created").on(table.tribeId, table.createdAt),
    index("idx_gandalf_entries_category").on(table.categoryId),
    index("idx_gandalf_entries_user_created").on(table.addedByUserId, table.createdAt),
    index("idx_gandalf_entries_important").on(table.isImportant).where(sql`is_important = true`),
    index("idx_gandalf_entries_urgent").on(table.isUrgent).where(sql`is_urgent = true`),
    index("idx_gandalf_entries_visibility").on(table.visibility),
    check("gandalf_entries_price_check", sql`${table.price} IS NULL OR ${table.price} >= 0`),
    check(
      "gandalf_entries_input_method_check",
      sql`${table.inputMethod} IN ('text', 'voice')`,
    ),
    check(
      "gandalf_entries_visibility_check",
      sql`${table.visibility} IN ('tribe', 'private')`,
    ),
  ],
);

// ─── Chat Dialogs ───────────────────────────────────────────────────────────

export const chatDialogs = pgTable(
  "chat_dialogs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull().default("Новый диалог"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_chat_dialogs_user_id").on(table.userId),
  ],
);

// ─── Chat Messages ──────────────────────────────────────────────────────────

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dialogId: integer("dialog_id")
      .notNull()
      .references(() => chatDialogs.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    modelUsed: varchar("model_used", { length: 100 }),
    tokensUsed: integer("tokens_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_chat_messages_user_id").on(table.userId),
    index("idx_chat_messages_dialog_id").on(table.dialogId),
    index("idx_chat_messages_created_at").on(table.createdAt),
    check("chat_messages_role_check", sql`${table.role} IN ('user', 'assistant')`),
  ],
);

// ─── Gandalf Entry Files ────────────────────────────────────────────────────

export const gandalfEntryFiles = pgTable(
  "gandalf_entry_files",
  {
    id: serial("id").primaryKey(),
    entryId: integer("entry_id")
      .notNull()
      .references(() => gandalfEntries.id, { onDelete: "cascade" }),
    telegramFileId: varchar("telegram_file_id", { length: 255 }).notNull(),
    fileType: varchar("file_type", { length: 20 }).notNull(),
    fileName: varchar("file_name", { length: 255 }),
    mimeType: varchar("mime_type", { length: 100 }),
    fileSizeBytes: integer("file_size_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_gandalf_entry_files_entry").on(table.entryId),
  ],
);

// ─── Goal Sets ──────────────────────────────────────────────────────────

export const goalSets = pgTable(
  "goal_sets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    name: varchar("name", { length: 100 }).notNull(),
    emoji: varchar("emoji", { length: 10 }).default("🎯"),
    period: varchar("period", { length: 20 }).notNull().default("current"),
    visibility: varchar("visibility", { length: 10 }).notNull().default("private"),
    deadline: timestamp("deadline", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_goal_sets_user").on(table.userId),
    unique("goal_sets_user_name_key").on(table.userId, table.name),
    check("goal_sets_period_check", sql`${table.period} IN ('current', 'month', 'year', '5years')`),
    check("goal_sets_visibility_check", sql`${table.visibility} IN ('public', 'private')`),
  ],
);

// ─── Goals ──────────────────────────────────────────────────────────────

export const goals = pgTable(
  "goals",
  {
    id: serial("id").primaryKey(),
    goalSetId: integer("goal_set_id")
      .notNull()
      .references(() => goalSets.id, { onDelete: "cascade" }),
    text: varchar("text", { length: 500 }).notNull(),
    isCompleted: boolean("is_completed").notNull().default(false),
    inputMethod: varchar("input_method", { length: 10 }).notNull().default("text"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_goals_goal_set").on(table.goalSetId),
  ],
);

// ─── Goal Set Viewers ───────────────────────────────────────────────────

export const goalSetViewers = pgTable(
  "goal_set_viewers",
  {
    id: serial("id").primaryKey(),
    goalSetId: integer("goal_set_id")
      .notNull()
      .references(() => goalSets.id, { onDelete: "cascade" }),
    viewerUserId: integer("viewer_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("goal_set_viewers_unique").on(table.goalSetId, table.viewerUserId),
  ],
);

// ─── Goal Reminders ─────────────────────────────────────────────────────

export const goalReminders = pgTable(
  "goal_reminders",
  {
    id: serial("id").primaryKey(),
    goalSetId: integer("goal_set_id")
      .notNull()
      .references(() => goalSets.id, { onDelete: "cascade" }),
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    sent: boolean("sent").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_goal_reminders_pending").on(table.remindAt).where(sql`sent = false`),
  ],
);

// ─── Wishlists ──────────────────────────────────────────────────────────

export const wishlists = pgTable(
  "wishlists",
  {
    id: serial("id").primaryKey(),
    tribeId: integer("tribe_id")
      .notNull()
      .references(() => tribes.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    name: varchar("name", { length: 100 }).notNull(),
    emoji: varchar("emoji", { length: 10 }).default("🎁"),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_wishlists_tribe").on(table.tribeId),
    index("idx_wishlists_user").on(table.userId),
    uniqueIndex("wishlists_user_id_name_key")
      .on(table.userId, table.name)
      .where(sql`is_active = true`),
  ],
);

// ─── Wishlist Items ─────────────────────────────────────────────────────

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id: serial("id").primaryKey(),
    wishlistId: integer("wishlist_id")
      .notNull()
      .references(() => wishlists.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    link: text("link"),
    priority: integer("priority").notNull().default(1),
    isReserved: boolean("is_reserved").default(false),
    reservedByUserId: integer("reserved_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_wishlist_items_wishlist").on(table.wishlistId),
  ],
);

// ─── Wishlist Item Files ────────────────────────────────────────────────

export const wishlistItemFiles = pgTable(
  "wishlist_item_files",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => wishlistItems.id, { onDelete: "cascade" }),
    telegramFileId: varchar("telegram_file_id", { length: 255 }).notNull(),
    fileType: varchar("file_type", { length: 20 }).notNull(),
    fileName: varchar("file_name", { length: 255 }),
    mimeType: varchar("mime_type", { length: 100 }),
    fileSizeBytes: integer("file_size_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_wishlist_item_files_item").on(table.itemId),
  ],
);

// ─── Reminders ──────────────────────────────────────────────────────────

export const reminders = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    tribeId: integer("tribe_id")
      .references(() => tribes.id),
    text: varchar("text", { length: 500 }).notNull(),
    schedule: jsonb("schedule").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    inputMethod: varchar("input_method", { length: 10 }).notNull().default("text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_reminders_user").on(table.userId),
    index("idx_reminders_active").on(table.isActive).where(sql`is_active = true`),
    check(
      "reminders_input_method_check",
      sql`${table.inputMethod} IN ('text', 'voice')`,
    ),
  ],
);

// ─── OSINT Searches ─────────────────────────────────────────────────────

export const osintSearches = pgTable(
  "osint_searches",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    query: text("query").notNull(),
    parsedSubject: jsonb("parsed_subject"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    searchQueries: jsonb("search_queries"),
    rawResults: jsonb("raw_results"),
    report: text("report"),
    sourcesCount: integer("sources_count").notNull().default(0),
    inputMethod: varchar("input_method", { length: 10 }).notNull().default("text"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_osint_searches_user_created").on(table.userId, table.createdAt),
    index("idx_osint_searches_status").on(table.status),
    check(
      "osint_searches_status_check",
      sql`${table.status} IN ('pending', 'searching', 'analyzing', 'completed', 'failed')`,
    ),
    check(
      "osint_searches_input_method_check",
      sql`${table.inputMethod} IN ('text', 'voice')`,
    ),
  ],
);

// ─── Reminder Subscribers ───────────────────────────────────────────────

// ─── Workplaces (Summarizer) ─────────────────────────────────────────────

export const workplaces = pgTable(
  "workplaces",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    title: varchar("title", { length: 255 }).notNull(),
    company: varchar("company", { length: 255 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_workplaces_user").on(table.userId),
  ],
);

// ─── Work Achievements (Summarizer) ─────────────────────────────────────

export const workAchievements = pgTable(
  "work_achievements",
  {
    id: serial("id").primaryKey(),
    workplaceId: integer("workplace_id")
      .notNull()
      .references(() => workplaces.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    inputMethod: varchar("input_method", { length: 10 }).notNull().default("text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_work_achievements_workplace").on(table.workplaceId),
    check(
      "work_achievements_input_method_check",
      sql`${table.inputMethod} IN ('text', 'voice')`,
    ),
  ],
);

// ─── Blogger Channels ───────────────────────────────────────────────────

export const bloggerChannels = pgTable(
  "blogger_channels",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    channelUsername: varchar("channel_username", { length: 255 }),
    channelTitle: varchar("channel_title", { length: 255 }).notNull(),
    nicheDescription: text("niche_description"),
    styleSamples: text("style_samples"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_blogger_channels_user").on(table.userId),
  ],
);

// ─── Blogger Posts ──────────────────────────────────────────────────────

export const bloggerPosts = pgTable(
  "blogger_posts",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id")
      .notNull()
      .references(() => bloggerChannels.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    topic: varchar("topic", { length: 500 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    generatedText: text("generated_text"),
    modelUsed: varchar("model_used", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_blogger_posts_channel").on(table.channelId),
    index("idx_blogger_posts_user").on(table.userId, table.createdAt),
    check(
      "blogger_posts_status_check",
      sql`${table.status} IN ('draft', 'collecting', 'generating', 'generated', 'published')`,
    ),
  ],
);

// ─── Blogger Sources ────────────────────────────────────────────────────

export const bloggerSources = pgTable(
  "blogger_sources",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id")
      .notNull()
      .references(() => bloggerPosts.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", { length: 20 }).notNull(),
    content: text("content").notNull(),
    title: varchar("title", { length: 500 }),
    parsedContent: text("parsed_content"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_blogger_sources_post").on(table.postId),
    check(
      "blogger_sources_type_check",
      sql`${table.sourceType} IN ('text', 'voice', 'link', 'forward', 'web_search')`,
    ),
  ],
);

export const reminderSubscribers = pgTable(
  "reminder_subscribers",
  {
    id: serial("id").primaryKey(),
    reminderId: integer("reminder_id")
      .notNull()
      .references(() => reminders.id, { onDelete: "cascade" }),
    subscriberUserId: integer("subscriber_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_reminder_subscribers_reminder").on(table.reminderId),
    unique("reminder_subscribers_unique").on(table.reminderId, table.subscriberUserId),
  ],
);
