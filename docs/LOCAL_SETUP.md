# Локальная настройка и запуск

## Требования

- **Node.js** 20+ ([nodejs.org](https://nodejs.org))
- **PostgreSQL** 16+ (локально или через Docker)
- **Telegram Bot Token** (от [@BotFather](https://t.me/BotFather))

## 1. Клонирование и установка

```bash
git clone <repo-url>
cd voice-meet-planner
npm install
```

## 2. PostgreSQL

### Вариант A: Docker (рекомендуется)

```bash
docker run -d \
  --name calendar-bot-db \
  -p 5432:5432 \
  -e POSTGRES_DB=calendar_bot \
  -e POSTGRES_USER=bot \
  -e POSTGRES_PASSWORD=bot_password \
  postgres:16-alpine
```

### Вариант B: Локальный PostgreSQL

```bash
createdb calendar_bot
```

## 3. Переменные окружения

Создайте `.env.local` в корне проекта:

```env
# Обязательные
TELEGRAM_BOT_TOKEN=<токен от BotFather>
DATABASE_URL=postgresql://bot:bot_password@localhost:5432/calendar_bot
ADMIN_TELEGRAM_ID=<ваш Telegram ID>

# Опциональные — Google Calendar (без них календарь не работает)
GOOGLE_CLIENT_ID=<OAuth Client ID>
GOOGLE_CLIENT_SECRET=<OAuth Client Secret>
OAUTH_REDIRECT_URI=https://your-domain.com/oauth/callback

# Опциональные — OpenRouter (для голосовых команд)
OPENROUTER_API_KEY=<ключ API OpenRouter>

# Опциональные — лимиты
MONTHLY_EXPENSE_LIMIT=350000
PORT=18790
```

Свой Telegram ID можно узнать у [@userinfobot](https://t.me/userinfobot).

## 4. Запуск в dev-режиме

```bash
npm run dev
```

Бот подключится к PostgreSQL, выполнит миграции и запустится в режиме long polling.

## 5. Сборка и запуск production

```bash
npm run build
npm start
```

## 6. Запуск тестов

Тесты требуют PostgreSQL:

```bash
# Все тесты
npm test

# Только парсер
npm run test:parser

# Только репозиторий
npm run test:repo
```

## 7. Регистрация бота

1. Напишите [@BotFather](https://t.me/BotFather) `/newbot`
2. Задайте имя и username
3. Скопируйте токен в `TELEGRAM_BOT_TOKEN`
4. Запустите бот, отправьте `/start`

## 8. Google Calendar (опционально)

Если нужна интеграция с Google Calendar:

1. Создайте проект в [Google Cloud Console](https://console.cloud.google.com)
2. Включите Google Calendar API
3. Создайте OAuth 2.0 credentials (Web application)
4. Добавьте redirect URI: `https://your-domain.com/oauth/callback`
5. Заполните `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI` в `.env.local`

Подробнее: [docs/OAUTH_REDIRECT_SSL_SETUP.md](./OAUTH_REDIRECT_SSL_SETUP.md)

## Docker Compose (полный стек)

```bash
docker-compose up -d
```

Запустит PostgreSQL + бот. Переменные окружения задаются в `docker-compose.yml` или через `.env`.
