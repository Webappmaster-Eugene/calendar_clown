-- Таблица диалогов для режима Нейро (мульти-диалоги)
CREATE TABLE IF NOT EXISTS chat_dialogs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL DEFAULT 'Новый диалог',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_chat_dialogs_user_id ON chat_dialogs(user_id);

-- Добавить dialog_id в chat_messages (nullable для миграции)
ALTER TABLE chat_messages ADD COLUMN dialog_id INTEGER REFERENCES chat_dialogs(id) ON DELETE CASCADE;
CREATE INDEX idx_chat_messages_dialog_id ON chat_messages(dialog_id);

-- Добавить active_dialog_id в users
ALTER TABLE users ADD COLUMN active_dialog_id INTEGER REFERENCES chat_dialogs(id) ON DELETE SET NULL;

-- Миграция существующих данных: создать «Предыдущий диалог» для каждого юзера с сообщениями
INSERT INTO chat_dialogs (user_id, title)
SELECT DISTINCT user_id, 'Предыдущий диалог' FROM chat_messages;

UPDATE chat_messages cm SET dialog_id = cd.id
FROM chat_dialogs cd WHERE cm.user_id = cd.user_id AND cm.dialog_id IS NULL;

UPDATE users u SET active_dialog_id = cd.id
FROM chat_dialogs cd WHERE u.id = cd.user_id;

-- Сделать dialog_id обязательным
ALTER TABLE chat_messages ALTER COLUMN dialog_id SET NOT NULL;
