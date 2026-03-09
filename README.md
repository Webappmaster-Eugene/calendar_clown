# Telegram-бот для Google Calendar

Бот для управления встречами в Google Calendar через Telegram.

**Инструкция по использованию и описание работы под капотом:** [docs/USAGE_AND_ARCHITECTURE.md](docs/USAGE_AND_ARCHITECTURE.md) Создание событий по фразе (например «Встреча завтра в 15:00») или по голосовому сообщению (транскрипция и извлечение события через OpenRouter), просмотр расписания на день/неделю.

## Требования

- Node.js 20+
- Аккаунт Google (календарь)
- Токен Telegram-бота ([@BotFather](https://t.me/BotFather))

## Настройка Google Calendar API

1. Откройте [Google Cloud Console](https://console.cloud.google.com/).
2. Создайте проект или выберите существующий.
3. Включите **Google Calendar API**: «APIs & Services» → «Library» → найдите «Google Calendar API» → Enable.
4. Создайте учётные данные:
   - «APIs & Services» → «Credentials» → «Create Credentials» → «OAuth client ID».
   - Тип приложения: **Web application**.
   - В **Authorized redirect URIs** добавьте URL callback (например `https://yourdomain.com/oauth/callback`). Он должен совпадать с переменной `OAUTH_REDIRECT_URI` в `.env`.
   - Скачайте JSON и возьмите из него `client_id` и `client_secret`.
5. Эти значения и `OAUTH_REDIRECT_URI` задайте в `.env` (см. ниже). Без HTTPS redirect привязка календаря не работает (Google отключил устаревший OOB flow).

## Установка и запуск локально

```bash
cp .env.example .env
# Отредактируйте .env: TELEGRAM_BOT_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

npm install
npm run build
npm run authorize   # один раз: откроется ссылка, вставьте код — сохранится data/token.json
npm start           # или npm run dev для разработки
```

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `TELEGRAM_BOT_TOKEN` | Токен бота из @BotFather |
| `GOOGLE_CLIENT_ID` | OAuth2 Client ID из Google Cloud |
| `GOOGLE_CLIENT_SECRET` | OAuth2 Client Secret |
| `OAUTH_REDIRECT_URI` | **Обязательно для привязки календаря.** HTTPS-URL, на который Google перенаправляет после входа (например `https://oauth.podbor-minuta.ru/oauth/callback`). Этот же URL нужно добавить в Google Console → Credentials → OAuth 2.0 Client → Authorized redirect URIs. |
| `GOOGLE_TOKEN_PATH` | Путь к файлу с токеном (по умолчанию `./data/token.json`) |
| `OPENROUTER_API_KEY` | Ключ OpenRouter: транскрипция голоса и извлечение события (DeepSeek) |
| `CERTBOT_EMAIL` | Email для Let's Encrypt (используется при первом выпуске сертификата) |

Секреты не храните в репозитории. Для локального запуска можно завести `.env.local` (в gitignore).

## Команды бота

- `/start` — приветствие и инструкция, кнопка «Войти через Google»
- `/help` — справка по командам
- `/new <текст>` — создать встречу (например: `/new Встреча завтра в 15:00`)
- `/today` — встречи на сегодня
- `/week` — встречи на эту неделю
- `/list` — то же, что `/today`
- **Голосовое сообщение** — бот распознаёт речь и создаёт/отменяет встречу. Для отмены скажите: «Отмени встречу с Романом завтра». Нужен `OPENROUTER_API_KEY` и **ffmpeg** на сервере.

## Деплой на VDS (systemd)

1. Установите Node.js 20+ на сервер.

2. Склонируйте или скопируйте проект на сервер, например в `/opt/telegram-calendar-bot`.

3. На сервере:
   ```bash
   cd /opt/telegram-calendar-bot
   npm install
   npm run build
   cp .env.example .env
   # Заполните .env
   mkdir -p data/tokens data/voice
   ```

4. Установите unit systemd (файл есть в репозитории):
   ```bash
   sudo cp /opt/telegram-calendar-bot/scripts/telegram-calendar-bot.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable telegram-calendar-bot
   sudo systemctl start telegram-calendar-bot
   ```

5. **SSL для OAuth:** см. [docs/OAUTH_REDIRECT_SSL_SETUP.md](docs/OAUTH_REDIRECT_SSL_SETUP.md).

Логи: `journalctl -u telegram-calendar-bot -f`.

## CI/CD GitHub Actions

Сборка выполняется на GitHub, деплой на VDS по push в `main` или вручную (workflow_dispatch).

### Секреты репозитория (Settings → Secrets and variables → Actions)

| Секрет | Описание |
|--------|----------|
| `SSH_HOST` | IP или хост VDS |
| `SSH_USER` | Пользователь SSH (например `root`) |
| `SSH_PRIVATE_KEY` | Приватный ключ для деплоя |
| `TELEGRAM_BOT_TOKEN` | Токен бота из @BotFather |
| `GOOGLE_CLIENT_ID` | OAuth2 Client ID из Google Cloud |
| `GOOGLE_CLIENT_SECRET` | OAuth2 Client Secret |
| `OAUTH_REDIRECT_URI` | HTTPS-URL callback для привязки календаря |
| `CERTBOT_EMAIL` | Email для Let's Encrypt |
| `OPENROUTER_API_KEY` | Ключ OpenRouter (голос и календарь) |

При деплое workflow:
1. Запускает `scripts/bootstrap-vds.sh` (устанавливает Node.js, ffmpeg, nginx, certbot, systemd сервис — идемпотентно).
2. Копирует `dist/`, `package.json`, `scripts/`, `config/` на VDS.
3. Обновляет `.env` из секретов (сохраняя ручные переменные).
4. Устанавливает зависимости и перезапускает бот.
5. Запускает `scripts/ensure-oauth-ssl.sh` (выпуск сертификата и настройка nginx).

**Проверка готовности VDS:** `cd /opt/telegram-calendar-bot && bash scripts/check-vds.sh`

## Лицензия

MIT
