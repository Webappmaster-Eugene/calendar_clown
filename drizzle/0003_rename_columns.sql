ALTER TABLE "gandalf_entries" RENAME COLUMN "added_by_user_id" TO "created_by_user_id";--> statement-breakpoint
ALTER TABLE "notable_dates" RENAME COLUMN "added_by_user_id" TO "created_by_user_id";--> statement-breakpoint
ALTER TABLE "nutrition_products" RENAME COLUMN "calories_per_100" TO "calories_per_100_g";--> statement-breakpoint
ALTER TABLE "thought_simplifications" RENAME COLUMN "input_type" TO "input_method";--> statement-breakpoint
ALTER TABLE "nutrition_products" DROP CONSTRAINT "nutrition_products_calories_range";--> statement-breakpoint
ALTER TABLE "thought_simplifications" DROP CONSTRAINT "thought_simplifications_input_type_check";--> statement-breakpoint
ALTER TABLE "gandalf_entries" DROP CONSTRAINT "gandalf_entries_added_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "notable_dates" DROP CONSTRAINT "notable_dates_added_by_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "idx_gandalf_entries_user_created";--> statement-breakpoint
ALTER TABLE "gandalf_entries" ADD CONSTRAINT "gandalf_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notable_dates" ADD CONSTRAINT "notable_dates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gandalf_entries_user_created" ON "gandalf_entries" USING btree ("created_by_user_id","created_at");--> statement-breakpoint
ALTER TABLE "nutrition_products" ADD CONSTRAINT "nutrition_products_calories_range" CHECK ("nutrition_products"."calories_per_100_g" >= 0 AND "nutrition_products"."calories_per_100_g" <= 900);--> statement-breakpoint
ALTER TABLE "thought_simplifications" ADD CONSTRAINT "thought_simplifications_input_method_check" CHECK ("thought_simplifications"."input_method" IN ('text', 'voice', 'mixed'));