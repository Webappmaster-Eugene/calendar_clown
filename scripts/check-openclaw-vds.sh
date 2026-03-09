#!/bin/bash
# Проверка работы OpenClaw Gateway на VDS (порт 18789, Docker).
# Запуск на сервере: cd /opt/telegram-calendar-bot && bash scripts/check-openclaw-vds.sh
# Опция: --open-port — разрешить входящий TCP 18789 в UFW (только если нужен доступ снаружи; для бота не требуется).

set -e
DEPLOY_PATH="${DEPLOY_PATH:-/opt/telegram-calendar-bot}"
cd "$DEPLOY_PATH"
ERR=0
OPEN_PORT=""

for arg in "$@"; do
  case "$arg" in
    --open-port) OPEN_PORT=1 ;;
  esac
done

echo "=== OpenClaw Gateway (порт 18789) ==="
if ! grep -q '^OPENCLAW_GATEWAY_TOKEN=' .env 2>/dev/null; then
  echo "  Пропуск: в .env нет OPENCLAW_GATEWAY_TOKEN. OpenClaw при деплое не поднимается."
  exit 0
fi

echo ""
echo "=== Контейнер ==="
if docker compose --profile openclaw ps 2>/dev/null | grep -q openclaw-gateway; then
  docker compose --profile openclaw ps
  echo "  Контейнер openclaw-gateway: есть в выводе выше (ожидается Up)"
else
  echo "  ОШИБКА: контейнер openclaw-gateway не найден или не запущен."
  echo "  Поднять: docker compose --profile openclaw up -d --build"
  ERR=1
fi

echo ""
echo "=== Порт 18789 ==="
if ss -tlnp 2>/dev/null | grep -q 18789; then
  echo "  Порт 18789 слушается на хосте."
  ss -tlnp | grep 18789 || true
else
  echo "  ОШИБКА: порт 18789 не слушается. Запустите контейнер (см. выше)."
  ERR=1
fi

echo ""
echo "=== HTTP проверка (localhost) ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18789/ 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "000" ]; then
  echo "  ОШИБКА: curl к http://127.0.0.1:18789/ не удался (connection refused или таймаут)."
  ERR=1
else
  echo "  curl http://127.0.0.1:18789/ → HTTP $HTTP_CODE (404 или другой код — нормально, главное что порт отвечает)."
fi

if [ -n "$OPEN_PORT" ]; then
  echo ""
  echo "=== Открытие порта 18789 в UFW (доступ снаружи) ==="
  if command -v ufw >/dev/null 2>&1; then
    sudo ufw allow 18789/tcp
    sudo ufw reload
    echo "  Правило добавлено. Проверка: sudo ufw status"
  else
    echo "  ПРЕДУПРЕЖДЕНИЕ: ufw не найден. Откройте порт вручную (iptables и т.д.)."
  fi
fi

echo ""
if [ $ERR -eq 0 ]; then
  echo "OpenClaw на VDS доступен по localhost:18789. Бот подключается к нему по 127.0.0.1 — порт наружу открывать не обязательно."
else
  echo "Исправьте ошибки выше. Логи контейнера: docker compose --profile openclaw logs -f openclaw-gateway"
  exit 1
fi
