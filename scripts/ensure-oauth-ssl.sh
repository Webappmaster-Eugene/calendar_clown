#!/bin/bash
# Ensure Let's Encrypt cert for OAuth domain and configure nginx.
# Uses host certbot and nginx (no Docker). Idempotent.
set -e

DEPLOY_PATH="${DEPLOY_PATH:-.}"
cd "$DEPLOY_PATH"

if [ ! -f ".env" ]; then
  echo "ensure-oauth-ssl: .env missing, skipping OAuth SSL."
  exit 0
fi

# Read OAUTH_REDIRECT_URI from .env
OAUTH_REDIRECT_URI=$(grep '^OAUTH_REDIRECT_URI=' .env 2>/dev/null | head -1 | cut -d= -f2-)
if [ -z "$OAUTH_REDIRECT_URI" ]; then
  echo "ensure-oauth-ssl: OAUTH_REDIRECT_URI not set, skipping."
  exit 0
fi

# Extract domain from URI
DOMAIN=$(echo "$OAUTH_REDIRECT_URI" | sed -E 's|https?://([^/:]+).*|\1|')
if [ -z "$DOMAIN" ]; then
  echo "ensure-oauth-ssl: could not extract domain from OAUTH_REDIRECT_URI."
  exit 1
fi

echo "ensure-oauth-ssl: domain=$DOMAIN"

# Check if certbot and nginx are available
if ! command -v certbot >/dev/null 2>&1 || ! command -v nginx >/dev/null 2>&1; then
  echo "ensure-oauth-ssl: certbot or nginx not installed. Run scripts/bootstrap-vds.sh first."
  exit 1
fi

# Read CERTBOT_EMAIL from .env (optional)
CERTBOT_EMAIL=$(grep '^CERTBOT_EMAIL=' .env 2>/dev/null | head -1 | cut -d= -f2-)

# Install nginx config from template
NGINX_CONF="/etc/nginx/sites-available/telegram-calendar-bot"
if [ -f "config/nginx-oauth.podbor-minuta.ru.conf" ]; then
  sed "s/oauth\\.podbor-minuta\\.ru/$DOMAIN/g" config/nginx-oauth.podbor-minuta.ru.conf > "$NGINX_CONF"
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/telegram-calendar-bot
  echo "ensure-oauth-ssl: nginx config installed for $DOMAIN."
fi

# Get certificate if not exists
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
if [ ! -d "$CERT_DIR" ]; then
  echo "ensure-oauth-ssl: no cert found for $DOMAIN, running certbot..."
  # Stop nginx temporarily so certbot can bind to port 80
  systemctl stop nginx 2>/dev/null || true

  EMAIL_FLAG=""
  if [ -n "$CERTBOT_EMAIL" ]; then
    EMAIL_FLAG="-m $CERTBOT_EMAIL"
  else
    EMAIL_FLAG="--register-unsafely-without-email"
  fi

  if ! certbot certonly --standalone -d "$DOMAIN" $EMAIL_FLAG --agree-tos --non-interactive; then
    echo "ensure-oauth-ssl: certbot failed (check DNS and port 80). Starting nginx without SSL."
    nginx -t 2>/dev/null && systemctl start nginx || true
    exit 0
  fi
  echo "ensure-oauth-ssl: certificate obtained."
fi

# Ensure nginx config references the correct cert paths
if [ -f "$NGINX_CONF" ]; then
  sed -i "s|/etc/letsencrypt/live/[^/]*/|/etc/letsencrypt/live/$DOMAIN/|g" "$NGINX_CONF"
fi

# Test and start/reload nginx
if nginx -t 2>/dev/null; then
  systemctl start nginx 2>/dev/null || systemctl reload nginx
  echo "ensure-oauth-ssl: nginx started/reloaded."
else
  echo "ensure-oauth-ssl: nginx config test failed. Check $NGINX_CONF."
  exit 1
fi
