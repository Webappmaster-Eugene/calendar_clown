---
name: db-migration
description: Создание SQL-миграции для PostgreSQL. Используй при изменении схемы базы данных.
---

Создай миграцию для: $ARGUMENTS

## Шаги

### 1. Анализ текущей схемы
- Прочитай существующие миграции в `migrations/`
- Определи текущее состояние таблиц
- Определи следующий номер миграции (формат: `NNN_description.sql`)

### 2. Проектирование
- Определи, какие изменения нужны (CREATE TABLE, ALTER TABLE, CREATE INDEX)
- Помни: PostgreSQL 16, используй современные типы (TIMESTAMPTZ, JSONB, UUID)
- Индексы для частых запросов (по user_id, chat_id, created_at)

### 3. Создание миграции
- Создай файл `migrations/<NNN>_<description>.sql`
- Используй `IF NOT EXISTS` / `IF EXISTS` для идемпотентности
- Добавь комментарий в начало файла с описанием изменений

Пример формата:
```sql
-- Migration: <описание>
-- Date: <дата>

CREATE TABLE IF NOT EXISTS <table_name> (
  id SERIAL PRIMARY KEY,
  ...
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_<table>_<column>
  ON <table_name> (<column>);
```

### 4. Проверка
- SQL синтаксически корректен
- Не ломает существующие данные (миграция без потерь)
- Совместима с `scripts/migrate.ts` (файлы выполняются по порядку)

### 5. Обновление кода
- Если нужны новые запросы — обнови `src/db/`
- Обнови `src/db/client.ts` если нужен новый pool
- Помни: PostgreSQL опционален, оберни в проверку наличия подключения
