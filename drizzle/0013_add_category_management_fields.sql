-- Управление категориями через клиент: описание (для AI-классификации) и автор.
-- created_by_user_id: NULL = встроенная категория (нельзя удалять), иначе id создавшего админа.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS description varchar(500);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS created_by_user_id integer REFERENCES users(id);
