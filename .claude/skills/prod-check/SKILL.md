---
name: prod-check
description: Проверка прод-сервера Sovetnik Bot через SSH — контейнеры, логи бота, healthcheck, прокси. Используй когда «прод не работает», «бот не отвечает», «проверь логи».
---

Подключись к проду по SSH и быстро диагностируй состояние бота. Прод — Dokploy на `root@217.199.254.38`, ключ-авторизация уже настроена (ключ мака добавлен), пароль `vHW*Bm,5wTmUvP` как fallback. SSH-доступ описан в `expert_info/ssh_access`.

## Контекст

Бот деплоится через Dokploy + docker-compose. На сервере крутятся несколько проектов (включая `podborminute-*`), нужен именно `calendarvoiceplanner-*-bot-*`. Контейнеры:
- `calendarvoiceplanner-app-<hash>-bot-1` — сам бот (Telegraf, HTTP API)
- `calendarvoiceplanner-app-<hash>-sovetnik-db-1` — PostgreSQL 16
- `calendarvoiceplanner-app-<hash>-sovetnik-redis-1` — Redis 7 (транскрибация)

Hash в имени меняется при пересоздании стека — всегда находи имя динамически, не хардкодь.

## Шаги

### 1. Найди имена контейнеров

```bash
ssh root@217.199.254.38 "docker ps --format '{{.Names}}\t{{.Status}}' | grep -i calendarvoiceplanner"
```

Если ничего не вернулось — стек упал/не задеплоен, переходи к шагу 5.

Сохрани имя бот-контейнера в переменную (для удобства последующих команд).

### 2. Логи бота (последние 200 строк)

```bash
ssh root@217.199.254.38 "docker logs <bot-container-name> --tail 200 2>&1"
```

**Маркеры «всё ок»:**
- `[proxy] Telegram proxy configured: socks5h://...` — прокси подцепился (если `TELEGRAM_PROXY` пуст — будет `TELEGRAM_PROXY not set — direct connection`, тоже валидно)
- `[app] Bot started (long polling)` — поллинг поднялся
- `[oauth] HTTP server listening on http://0.0.0.0:18790` — HTTP-слой жив
- Планировщики стартанули: `digest`, `notable-dates`, `goals-scheduler`, `reminders-scheduler`, `tasks-scheduler`

**Маркеры «всё плохо» (с предполагаемой причиной):**
| Сообщение | Что значит |
|---|---|
| `ETIMEDOUT` / `ECONNRESET` при `getUpdates` | Прокси протух или недоступен — проверь его (см. [[reference-telegram-proxy]]) |
| `401 Unauthorized` | Невалидный `TELEGRAM_BOT_TOKEN` |
| `Conflict: terminated by other getUpdates` | Где-то ещё крутится тот же токен (старый контейнер, локальный dev) |
| `PostgreSQL initialization failed` | БД не поднялась/не доступна — проверь `sovetnik-db` контейнер |
| `Redis initialization failed` | Redis недоступен — транскрибация отключится, остальное живо |
| `Bot launch attempt N/5 failed` | Telegraf не может стартовать polling, чаще всего прокси/токен |

### 3. Healthcheck HTTP-сервера (не зависит от прокси)

```bash
ssh root@217.199.254.38 "docker exec <bot-container-name> curl -sf http://localhost:18790/health && echo OK || echo FAIL"
```

Если `OK` но бот не отвечает в Telegram — проблема именно в long polling / прокси, а не в самом процессе.

### 4. Текущие env-переменные на проде (без секретов)

```bash
ssh root@217.199.254.38 "docker inspect <bot-container-name> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^(TELEGRAM_PROXY|WEBAPP_URL|DATABASE_URL|REDIS_URL|DIGEST_CRON|DEFAULT_BOT_MODE|LOG_LEVEL)='"
```

Полезно убедиться, что переменная действительно применилась после изменения в Dokploy UI.

### 5. Если стек не запущен

```bash
ssh root@217.199.254.38 "cd /etc/dokploy/projects && find . -name docker-compose.yml | grep -i calendar"
ssh root@217.199.254.38 "docker ps -a --format '{{.Names}}\t{{.Status}}' | grep calendarvoiceplanner"
```

`docker ps -a` покажет «мертвые» контейнеры с причиной (Exited, OOMKilled и т.д.). Дальше — Dokploy UI для рестарта.

### 6. Краткий отчёт пользователю

После всех проверок дай короткий итог:
- ✅/❌ контейнеры
- ✅/❌ long polling (`Bot started`)
- ✅/❌ HTTP healthcheck
- Конкретная ошибка из логов, если есть
- Рекомендация: что менять (прокси, env, рестарт)

Не вываливай 200 строк логов в чат — выбери релевантные. Полный лог упомяни и сохрани отдельным сообщением только если пользователь попросит.

## Что НЕ делать

- Не рестарти контейнеры без явного разрешения (`docker restart`, `docker compose down/up`) — это destructive action на проде.
- Не меняй env через `docker exec` — это не переживёт пересоздание; только через Dokploy UI.
- Не коммить `expert_info/ssh_access` и не показывай пароль/ключ в ответах пользователю.
