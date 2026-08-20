#!/usr/bin/env bash
# Установка канала sovetnik на машину: сборка, регистрация MCP-сервера
# на уровне пользователя и алиас ccx для запуска сессий с включённым каналом.
#
#   CC_HUB_URL=https://oauth.podbor-minuta.ru CC_MACHINE_TOKEN=... CC_MACHINE=mbp ./install.sh
#
# Повторный запуск идемпотентен: перерегистрирует сервер с новыми значениями.

set -euo pipefail

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }

HUB="${CC_HUB_URL:-}"
TOKEN="${CC_MACHINE_TOKEN:-}"
MACHINE="${CC_MACHINE:-$(hostname -s 2>/dev/null || hostname)}"

[ -n "$HUB" ]   || die "CC_HUB_URL не задан (например https://oauth.podbor-minuta.ru)"
[ -n "$TOKEN" ] || die "CC_MACHINE_TOKEN не задан — должен совпадать с переменной на сервере бота"
command -v node >/dev/null || die "node не найден"
command -v claude >/dev/null || die "claude не найден в PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

ok "сборка канала"
npm install --silent
npm run build --silent
ENTRY="$ROOT/dist/index.js"
[ -f "$ENTRY" ] || die "сборка не создала $ENTRY"

# Уровень user, а не project: канал должен подниматься в любом проекте.
claude mcp remove sovetnik --scope user >/dev/null 2>&1 || true
claude mcp add sovetnik \
  --scope user \
  -e "CC_HUB_URL=$HUB" \
  -e "CC_MACHINE_TOKEN=$TOKEN" \
  -e "CC_MACHINE=$MACHINE" \
  -- node "$ENTRY"
ok "MCP-сервер sovetnik зарегистрирован (machine: $MACHINE)"

cat <<'EOF'

Осталось добавить алиас в ~/.zshrc:

  alias ccx='claude --dangerously-load-development-channels server:sovetnik'

Флаг обязателен: кастомные каналы вне allowlist Anthropic на время
research preview. При первом запуске Claude Code спросит подтверждение.

Дальше запускай сессии как ccx вместо claude — в супергруппе появится
топик "<машина> · <проект>".
EOF
