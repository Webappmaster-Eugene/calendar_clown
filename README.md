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
| `OAUTH_REDIRECT_URI` | **Обязательно для привязки календаря.** HTTPS-URL, на который Google перенаправляет после входа (например `https://yourdomain.com/oauth/callback`). Этот же URL нужно добавить в Google Console → Credentials → OAuth 2.0 Client → Authorized redirect URIs. После входа по кнопке в боте календарь привязывается автоматически. |
| `GOOGLE_TOKEN_PATH` | Путь к файлу с токеном (по умолчанию `./data/token.json`) |
| `OPENROUTER_API_KEY` | Ключ OpenRouter: транскрипция голоса и извлечение события (DeepSeek); один ключ для голосовых сообщений |
| `OPENCLAW_GATEWAY_URL` | (Опционально.) URL шлюза OpenClaw (по умолчанию в коде `http://127.0.0.1:18789`). Нужен вместе с токеном для команды `/openclaw`. |
| `OPENCLAW_GATEWAY_TOKEN` | (Опционально.) Токен OpenClaw Gateway. Если задан, регистрируются команды `/openclaw` и `/stop` для чата с агентом OpenClaw. Токен берётся из конфигурации или env того же OpenClaw Gateway; см. раздел «Откуда взять OPENCLAW_GATEWAY_TOKEN и OPENCLAW_GATEWAY_URL» в [docs/USAGE_AND_ARCHITECTURE.md](docs/USAGE_AND_ARCHITECTURE.md). |
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
- `/openclaw [текст]` — (если задан `OPENCLAW_GATEWAY_TOKEN`) одно сообщение в OpenClaw или вход в режим диалога; ответы приходят от агента OpenClaw.
- `/stop` — выйти из режима чата OpenClaw.

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
   Календари пользователи привязывают сами через бота: `/start` → кнопка «Войти через Google» → после входа календарь привязывается автоматически (нужен настроенный `OAUTH_REDIRECT_URI` и HTTPS до сервера). Запасной вариант: `/auth <код>` если страница callback показала код. Локально для теста можно: `npm run authorize -- <TELEGRAM_USER_ID>` и скопировать `data/tokens/<id>.json` на сервер.

4. Установите unit systemd (файл есть в репозитории):

   ```bash
   sudo cp /opt/telegram-calendar-bot/scripts/telegram-calendar-bot.service /etc/systemd/system/
   ```

5. Запуск и автозапуск:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable telegram-calendar-bot
   sudo systemctl start telegram-calendar-bot
   sudo systemctl status telegram-calendar-bot
   ```

6. **Redirect и SSL для привязки календаря:** чтобы пользователи могли привязать календарь по кнопке «Войти через Google», нужен публичный HTTPS-адрес и nginx. Подробная настройка: [docs/OAUTH_REDIRECT_SSL_SETUP.md](docs/OAUTH_REDIRECT_SSL_SETUP.md). Для **Docker Compose** (домен oauth.podbor-minuta.ru) в том же документе есть раздел «Вариант: Docker Compose»; конфиг: [config/nginx-oauth.podbor-minuta.ru.conf](config/nginx-oauth.podbor-minuta.ru.conf).

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
| `OAUTH_REDIRECT_URI` | HTTPS-URL callback для привязки календаря (например `https://yourdomain.com/oauth/callback`) |
| `OPENROUTER_API_KEY` | Ключ OpenRouter (голос и календарь) |
| `OPENCLAW_GATEWAY_TOKEN` | (Опционально.) Токен OpenClaw Gateway для команды `/openclaw`. Если задан, при деплое попадёт в `.env` на сервере. См. раздел «Откуда взять OPENCLAW_GATEWAY_TOKEN и OPENCLAW_GATEWAY_URL» в [docs/USAGE_AND_ARCHITECTURE.md](docs/USAGE_AND_ARCHITECTURE.md). |
| `OPENCLAW_GATEWAY_URL` | (Опционально.) URL шлюза OpenClaw (например `http://127.0.0.1:18789`). Нужен только если шлюз не на localhost:18789. |

При каждом деплое workflow обновляет на сервере `.env`: подставляет в него значения из секретов (TELEGRAM_BOT_TOKEN, GOOGLE_*, OPENROUTER_API_KEY, OAUTH_REDIRECT_URI, при наличии — OPENCLAW_GATEWAY_TOKEN и OPENCLAW_GATEWAY_URL), при этом **остальные переменные** (ADMIN_USER_IDS, SEND_MESSAGE_API_* и др.), заданные вручную в `.env` на VDS, сохраняются. Затем копируется собранный код, создаются каталоги `data/tokens` и `data/voice`, выполняется `npm install --omit=dev` и перезапуск `telegram-calendar-bot`. Каждый пользователь привязывает календарь через бота: `/start` → кнопка «Войти через Google» → автоматическая привязка (нужен секрет `OAUTH_REDIRECT_URI` и HTTPS до сервера). Токены хранятся в `data/tokens/<user_id>.json` и при деплое не трогаются.

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
