INSERT INTO categories (name, emoji, aliases, sort_order)
VALUES ('Другое', '📦', ARRAY['другое', 'прочее', 'разное', 'misc', 'other'], 100)
ON CONFLICT (name) DO UPDATE SET
  emoji = EXCLUDED.emoji,
  aliases = EXCLUDED.aliases,
  sort_order = EXCLUDED.sort_order;
