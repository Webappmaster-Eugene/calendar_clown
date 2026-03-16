# Telegram-бот для Google Calendar

Бот для управления встречами в Google Calendar через Telegram.

**Инструкция по использованию и описание работы под капотом:** [docs/USAGE_AND_ARCHITECTURE.md](docs/USAGE_AND_ARCHITECTURE.md)

## Требования

- Node.js 20+
- Аккаунт Google (календарь)
- Токен Telegram-бота ([@BotFather](https://t.me/BotFather))

## Настройка Google Calendar API

1. Откройте [Google Cloud Console](https://console.cloud.google.com/).
2. Создайте проект или выберите существующий.
3. Включите **Google Calendar API**: «APIs & Services» → «Library» → «Google Calendar API» → Enable.
4. Создайте учётные данные:
   - «APIs & Services» → «Credentials» → «Create Credentials» → «OAuth client ID».
   - Тип приложения: **Web application**.
   - В **Authorized redirect URIs** добавьте URL callback (например `https://yourdomain.com/oauth/callback`).
   - Возьмите `client_id` и `client_secret`.
5. Задайте значения в `.env` (см. ниже).

## Установка и запуск локально

```bash
cp .env.example .env
# Отредактируй .env

npm install
npm run build
npm run authorize   # один раз для тестового пользователя
npm start
```

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `TELEGRAM_BOT_TOKEN` | Токен бота из @BotFather |
| `GOOGLE_CLIENT_ID` | OAuth2 Client ID из Google Cloud |
| `GOOGLE_CLIENT_SECRET` | OAuth2 Client Secret |
| `OAUTH_REDIRECT_URI` | HTTPS-URL для OAuth callback (например `https://yourdomain.com/oauth/callback`). Домен и SSL обеспечиваются Dokploy/Traefik. |
| `OPENROUTER_API_KEY` | Ключ OpenRouter: транскрипция голоса и извлечение события |
| `PORT` | HTTP-порт (по умолчанию 18790). Traefik проксирует HTTPS на этот порт. |

## Команды бота

- `/start` — приветствие, кнопка «Войти через Google»
- `/help` — справка
- `/new <текст>` — создать встречу (например: `/new Встреча завтра в 15:00`)
- `/today` — встречи на сегодня
- `/week` — встречи на эту неделю
- **Голосовое сообщение** — создание/отмена встречи голосом

## Docker

```bash
docker build -t calendar-bot .
docker run -d \
  --env-file .env \
  -v calendar-tokens:/app/data/tokens \
  -v calendar-voice:/app/data/voice \
  -p 18790:18790 \
  calendar-bot
```

## Деплой на Dokploy

1. Подключите репозиторий в Dokploy.
2. Dokploy обнаружит `Dockerfile` и соберёт образ автоматически.
3. Задайте переменные окружения в настройках сервиса.
4. Настройте домен в Dokploy — Traefik выдаст SSL-сертификат автоматически.
5. Добавьте volumes для persistence:
   - `/app/data/tokens` — токены Google Calendar пользователей
   - `/app/data/voice` — временные голосовые файлы
6. В Google Console добавьте `https://your-domain.com/oauth/callback` в Authorized redirect URIs.
7. При push в main Dokploy автоматически пересоберёт и задеплоит.

## Лицензия

MIT
