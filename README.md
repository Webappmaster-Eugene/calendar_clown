# Telegram-бот для Google Calendar

Бот для управления встречами в Google Calendar через Telegram. Создание событий по фразе (например «Встреча завтра в 15:00») и просмотр расписания на день/неделю.

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

Секреты не храните в репозитории. На сервере используйте `.env` или переменные окружения процесса.

## Команды бота

- `/start` — приветствие и краткая инструкция
- `/help` — справка по командам
- `/new <текст>` — создать встречу (например: `/new Встреча завтра в 15:00`)
- `/today` — встречи на сегодня
- `/week` — встречи на эту неделю
- `/list` — то же, что `/today`

## Деплой на VDS (systemd)

1. Установите Node.js 18+ на сервер (например через [nvm](https://github.com/nvm-sh/nvm) или пакетный менеджер).

2. Склонируйте или скопируйте проект на сервер, например в `/opt/telegram-calendar-bot`.

3. На сервере:
   ```bash
   cd /opt/telegram-calendar-bot
   npm install
   npm run build
   cp .env.example .env
   # Заполните .env: TELEGRAM_BOT_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
   npm run authorize   # один раз ввести код из браузера (можно выполнить локально и скопировать data/token.json на сервер)
   ```

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
