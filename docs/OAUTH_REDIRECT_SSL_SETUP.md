# Настройка redirect и SSL для привязки календаря

Чтобы интеграция с календарём работала через redirect, нужен **публичный HTTPS-адрес**, на который Google будет перенаправлять пользователя после входа.

**При деплое через CI/CD:** nginx и certbot устанавливаются на хост скриптом `scripts/bootstrap-vds.sh`, SSL-сертификат выпускается скриптом `scripts/ensure-oauth-ssl.sh`. Workflow копирует скрипты и конфиги, формирует `.env` из секретов (в т.ч. `CERTBOT_EMAIL`). Список секретов и шаги — в README.md.

## Предварительные условия

- Бот уже задеплоен на VDS (например `/opt/telegram-calendar-bot`, systemd-сервис `telegram-calendar-bot`).
- У вас есть **домен или поддомен**, который вы можете направить на IP этого VDS (A-запись в DNS на IP сервера). Например: `oauth.podbor-minuta.ru`.

---

## Автоматическая настройка (рекомендуется)

При деплое через GitHub Actions скрипт `scripts/ensure-oauth-ssl.sh` автоматически:

1. Извлекает домен из `OAUTH_REDIRECT_URI` в `.env`.
2. Устанавливает nginx-конфиг из шаблона `config/nginx-oauth.podbor-minuta.ru.conf`.
3. Получает SSL-сертификат через certbot (если ещё не получен).
4. Запускает/перезагружает nginx.

### Переменные в `.env`:
```env
OAUTH_REDIRECT_URI=https://oauth.podbor-minuta.ru/oauth/callback
CERTBOT_EMAIL=your@email.com
```

### Google Cloud Console:
В Credentials → OAuth 2.0 Client ID → Authorized redirect URIs добавьте:
```
https://oauth.podbor-minuta.ru/oauth/callback
```

---

## Ручная настройка

### Шаг 1. DNS

- Создайте **A-запись**: имя хоста → IP вашего VDS.
- Дождитесь обновления DNS. Проверка: `ping bot.yourdomain.com`.

### Шаг 2. Установка nginx и Certbot на VDS

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

Или запустите `scripts/bootstrap-vds.sh` — он устанавливает всё необходимое.

### Шаг 3. Выпуск SSL-сертификата

```bash
sudo systemctl stop nginx
sudo certbot certonly --standalone -d bot.yourdomain.com
```

### Шаг 4. Конфигурация nginx

В репозитории есть шаблон: `config/nginx-oauth.podbor-minuta.ru.conf`. Скопируйте и замените домен:

```bash
sudo cp /opt/telegram-calendar-bot/config/nginx-oauth.podbor-minuta.ru.conf /etc/nginx/sites-available/telegram-calendar-bot
sudo sed -i 's/oauth\.podbor-minuta\.ru/bot.yourdomain.com/g' /etc/nginx/sites-available/telegram-calendar-bot
sudo ln -sf /etc/nginx/sites-available/telegram-calendar-bot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl start nginx
```

### Шаг 5. Переменные окружения

В `.env`:
```env
OAUTH_REDIRECT_URI=https://bot.yourdomain.com/oauth/callback
```

### Шаг 6. Google Cloud Console

Добавьте тот же URL в Authorized redirect URIs.

### Шаг 7. Перезапуск бота

```bash
sudo systemctl restart telegram-calendar-bot
```

### Шаг 8. Автообновление сертификата

```bash
sudo certbot renew --dry-run
```

### Шаг 9. Проверка

1. В Telegram: `/start` → «Войти через Google» → вход → redirect → «Календарь привязан».
2. `/today` — проверка что календарь работает.

---

## Если что-то не работает

- **400 от Google** — проверьте, что `OAUTH_REDIRECT_URI` совпадает с URI в Google Console.
- **Не открывается HTTPS** — проверьте DNS, nginx (`sudo nginx -t`), что бот слушает на 127.0.0.1:18790.
- **«Не хватает параметров»** — nginx обрезает query string. Проверьте `proxy_pass` в конфиге.
