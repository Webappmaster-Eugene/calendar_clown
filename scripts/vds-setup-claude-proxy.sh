#!/bin/bash
# Установка и настройка Squid на VDS как CONNECT-прокси только для localhost.
# Используется для пайплайна: Claude Code (локально) → SSH-туннель → этот прокси → VPN (UK) → api.anthropic.com
# Запуск на VDS: bash scripts/vds-setup-claude-proxy.sh (от root или через sudo)

set -e

SQUID_CONF="/etc/squid/squid.conf"
SQUID_CONF_BAK="/etc/squid/squid.conf.bak.$(date +%Y%m%d%H%M%S)"
CACHE_DIR="/var/spool/squid"

echo "=== VDS Claude proxy setup (Squid, localhost only) ==="

# Проверка root
if [ "$(id -u)" -ne 0 ]; then
  echo "Запустите скрипт от root или через sudo."
  exit 1
fi

# Определение пакетного менеджера
if command -v apt-get >/dev/null 2>&1; then
  INSTALL_CMD="apt-get install -y"
  UPDATE_CMD="apt-get update"
elif command -v yum >/dev/null 2>&1; then
  INSTALL_CMD="yum install -y"
  UPDATE_CMD="true"
else
  echo "Поддерживаются только apt-get (Debian/Ubuntu) и yum. Установите Squid вручную и настройте конфиг."
  exit 1
fi

# Установка Squid
if ! command -v squid >/dev/null 2>&1; then
  echo "Установка Squid..."
  $UPDATE_CMD
  $INSTALL_CMD squid
else
  echo "Squid уже установлен: $(squid -v | head -1)"
fi

# Бэкап конфига
if [ -f "$SQUID_CONF" ]; then
  cp "$SQUID_CONF" "$SQUID_CONF_BAK"
  echo "Бэкап конфига: $SQUID_CONF_BAK"
fi

# Минимальный конфиг: только 127.0.0.1:3128, доступ только с localhost
# CONNECT для HTTPS (порт 443/8443) — достаточно для api.anthropic.com
cat > "$SQUID_CONF" << 'EOF'
# Claude proxy: localhost only, CONNECT to HTTPS (api.anthropic.com)
acl localhost src 127.0.0.1
acl SSL_ports port 443
acl SSL_ports port 8443
acl CONNECT method CONNECT
http_access allow localhost
http_access deny all
http_port 127.0.0.1:3128
cache_dir ufs /var/spool/squid 64 16 256
coredump_dir /var/spool/squid
EOF

# Создание кэш-директории (Squid не всегда создаёт при первом запуске)
if [ ! -d "$CACHE_DIR" ]; then
  mkdir -p "$CACHE_DIR"
  chown proxy:proxy "$CACHE_DIR" 2>/dev/null || chown squid:squid "$CACHE_DIR" 2>/dev/null || true
fi

# Инициализация кэша (squid -z), если ещё не инициализирован
if [ ! -d "$CACHE_DIR/00" ]; then
  echo "Инициализация кэша Squid..."
  squid -z 2>/dev/null || true
  chown -R proxy:proxy "$CACHE_DIR" 2>/dev/null || chown -R squid:squid "$CACHE_DIR" 2>/dev/null || true
fi

# Перезапуск и автозапуск
echo "Перезапуск Squid..."
systemctl restart squid
systemctl enable squid

echo ""
echo "Готово. Прокси слушает 127.0.0.1:3128 (только localhost)."
echo "Локально поднимите SSH-туннель и задайте HTTPS_PROXY: см. docs/VDS_CLAUDE_PROXY_SETUP.md"
echo ""
echo "Проверка на VDS: curl -x http://127.0.0.1:3128 -sI https://api.anthropic.com"
