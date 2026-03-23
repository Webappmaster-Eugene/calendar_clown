#!/bin/bash
# Fix PostgreSQL password mismatch when pgdata volume was initialized
# with a different password than the current DB_PASSWORD.
#
# Usage (run on the server where docker-compose is running):
#   ./scripts/fix-db-password.sh [new_password]
#
# If no password is given, reads DB_PASSWORD from .env or prompts.

set -euo pipefail

COMPOSE_FILE="docker-compose.yml"

# Determine project directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: $COMPOSE_FILE not found in $PROJECT_DIR"
  exit 1
fi

# Get the desired password
if [ -n "${1:-}" ]; then
  NEW_PASSWORD="$1"
elif [ -n "${DB_PASSWORD:-}" ]; then
  NEW_PASSWORD="$DB_PASSWORD"
elif [ -f .env ]; then
  NEW_PASSWORD=$(grep -E '^DB_PASSWORD=' .env | cut -d= -f2- | tr -d "'\"")
fi

if [ -z "${NEW_PASSWORD:-}" ]; then
  echo "Error: No password provided."
  echo "Usage: $0 <password>  OR  set DB_PASSWORD in .env"
  exit 1
fi

echo "Resetting PostgreSQL password for user 'bot'..."

# Find the db container name
DB_CONTAINER=$(docker compose ps -q db 2>/dev/null || docker-compose ps -q db 2>/dev/null)

if [ -z "$DB_CONTAINER" ]; then
  echo "Error: db container is not running. Start it first: docker compose up -d db"
  exit 1
fi

# Use local socket to bypass password authentication
docker exec "$DB_CONTAINER" psql -U bot -d expenses_bot --host=/var/run/postgresql \
  -c "ALTER USER bot WITH PASSWORD '${NEW_PASSWORD}';"

echo "Password updated successfully."
echo ""
echo "Now restart the bot container to pick up the connection:"
echo "  docker compose restart bot"
