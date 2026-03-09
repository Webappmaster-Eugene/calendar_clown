# Настройка OAuth redirect для привязки календаря

Для привязки календаря нужен **публичный HTTPS-адрес**, на который Google перенаправит пользователя после входа.

## Dokploy (рекомендуется)

При деплое через Dokploy SSL обеспечивается Traefik автоматически:

1. В Dokploy назначьте домен сервису (например `calendar.yourdomain.com`).
2. Traefik автоматически выдаст Let's Encrypt сертификат.
3. В переменных окружения сервиса задайте:
   ```
   OAUTH_REDIRECT_URI=https://calendar.yourdomain.com/oauth/callback
   ```
4. В [Google Cloud Console](https://console.cloud.google.com/) → Credentials → OAuth 2.0 Client → Authorized redirect URIs добавьте тот же URL:
   ```
   https://calendar.yourdomain.com/oauth/callback
   ```
5. Перезапустите сервис.

Приложение слушает HTTP на порту `PORT` (по умолчанию 18790). Traefik проксирует HTTPS → HTTP автоматически.

## Проверка

1. В Telegram: `/start` → «Войти через Google» → вход в Google → redirect → «Календарь привязан».
2. `/today` — проверка что календарь работает.

## Если что-то не работает

- **400 от Google** — `OAUTH_REDIRECT_URI` в `.env` не совпадает с URI в Google Console.
- **Redirect не работает** — проверьте что домен настроен в Dokploy и Traefik выдал сертификат.
- **«Не хватает параметров»** — запрос доходит, но без `code`/`state`. Проверьте что Traefik не обрезает query string.
