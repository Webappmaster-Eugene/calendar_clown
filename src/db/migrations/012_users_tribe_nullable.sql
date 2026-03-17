-- Make tribe_id nullable so users can exist without a tribe
ALTER TABLE users ALTER COLUMN tribe_id DROP NOT NULL;
