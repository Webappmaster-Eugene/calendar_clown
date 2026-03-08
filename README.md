# Telegram-бот для Google Calendar

Бот для управления встречами в Google Calendar через Telegram.

**Инструкция по использованию и описание работы под капотом:** [docs/USAGE_AND_ARCHITECTURE.md](docs/USAGE_AND_ARCHITECTURE.md) Создание событий по фразе (например «Встреча завтра в 15:00») или по голосовому сообщению (транскрипция и извлечение события через OpenRouter), просмотр расписания на день/неделю.

## Требования

- Node.js 18+
- Аккаунт Google (календарь)
- Токен Telegram-бота ([@BotFather](https://t.me/BotFather))

## Настройка Google Calendar API

1. Откройте [Google Cloud Console](https://console.cloud.google.com/).
2. Создайте проект или выберите существующий.
3. Включите **Google Calendar API**: «APIs & Services» → «Library» → найдите «Google Calendar API» → Enable.
4. Создайте учётные данные:
   - «APIs & Services» → «Credentials» → «Create Credentials» → «OAuth client ID».
   - Тип приложения: **Desktop app** (или Web application, если нужен redirect).
   - Скачайте JSON и возьмите из него `client_id` и `client_secret`.
5. Эти значения задайте в `.env` (см. ниже).

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
| `GOOGLE_TOKEN_PATH` | Путь к файлу с токеном (по умолчанию `./data/token.json`) |
| `OPENROUTER_API_KEY` | Ключ OpenRouter: транскрипция голоса и извлечение события (DeepSeek); один ключ для голосовых сообщений |
| `SEND_MESSAGE_API_KEY` | (Опционально.) Секрет для HTTP API: отправка сообщений пользователям по username (для OpenClaw). См. [docs/USAGE_AND_ARCHITECTURE.md](docs/USAGE_AND_ARCHITECTURE.md#api-отправки-сообщений-пользователям-по-username-для-openclaw). |
| `SEND_MESSAGE_API_PORT` | Порт API отправки (по умолчанию 18790). |
| `SEND_MESSAGE_API_HOST` | Хост API (по умолчанию 127.0.0.1). |
| `DATABASE_URL` | (Опционально.) Подключение к PostgreSQL для хранения сообщений и транскриптов. Если не задано, бот работает без записи в БД. Альтернатива: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`. |

Секреты не храните в репозитории. Для локального запуска удобно завести `.env.local`: скопируйте [.env.local.example](.env.local.example) в `.env.local`, заполните переменные (в том числе SSH_* для скриптов деплоя). Файл `.env.local` в gitignore, при запуске бота и `npm run authorize` он подхватывается после `.env`.

## Команды бота

- `/start` — приветствие и краткая инструкция
- `/help` — справка по командам
- `/new <текст>` — создать встречу (например: `/new Встреча завтра в 15:00`)
- `/today` — встречи на сегодня
- `/week` — встречи на эту неделю
- `/list` — то же, что `/today`
- **Голосовое сообщение** — отправить голосовое: бот конвертирует OGG в WAV, распознаёт речь и через OpenRouter определяет намерение. Можно создать встречу (например: «Встреча завтра в 15:00») или отправить сообщение кому-то (например: «Отправь Анжелике Надточеевой что я ее люблю»; только для доверенных пользователей, получатель — по имени или username из тех, кто уже писал боту). Нужны `OPENROUTER_API_KEY` и **ffmpeg** на сервере (`apt install ffmpeg` / `yum install ffmpeg`).

## Хранение сообщений в PostgreSQL (опционально)

Входящие сообщения (текст и голосовые) и транскрипты голосовых можно сохранять в Postgres. Поднимите БД и примените миграции:

```bash
docker compose up -d
# Задайте в .env: DATABASE_URL=postgresql://bot:bot@localhost:5432/bot (или POSTGRES_*)
npm run migrate
npm start
```

Миграции лежат в `migrations/`. Команда `npm run migrate` выполняет их по порядку. Без `DATABASE_URL` бот работает как раньше, без записи в БД.

## Деплой на VDS (systemd)

1. Установите Node.js 18+ на сервер (например через [nvm](https://github.com/nvm-sh/nvm) или пакетный менеджер).

2. Склонируйте или скопируйте проект на сервер, например в `/opt/telegram-calendar-bot`.

3. На сервере:
   ```bash
   cd /opt/telegram-calendar-bot
   npm install
   npm run build
   cp .env.example .env
   # Заполните .env: TELEGRAM_BOT_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OPENROUTER_API_KEY
   mkdir -p data/tokens data/voice
   ```
   Календари пользователи привязывают сами через бота (`/start` → ссылка → `/auth <код>`). Локально для теста можно: `npm run authorize -- <TELEGRAM_USER_ID>` и скопировать `data/tokens/<id>.json` на сервер.

4. Создайте unit systemd `/etc/systemd/system/telegram-calendar-bot.service`:

   ```ini
   [Unit]
   Description=Telegram Google Calendar Bot
   After=network.target

   [Service]
   Type=simple
   User=root
   WorkingDirectory=/opt/telegram-calendar-bot
   EnvironmentFile=/opt/telegram-calendar-bot/.env
   ExecStart=/usr/bin/node dist/index.js
   Restart=on-failure
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```

5. Запуск и автозапуск:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable telegram-calendar-bot
   sudo systemctl start telegram-calendar-bot
   sudo systemctl status telegram-calendar-bot
   ```

Логи: `journalctl -u telegram-calendar-bot -f`.

## CI/CD (GitHub Actions)

Сборка выполняется на GitHub, деплой на VDS по push в `main` или вручную (workflow_dispatch). Переменные окружения задаются в GitHub Secrets — вручную на сервере указывать не нужно.

### Однократная настройка на VDS

1. Создайте ключ для деплоя (на своей машине): `ssh-keygen -t ed25519 -C "github-deploy" -f deploy_key -N ""`
2. Публичный ключ добавьте на VDS: `ssh-copy-id -i deploy_key.pub root@45.10.41.177` (или скопируйте содержимое `deploy_key.pub` в `~/.ssh/authorized_keys` на сервере).
3. Приватный ключ целиком скопируйте в буфер — он понадобится для секрета `SSH_PRIVATE_KEY`.

### Секреты репозитория (Settings → Secrets and variables → Actions)

| Секрет | Описание |
|--------|----------|
| `SSH_HOST` | IP или хост VDS (например `45.10.41.177`) |
| `SSH_USER` | Пользователь SSH (например `root`) |
| `SSH_PRIVATE_KEY` | Полное содержимое файла `deploy_key` (приватный ключ) |
| `TELEGRAM_BOT_TOKEN` | Токен бота из @BotFather |
| `GOOGLE_CLIENT_ID` | OAuth2 Client ID из Google Cloud |
| `GOOGLE_CLIENT_SECRET` | OAuth2 Client Secret |
| `OPENROUTER_API_KEY` | Ключ OpenRouter (голос и календарь) |

При каждом деплое workflow создаёт на сервере `.env` из этих секретов, копирует собранный код, создаёт каталоги `data/tokens` и `data/voice`, запускает `npm install --omit=dev` и перезапускает `telegram-calendar-bot`. Каждый пользователь привязывает свой календарь через бота: `/start` → ссылка на Google → `/auth <код>`. Токены хранятся в `data/tokens/<user_id>.json` и при деплое не трогаются.

**Проверка готовности VDS** (после SSH на сервер): `cd /opt/telegram-calendar-bot && bash scripts/check-vds.sh` — проверяет Node, ffmpeg, каталоги, .env и сервис.

## Деплой на VDS (PM2)

```bash
npm install -g pm2
cd /opt/telegram-calendar-bot
npm run build
# Настройте .env и выполните authorize
pm2 start dist/index.js --name telegram-calendar-bot
pm2 save
pm2 startup   # автозапуск при перезагрузке
```

## Лицензия

MIT
