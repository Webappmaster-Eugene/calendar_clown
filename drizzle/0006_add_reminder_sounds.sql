-- Reminder sounds: predefined audio files for reminder notifications
CREATE TABLE "reminder_sounds" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(100) NOT NULL,
  "emoji" varchar(10) NOT NULL DEFAULT '🔔',
  "filename" varchar(255) NOT NULL,
  "duration_seconds" smallint,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_reminder_sounds_name" ON "reminder_sounds" USING btree ("name");
--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "sound_id" integer;
--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "sound_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_sound_id_reminder_sounds_id_fk"
  FOREIGN KEY ("sound_id") REFERENCES "public"."reminder_sounds"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
-- Seed predefined sounds
INSERT INTO "reminder_sounds" ("name", "emoji", "filename", "sort_order") VALUES
  ('Мягкий звон', '🔔', 'gentle-bell.mp3', 1),
  ('Утренняя мелодия', '🌅', 'morning-melody.mp3', 2),
  ('Классический будильник', '⏰', 'alarm-classic.mp3', 3),
  ('Тихое пианино', '🎹', 'piano-soft.mp3', 4),
  ('Яркое уведомление', '🎵', 'notification-bright.mp3', 5);
