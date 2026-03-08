#!/bin/bash
# Проверка готовности VDS для бота (десятки пользователей, свои календари).
# Запуск на сервере: после ssh root@<host> выполнить:
#   cd /opt/telegram-calendar-bot && bash scripts/check-vds.sh

set -e
DEPLOY_PATH="${DEPLOY_PATH:-/opt/telegram-calendar-bot}"
cd "$DEPLOY_PATH"
ERR=0

echo "=== Проверка окружения ==="
command -v node >/dev/null 2>&1 || { echo "ОШИБКА: node не найден. Установите Node.js 18+."; ERR=1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "ОШИБКА: ffmpeg не найден. Нужен для голоса: apt install ffmpeg"; ERR=1; }
NODE_V=$(node -v 2>/dev/null | sed 's/v//;s/\..*//') || true
if [ -n "$NODE_V" ] && [ "$NODE_V" -lt 18 ]; then
  echo "ОШИБКА: Node.js 18+ нужен, установлен: $(node -v)"; ERR=1
else
  echo "  Node: $(node -v)"
  echo "  ffmpeg: $(ffmpeg -version 2>/dev/null | head -1 || echo 'не найден')"
fi

echo ""
echo "=== Каталоги и права ==="
if [ ! -d "dist" ]; then echo "ОШИБКА: нет dist/. Выполните npm run build."; ERR=1; fi
mkdir -p data/tokens data/voice
if [ ! -w "data" ]; then echo "ОШИБКА: data/ не доступен для записи."; ERR=1; fi
if [ ! -w "data/tokens" ]; then echo "ОШИБКА: data/tokens/ не доступен для записи."; ERR=1; fi
echo "  data/tokens: готов для токенов пользователей"
echo "  data/voice: готов для временных голосовых файлов"

echo ""
echo "=== .env ==="
if [ ! -f ".env" ]; then
  echo "ОШИБКА: .env отсутствует. Должен создаваться при деплое из секретов GitHub."
  ERR=1
else
  for key in TELEGRAM_BOT_TOKEN GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET OPENROUTER_API_KEY; do
    if ! grep -q "^${key}=" .env 2>/dev/null; then
      echo "  ОШИБКА: в .env нет $key"; ERR=1
    fi
  done
  [ $ERR -eq 0 ] && echo "  Все нужные переменные заданы в .env"
fi

echo ""
echo "=== Сервис (systemd) ==="
if systemctl is-enabled telegram-calendar-bot >/dev/null 2>&1; then
  echo "  telegram-calendar-bot: включён в автозагрузку"
else
  echo "  ПРЕДУПРЕЖДЕНИЕ: сервис telegram-calendar-bot не включён (systemctl enable telegram-calendar-bot)"
fi
if systemctl is-active telegram-calendar-bot >/dev/null 2>&1; then
  echo "  Статус: активен"
else
  echo "  ОШИБКА: сервис не запущен. systemctl start telegram-calendar-bot"
  ERR=1
fi

echo ""
if [ $ERR -eq 0 ]; then
  echo "Готово к работе. Каждый пользователь: /start → привязать календарь по ссылке → /auth <код>."
else
  echo "Исправьте ошибки выше."
  exit 1
fi
