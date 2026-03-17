-- Add visibility (public/private) and tribe_id to notes
ALTER TABLE notes ADD COLUMN visibility VARCHAR(10) NOT NULL DEFAULT 'private';
ALTER TABLE notes ADD COLUMN tribe_id INTEGER REFERENCES tribes(id);
ALTER TABLE notes ADD CONSTRAINT notes_visibility_check CHECK (visibility IN ('public', 'private'));
CREATE INDEX idx_notes_visibility ON notes (visibility);
CREATE INDEX idx_notes_tribe_visibility ON notes (tribe_id, visibility) WHERE visibility = 'public';
-- Backfill tribe_id from the note owner's tribe
UPDATE notes SET tribe_id = u.tribe_id FROM users u WHERE notes.user_id = u.id;
