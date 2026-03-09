#!/usr/bin/env bash
# Запуск SSH-туннеля к прокси на VDS (127.0.0.1:3128 → VDS:3128).
# Если туннель уже поднят (порт 3128 занят), ничего не делает.
# Переменные: SSH_HOST, SSH_USER (или из .env.local в корне проекта).
# Запуск при логине: см. config/claude-vds-tunnel.plist (LaunchAgent).

set -e
PROXY_PORT="${PROXY_PORT:-3128}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Подгрузить SSH_HOST, SSH_USER из .env.local
if [ -f "$PROJECT_ROOT/.env.local" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$PROJECT_ROOT/.env.local"
  set +a
fi

if [ -z "$SSH_HOST" ] || [ -z "$SSH_USER" ]; then
  echo "Задайте SSH_HOST и SSH_USER (в .env.local или в окружении)." >&2
  exit 1
fi

# Для LaunchAgent: держать туннель в foreground (RUN_FOREGROUND=1 или --foreground)
FOREGROUND=
[ "$RUN_FOREGROUND" = "1" ] || [ "${1:-}" = "--foreground" ] && FOREGROUND=1

# Туннель уже поднят? (в foreground-режиме не проверяем — launchd перезапустит при конфликте)
if [ -z "$FOREGROUND" ]; then
  if command -v nc >/dev/null 2>&1; then
    if nc -z 127.0.0.1 "$PROXY_PORT" 2>/dev/null; then
      echo "Туннель уже активен (127.0.0.1:$PROXY_PORT)."
      exit 0
    fi
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -i ":$PROXY_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "Туннель уже активен (порт $PROXY_PORT)."
      exit 0
    fi
  fi
fi

SSH_OPTS=(-o ConnectTimeout=15 -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes)
echo "Поднимаю SSH-туннель к $SSH_USER@$SSH_HOST (порт $PROXY_PORT)..."
if [ -n "$FOREGROUND" ]; then
  exec ssh -N "${SSH_OPTS[@]}" \
    -L "127.0.0.1:${PROXY_PORT}:127.0.0.1:3128" \
    "$SSH_USER@$SSH_HOST"
else
  ssh -f -N "${SSH_OPTS[@]}" \
    -L "127.0.0.1:${PROXY_PORT}:127.0.0.1:3128" \
    "$SSH_USER@$SSH_HOST"
  echo "Туннель поднят."
fi
