#!/bin/bash
# Bootstrap VDS for telegram-calendar-bot: install Node.js 20, ffmpeg, nginx, certbot.
# Idempotent — safe to run multiple times. Designed for Debian/Ubuntu.
set -e

DEPLOY_PATH="${DEPLOY_PATH:-/opt/telegram-calendar-bot}"

echo "=== Bootstrap VDS ==="

# Node.js 20 (via NodeSource)
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 20 ]; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "Node.js $(node -v) already installed."
fi

# ffmpeg (for voice messages)
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Installing ffmpeg..."
  apt-get install -y ffmpeg
else
  echo "ffmpeg already installed."
fi

# nginx
if ! command -v nginx >/dev/null 2>&1; then
  echo "Installing nginx..."
  apt-get install -y nginx
else
  echo "nginx already installed."
fi

# certbot
if ! command -v certbot >/dev/null 2>&1; then
  echo "Installing certbot..."
  apt-get install -y certbot python3-certbot-nginx
else
  echo "certbot already installed."
fi

# Create directories
mkdir -p "$DEPLOY_PATH/data/tokens" "$DEPLOY_PATH/data/voice"

# systemd service
SERVICE_FILE="/etc/systemd/system/telegram-calendar-bot.service"
if [ ! -f "$SERVICE_FILE" ]; then
  echo "Creating systemd service..."
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Telegram Google Calendar Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=$DEPLOY_PATH
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=$DEPLOY_PATH/.env

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable telegram-calendar-bot
  echo "Service created and enabled."
else
  echo "systemd service already exists."
fi

echo "=== Bootstrap complete ==="
