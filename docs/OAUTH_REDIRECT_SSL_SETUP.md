# Настройка redirect и SSL для привязки календаря

Чтобы интеграция с календарём работала через redirect (без устаревшего OOB), нужен **публичный HTTPS-адрес**, на который Google будет перенаправлять пользователя после входа. Ниже — последовательность действий.

## Предварительные условия

- Бот уже задеплоен на VDS (например `/opt/telegram-calendar-bot`, systemd-сервис `telegram-calendar-bot`).
- У вас есть **домен или поддомен**, который вы можете направить на IP этого VDS (A-запись в DNS на IP сервера). Например: `bot.yourdomain.com` или `calendar.yourdomain.com`.

Если домена нет — его нужно завести (любой регистратор или бесплатный поддомен) и настроить DNS. Без домена и HTTPS Google OAuth redirect не заработает.

---

## Вариант: Docker Compose (oauth.podbor-minuta.ru)

Если используете [docker-compose.yml](../docker-compose.yml), nginx и certbot подняты как сервисы с профилем `oauth`. Домен: **oauth.podbor-minuta.ru** (A-запись на IP сервера уже настроена).

1. **Переменные в `.env`:**
   ```env
   OAUTH_REDIRECT_URI=https://oauth.podbor-minuta.ru/oauth/callback
   CERTBOT_EMAIL=your@email.com
   ```
   `CERTBOT_EMAIL` нужен для первого выпуска сертификата Let's Encrypt.

2. **Получить сертификат (один раз).** Порт 80 должен быть свободен, nginx не запущен:
   ```bash
   docker compose --profile oauth run --rm certbot
   ```
   При необходимости передайте email: `docker compose --profile oauth run --rm -e CERTBOT_EMAIL=your@email.com certbot`

3. **Запустить nginx:**
   ```bash
   docker compose --profile oauth up -d nginx
   ```

4. **Бот** должен работать на хосте (systemd или `npm start`) и слушать порт **18790** (по умолчанию). В `.env` бота задан `OAUTH_REDIRECT_URI` (см. п. 1).

5. **Google Cloud Console** → Credentials → OAuth 2.0 Client ID → Authorized redirect URIs → добавьте:
   ```
   https://oauth.podbor-minuta.ru/oauth/callback
   ```

6. **Продление сертификата:** раз в ~90 дней. Например, добавить в cron на хосте:
   ```bash
   docker compose --profile oauth run --rm certbot renew
   docker compose --profile oauth exec nginx nginx -s reload
   ```
   Или использовать отдельный таймер/cron для `certbot renew` и перезагрузки nginx.

Конфиг nginx: [config/nginx-oauth.podbor-minuta.ru.conf](../config/nginx-oauth.podbor-minuta.ru.conf). Проксирование идёт на `host.docker.internal:18790` (бот на хосте).

---

## Последовательность действий (без Docker)

### Шаг 1. DNS

- В панели управления доменом создайте **A-запись**: имя хоста (например `bot` или `calendar`) → IP вашего VDS.
- Дождитесь обновления DNS (от нескольких минут до 24–48 часов). Проверка: `ping bot.yourdomain.com` с любой машины — должен отвечать IP сервера.

### Шаг 2. Установка nginx и Certbot на VDS

Подключитесь по SSH к серверу и выполните (для Debian/Ubuntu):

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

- **nginx** — примет HTTPS и будет проксировать запросы на бота.
- **certbot** — получит и будет обновлять сертификат Let's Encrypt (бесплатный SSL).

### Шаг 3. Временное отключение nginx (для выдачи сертификата)

Если nginx уже был установлен и занял порт 80:

```bash
sudo systemctl stop nginx
```

Certbot в следующем шаге может сам запустить nginx; если порт 80 свободен, можно не останавливать.

### Шаг 4. Выпуск SSL-сертификата

Подставьте свой домен вместо `bot.yourdomain.com`:

```bash
sudo certbot certonly --standalone -d bot.yourdomain.com
```

- Введите email для уведомлений от Let's Encrypt.
- Согласитесь с условиями.
- При запросе «Share email» — по желанию.

Сертификаты появятся в `/etc/letsencrypt/live/bot.yourdomain.com/` (файлы `fullchain.pem` и `privkey.pem`).

Если команда выдаёт ошибку «port 80 already in use», остановите nginx (`sudo systemctl stop nginx`) и повторите. После успешного выпуска nginx можно будет настроить и запустить снова.

### Шаг 5. Конфигурация nginx для HTTPS и проксирования

В репозитории есть готовый пример: [config/nginx-telegram-calendar-bot.conf](../config/nginx-telegram-calendar-bot.conf). Скопируйте его на сервер и замените `bot.yourdomain.com` на свой домен:

```bash
sudo cp /opt/telegram-calendar-bot/config/nginx-telegram-calendar-bot.conf /etc/nginx/sites-available/telegram-calendar-bot
sudo nano /etc/nginx/sites-available/telegram-calendar-bot
# Замените bot.yourdomain.com на ваш домен во всех местах
```

Включите сайт и проверьте конфиг:

```bash
sudo ln -sf /etc/nginx/sites-available/telegram-calendar-bot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl start nginx
```

### Шаг 6. Переменные окружения на сервере

В каталоге приложения отредактируйте `.env`:

```bash
cd /opt/telegram-calendar-bot
nano .env
```

Добавьте (подставьте свой домен):

```env
OAUTH_REDIRECT_URI=https://bot.yourdomain.com/oauth/callback
```

При необходимости укажите порт и хост (по умолчанию порт 18790, хост 127.0.0.1):

```env
SEND_MESSAGE_API_PORT=18790
SEND_MESSAGE_API_HOST=127.0.0.1
```

Сохраните файл. Если деплой перезаписывает `.env` из CI/CD, добавьте `OAUTH_REDIRECT_URI` в секреты репозитория и убедитесь, что workflow передаёт его в `.env` на сервере.

### Шаг 7. Google Cloud Console — Authorized redirect URIs

1. Откройте [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Выберите ваш OAuth 2.0 Client ID (тип «Web application»).
3. В блоке **Authorized redirect URIs** нажмите «Add URI» и добавьте **ровно** тот же URL, что и в `OAUTH_REDIRECT_URI`:
   ```
   https://bot.yourdomain.com/oauth/callback
   ```
4. Сохраните изменения.

Регистр, завершающий слэш и путь должны совпадать с тем, что в `.env` и в nginx.

### Шаг 8. Перезапуск бота

На сервере:

```bash
sudo systemctl restart telegram-calendar-bot
sudo systemctl status telegram-calendar-bot
```

В логах при старте должна быть строка о запуске HTTP-сервера с путём callback (например «GET /oauth/callback»).

### Шаг 9. Автообновление сертификата

Проверка продления:

```bash
sudo certbot renew --dry-run
```

Если команда проходит без ошибок, продление уже настроено (systemd timer или cron от certbot).

### Шаг 10. Проверка интеграции с календарём

1. В Telegram отправьте боту `/start`.
2. Нажмите «Войти через Google».
3. Войдите в Google и разрешите доступ.
4. Вас должно перенаправить на `https://bot.yourdomain.com/oauth/callback?...` и показать страницу «Календарь привязан. Закройте вкладку и вернитесь в Telegram».
5. В Telegram проверьте, что календарь привязан (например командой `/today` или снова `/start`).

---

## Если что-то не работает

- **400 от Google** — проверьте, что в запросе к Google уходит именно `OAUTH_REDIRECT_URI` с HTTPS и путём `/oauth/callback`, и что этот URI один в один добавлен в Google Console (Authorized redirect URIs).
- **Не открывается https://bot.yourdomain.com/oauth/callback** — проверьте DNS, nginx (`sudo nginx -t`, логи в `/var/log/nginx/`), что бот слушает на 127.0.0.1:18790 и в `.env` задан `OAUTH_REDIRECT_URI`.
- **После redirect «Не хватает параметров»** — запрос до бота доходит, но без `code` или `state`; проверьте, что nginx не обрезает query string (в конфиге `proxy_pass http://127.0.0.1:18790` без лишнего пути — query передаётся).
