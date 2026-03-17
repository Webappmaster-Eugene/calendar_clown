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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    transcribedAt: timestamp("transcribed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_voice_transcriptions_user_id").on(table.userId),
    index("idx_voice_transcriptions_status").on(table.status),
    index("idx_voice_transcriptions_created_at").on(table.createdAt),
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

// ─── Note Topics ──────────────────────────────────────────────────────────────

export const noteTopics = pgTable(
  "note_topics",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    name: varchar("name", { length: 100 }).notNull(),
    emoji: varchar("emoji", { length: 10 }).default("📁"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_note_topics_user").on(table.userId),
    unique("note_topics_user_id_name_key").on(table.userId, table.name),
  ],
);

// ─── Notes ────────────────────────────────────────────────────────────────────

export const notes = pgTable(
  "notes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    topicId: integer("topic_id").references(() => noteTopics.id, { onDelete: "set null" }),
    content: text("content").notNull(),
    isImportant: boolean("is_important").default(false),
    isUrgent: boolean("is_urgent").default(false),
    hasImage: boolean("has_image").default(false),
    imageFilePath: varchar("image_file_path", { length: 500 }),
    inputMethod: varchar("input_method", { length: 10 }).notNull().default("text"),
    visibility: varchar("visibility", { length: 10 }).notNull().default("private"),
    tribeId: integer("tribe_id").references(() => tribes.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_notes_user").on(table.userId),
    index("idx_notes_topic").on(table.topicId),
    index("idx_notes_flags").on(table.isImportant, table.isUrgent),
    index("idx_notes_created").on(table.createdAt),
    index("idx_notes_visibility").on(table.visibility),
    index("idx_notes_tribe_visibility").on(table.tribeId, table.visibility),
    check("notes_visibility_check", sql`${table.visibility} IN ('public', 'private')`),
  ],
);

// ─── Gandalf Categories ─────────────────────────────────────────────────────

export const gandalfCategories = pgTable(
  "gandalf_categories",
  {
    id: serial("id").primaryKey(),
    tribeId: integer("tribe_id")
      .notNull()
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
      .notNull()
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_gandalf_entries_tribe_created").on(table.tribeId, table.createdAt),
    index("idx_gandalf_entries_category").on(table.categoryId),
    index("idx_gandalf_entries_user_created").on(table.addedByUserId, table.createdAt),
    check("gandalf_entries_price_check", sql`${table.price} IS NULL OR ${table.price} >= 0`),
    check(
      "gandalf_entries_input_method_check",
      sql`${table.inputMethod} IN ('text', 'voice')`,
    ),
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
