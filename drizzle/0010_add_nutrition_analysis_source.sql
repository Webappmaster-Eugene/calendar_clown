-- Add source column to distinguish photo-based analyses from manual calculations.
-- Default 'photo' preserves backward compatibility for all existing rows.
ALTER TABLE "nutrition_analyses"
  ADD COLUMN "source" varchar(20) NOT NULL DEFAULT 'photo';
