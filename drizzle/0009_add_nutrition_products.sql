-- Nutritionist: user product catalog (per-100g/per-100ml nutritional reference data)
CREATE TABLE "nutrition_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"unit" varchar(4) DEFAULT 'g' NOT NULL,
	"calories_per_100" numeric(8, 2) NOT NULL,
	"proteins_per_100_g" numeric(8, 2) NOT NULL,
	"fats_per_100_g" numeric(8, 2) NOT NULL,
	"carbs_per_100_g" numeric(8, 2) NOT NULL,
	"package_photo_path" varchar(500),
	"package_photo_mime" varchar(64),
	"package_telegram_file_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_products_unit_check" CHECK ("nutrition_products"."unit" IN ('g', 'ml')),
	CONSTRAINT "nutrition_products_calories_range" CHECK ("nutrition_products"."calories_per_100" >= 0 AND "nutrition_products"."calories_per_100" <= 900),
	CONSTRAINT "nutrition_products_proteins_range" CHECK ("nutrition_products"."proteins_per_100_g" >= 0 AND "nutrition_products"."proteins_per_100_g" <= 100),
	CONSTRAINT "nutrition_products_fats_range" CHECK ("nutrition_products"."fats_per_100_g" >= 0 AND "nutrition_products"."fats_per_100_g" <= 100),
	CONSTRAINT "nutrition_products_carbs_range" CHECK ("nutrition_products"."carbs_per_100_g" >= 0 AND "nutrition_products"."carbs_per_100_g" <= 100)
);
--> statement-breakpoint
ALTER TABLE "nutrition_products" ADD CONSTRAINT "nutrition_products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_nutrition_products_user" ON "nutrition_products" USING btree ("user_id","name");
