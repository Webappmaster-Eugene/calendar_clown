# Настройка режима «Дайджест»

Дайджест — режим бота, который парсит публичные Telegram-каналы, ранжирует посты по вовлечённости и присылает сводку с AI-саммари.

## Как работает

```
Пользователь: /digest DevOps — новости DevOps
                    ↓
            Создаётся рубрика (DeepSeek генерирует emoji и ключевые слова)
                    ↓
Пользователь: /digest add DevOps @devops_news @golang_daily
                    ↓
            Каналы валидируются через MTProto и сохраняются в БД
                    ↓
Крон (ежедневно 6:00 МСК) или /digest now
                    ↓
GramJS читает посты за 24ч → ранжирование → DeepSeek саммари → сообщение в чат
```

## Требования

| Компонент | Зачем |
|-----------|-------|
| **PostgreSQL** | Хранение рубрик, каналов, прогонов, постов |
| **Telegram API (MTProto)** | Чтение публичных каналов (бот-токен не может читать каналы) |
| **OpenRouter API** | AI-саммари постов (DeepSeek Chat v3.1) |

---

## Шаг 1: Получить Telegram API credentials

Дайджест читает каналы через MTProto (как обычный пользователь), а не через Bot API. Для этого нужен отдельный API ID.

1. Откройте https://my.telegram.org/apps
2. Войдите под **отдельным** номером телефона (не основной аккаунт)
3. Создайте приложение → получите **API ID** (число) и **API Hash** (строка)

> ⚠️ Используйте выделенный номер. Основной аккаунт может получить ограничения при парсинге.

---

## Шаг 2: Переменные окружения

Добавьте в `.env.local` (локально) или в настройки сервиса Dokploy:

```env
# === Обязательные для дайджеста ===
TELEGRAM_PARSER_API_ID=12345678
TELEGRAM_PARSER_API_HASH=abcdef1234567890abcdef1234567890

# === Уже должны быть настроены ===
OPENROUTER_API_KEY=sk-or-...          # AI-саммари
DATABASE_URL=postgresql://...          # Хранение данных

# === Опционально ===
DIGEST_CRON=0 6 * * *                 # Время запуска (по умолчанию 6:00 МСК)
DIGEST_MAX_CHANNELS_TOTAL=100         # Лимит каналов на весь бот (по умолчанию 100)
```

---

## Шаг 3: Авторизация MTProto (один раз)

Этот шаг создаёт сессию Telegram для чтения каналов. Выполняется **локально** — на сервере сессия подхватывается из файла.

```bash
cd voice-meet-planner
npm run tg-auth
```

Скрипт спросит:
1. **Номер телефона** (с кодом страны, например `+79001234567`)
2. **Код подтверждения** (придёт в Telegram на этот номер)
3. **Пароль 2FA** (если включена двухфакторная, иначе Enter)

Результат — файл `data/telegram-session/session.txt`.

---

## Шаг 4: Настройка Docker / Dokploy

### docker-compose.yml

Добавьте volume для сессии и переменные окружения:

```yaml
services:
  bot:
    environment:
      # ... существующие переменные ...
      - TELEGRAM_PARSER_API_ID=${TELEGRAM_PARSER_API_ID}
      - TELEGRAM_PARSER_API_HASH=${TELEGRAM_PARSER_API_HASH}
      - DIGEST_CRON=${DIGEST_CRON:-0 6 * * *}
    volumes:
      # ... существующие volumes ...
      - telegram-session:/app/data/telegram-session   # ← добавить

volumes:
  # ... существующие volumes ...
  telegram-session:   # ← добавить
```

### Dokploy

1. **Переменные окружения** — добавьте `TELEGRAM_PARSER_API_ID` и `TELEGRAM_PARSER_API_HASH` в настройках сервиса
2. **Persistent storage** — добавьте volume mount `./data/telegram-session` → `/app/data/telegram-session`
3. **Загрузка сессии** — после `npm run tg-auth` скопируйте файл `data/telegram-session/session.txt` на сервер в примонтированный volume

Варианты загрузки сессии на сервер:

```bash
# Вариант A: через docker cp
docker cp data/telegram-session/session.txt <container_id>:/app/data/telegram-session/session.txt

# Вариант B: через SSH на VDS
scp data/telegram-session/session.txt user@server:/path/to/volume/session.txt
```

---

## Шаг 5: Использование в Telegram

### Создать рубрику

```
/digest DevOps — новости про DevOps, Kubernetes, CI/CD
```

Бот сгенерирует emoji и ключевые слова через DeepSeek.

### Добавить каналы

```
/digest add DevOps @devops_news @golang_daily @k8s_weekly
```

Бот проверит каждый канал через MTProto (название, подписчики).

### Посмотреть каналы рубрики

```
/digest channels DevOps
```

### Запустить дайджест вручную

```
/digest now
```

Или нажать кнопку «▶️ Запустить сейчас» на клавиатуре (режим дайджеста).

### Другие команды

| Команда | Что делает |
|---------|-----------|
| `/digest` | Список ваших рубрик |
| `/digest pause DevOps` | Приостановить рубрику |
| `/digest resume DevOps` | Возобновить рубрику |
| `/digest remove DevOps @channel` | Убрать канал из рубрики |
| `/digest delete DevOps` | Удалить рубрику целиком |

---

## Лимиты

| Параметр | Значение |
|----------|----------|
| Рубрик на пользователя | 10 |
| Каналов в рубрике | 20 |
| Каналов на весь бот | 100 (настраивается) |
| Постов в одном дайджесте | 10 (топ по вовлечённости) |
| Глубина парсинга | 24 часа |
| Мин. длина поста | 50 символов |
| Пауза между каналами | 3–5 сек (защита от FloodWait) |

---

## Troubleshooting

### «MTProto session not found»
Запустите `npm run tg-auth` и загрузите `session.txt` на сервер.

### «TELEGRAM_PARSER_API_ID / TELEGRAM_PARSER_API_HASH not set»
Добавьте переменные окружения (Шаг 2).

### FloodWait при парсинге
Telegram ограничивает частоту запросов. Бот автоматически ждёт нужное время + 10%. Если ошибки частые — уменьшите количество каналов.

### Сессия истекла
Если бот не использовался 6+ месяцев, сессия может истечь. Повторите `npm run tg-auth`.

### Каналы не находятся
- Канал должен быть **публичным**
- Username вводить без `@` или с `@` — оба варианта работают
- Канал должен существовать и быть активным
