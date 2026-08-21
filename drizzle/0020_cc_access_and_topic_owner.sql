CREATE TABLE "cc_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"group_id" bigint,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"max_machines" smallint DEFAULT 5 NOT NULL,
	"max_sessions" smallint DEFAULT 10 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "cc_access_status_check" CHECK ("cc_access"."status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "cc_collaborators" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"telegram_id" bigint NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cc_machine_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"label" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "idx_cc_topics_key";--> statement-breakpoint
ALTER TABLE "cc_topics" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "cc_access" ADD CONSTRAINT "cc_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cc_access" ADD CONSTRAINT "cc_access_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cc_collaborators" ADD CONSTRAINT "cc_collaborators_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cc_machine_tokens" ADD CONSTRAINT "cc_machine_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cc_access_user" ON "cc_access" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cc_access_group" ON "cc_access" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cc_collaborators_unique" ON "cc_collaborators" USING btree ("owner_user_id","telegram_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cc_machine_tokens_hash" ON "cc_machine_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_cc_machine_tokens_user" ON "cc_machine_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "cc_topics" ADD CONSTRAINT "cc_topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cc_topics_key" ON "cc_topics" USING btree ("user_id","topic_key");