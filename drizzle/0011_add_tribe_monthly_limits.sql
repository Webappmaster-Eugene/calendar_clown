-- Per-month spending limit overrides for tribes.
-- Lookup order at runtime: this table → tribes.monthly_limit → ENV default (350 000).
CREATE TABLE IF NOT EXISTS "tribe_monthly_limits" (
  "id"           serial PRIMARY KEY,
  "tribe_id"     integer NOT NULL REFERENCES "tribes"("id"),
  "year"         integer NOT NULL,
  "month"        smallint NOT NULL,
  "limit_amount" numeric(12, 2) NOT NULL,
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tribe_monthly_limits_month_range"     CHECK ("month" BETWEEN 1 AND 12),
  CONSTRAINT "tribe_monthly_limits_amount_positive" CHECK ("limit_amount" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_tribe_monthly_limits_unique"
  ON "tribe_monthly_limits" ("tribe_id", "year", "month");
