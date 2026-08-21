CREATE TABLE "access_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"username" varchar(255),
	"first_name" varchar(255) DEFAULT '' NOT NULL,
	"last_name" varchar(255),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"decided_by" bigint,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_requests_status_check" CHECK ("access_requests"."status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX "idx_access_requests_status" ON "access_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_access_requests_telegram_id" ON "access_requests" USING btree ("telegram_id");