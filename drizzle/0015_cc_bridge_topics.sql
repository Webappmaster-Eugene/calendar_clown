CREATE TABLE "cc_topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_key" varchar(255) NOT NULL,
	"machine" varchar(64) NOT NULL,
	"project" varchar(255) NOT NULL,
	"thread_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cc_topics_key" ON "cc_topics" USING btree ("topic_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cc_topics_thread" ON "cc_topics" USING btree ("thread_id");