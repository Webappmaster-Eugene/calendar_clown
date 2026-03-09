#!/usr/bin/env bash
# Запуск Claude Code локально с использованием VDS (прокси через туннель).
# 1) Поднимает SSH-туннель, если ещё не поднят.
# 2) Выставляет HTTP_PROXY/HTTPS_PROXY и запускает claude.
# Переменные: SSH_HOST, SSH_USER из .env.local; команда claude должна быть в PATH.

set -e
PROXY_PORT="${PROXY_PORT:-3128}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Подгрузить .env.local
if [ -f "$PROJECT_ROOT/.env.local" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$PROJECT_ROOT/.env.local"
  set +a
fi

# Поднять туннель при необходимости
"$SCRIPT_DIR/claude-vds-tunnel.sh"

export HTTP_PROXY="http://127.0.0.1:${PROXY_PORT}"
export HTTPS_PROXY="http://127.0.0.1:${PROXY_PORT}"
export NO_PROXY="localhost,127.0.0.1"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code не найден в PATH. Установите: https://docs.anthropic.com/en/docs/claude-code/setup" >&2
  exit 1
fi

exec claude "$@"
