#!/bin/bash
# Ensure Let's Encrypt cert for oauth.podbor-minuta.ru and start nginx (OAuth callback).
# Run from DEPLOY_PATH (where docker-compose.yml and .env are). Idempotent.
set -e

DEPLOY_PATH="${DEPLOY_PATH:-.}"
cd "$DEPLOY_PATH"

if [ ! -f "docker-compose.yml" ] || [ ! -f ".env" ]; then
  echo "ensure-oauth-ssl: docker-compose.yml or .env missing, skipping OAuth stack."
  exit 0
fi

# If OAUTH_REDIRECT_URI is not set, skip (OAuth not used).
if ! grep -q '^OAUTH_REDIRECT_URI=' .env 2>/dev/null; then
  echo "ensure-oauth-ssl: OAUTH_REDIRECT_URI not set, skipping."
  exit 0
fi

# Stop nginx so certbot can bind to port 80 if we need to run it.
docker compose --profile oauth stop nginx 2>/dev/null || true

# Check if cert already exists in volume (certbot stores in certbot_etc).
CERT_EXISTS=$(docker compose --profile oauth run --rm -T certbot certificates 2>/dev/null | grep -c "oauth.podbor-minuta.ru" || true)
if [ "${CERT_EXISTS:-0}" -eq 0 ]; then
  echo "ensure-oauth-ssl: no cert found, running certbot..."
  if ! docker compose --profile oauth run --rm certbot; then
    echo "ensure-oauth-ssl: certbot failed (check DNS and port 80). nginx not started."
    exit 0
  fi
fi

docker compose --profile oauth up -d nginx
echo "ensure-oauth-ssl: nginx started."
