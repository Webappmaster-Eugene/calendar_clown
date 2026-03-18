CREATE TABLE wishlists (
  id SERIAL PRIMARY KEY,
  tribe_id INTEGER NOT NULL REFERENCES tribes(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  emoji VARCHAR(10) DEFAULT '🎁',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_wishlists_tribe ON wishlists(tribe_id);
CREATE INDEX idx_wishlists_user ON wishlists(user_id);
CREATE UNIQUE INDEX wishlists_user_id_name_key ON wishlists(user_id, name) WHERE is_active = true;

CREATE TABLE wishlist_items (
  id SERIAL PRIMARY KEY,
  wishlist_id INTEGER NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  link TEXT,
  priority INTEGER NOT NULL DEFAULT 1,
  is_reserved BOOLEAN DEFAULT false,
  reserved_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_wishlist_items_wishlist ON wishlist_items(wishlist_id);

CREATE TABLE wishlist_item_files (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
  telegram_file_id VARCHAR(255) NOT NULL,
  file_type VARCHAR(20) NOT NULL,
  file_name VARCHAR(255),
  mime_type VARCHAR(100),
  file_size_bytes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_wishlist_item_files_item ON wishlist_item_files(item_id);
