-- Nutritionist: food photo analysis
CREATE TABLE "nutrition_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"telegram_file_id" varchar(255),
	"caption" text,
	"nutrition_data" jsonb,
	"summary_text" text,
	"model_used" varchar(100),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analyzed_at" timestamp with time zone,
	CONSTRAINT "nutrition_analyses_status_check" CHECK ("nutrition_analyses"."status" IN ('pending', 'processing', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "nutrition_analyses" ADD CONSTRAINT "nutrition_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_nutrition_analyses_user_created" ON "nutrition_analyses" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "idx_nutrition_analyses_status" ON "nutrition_analyses" USING btree ("status");
