# Проверка OpenClaw на VDS и порт 18789

Бот (systemd) и OpenClaw Gateway (Docker) работают на одном сервере. Бот обращается к OpenClaw по `http://127.0.0.1:18789` (localhost). **Доступ из интернета к порту 18789 для работы Telegram не нужен.**

## Быстрая проверка (скрипт)

После входа на VDS:

```bash
cd /opt/telegram-calendar-bot && bash scripts/check-openclaw-vds.sh
```

Скрипт проверяет: наличие `OPENCLAW_GATEWAY_TOKEN` в `.env`, статус контейнера `openclaw-gateway`, слушается ли порт 18789, отвечает ли `curl http://127.0.0.1:18789/`.

Опция **`--open-port`** — добавить правило UFW для входящего TCP 18789 (только если нужен доступ к OpenClaw снаружи, например для отладки):

```bash
bash scripts/check-openclaw-vds.sh --open-port
```

## Ручная проверка

```bash
cd /opt/telegram-calendar-bot

# Контейнер
docker compose --profile openclaw ps

# Порт на хосте
ss -tlnp | grep 18789

# Ответ порта
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18789/
```

Если контейнера нет или статус Exited — поднять:

```bash
grep -q '^OPENCLAW_GATEWAY_TOKEN=' .env && docker compose --profile openclaw up -d --build
```

## Проверка с токеном (chat completions)

Токен взять из `.env` на сервере (`OPENCLAW_GATEWAY_TOKEN`):

```bash
TOKEN="значение_из_env"
curl -s -X POST http://127.0.0.1:18789/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"openclaw","messages":[{"role":"user","content":"Hi"}]}' | head -c 500
```

Ожидается JSON с ответом модели или ошибкой авторизации/модели, но не «connection refused».

## Если контейнер падает

Логи:

```bash
docker compose --profile openclaw logs -f openclaw-gateway
```

Проверить: есть ли `config/openclaw-gateway.json` на сервере, задан ли в `.env` `OPENCLAW_GATEWAY_TOKEN`.

## Открытие порта на VDS (по желанию)

Только если нужен доступ к OpenClaw **снаружи** (для бота не обязательно).

**UFW:**

```bash
sudo ufw allow 18789/tcp
sudo ufw reload
sudo ufw status
```

**iptables (если не используете UFW):**

```bash
sudo iptables -A INPUT -p tcp --dport 18789 -j ACCEPT
# Сохранение правил зависит от О (например: sudo netfilter-persistent save)
```

После этого доступ снаружи: `http://<IP_VDS>:18789`. С точки зрения безопасности порт лучше не открывать, если внешний доступ не нужен.
