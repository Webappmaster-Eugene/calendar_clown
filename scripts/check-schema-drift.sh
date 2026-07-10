#!/usr/bin/env bash
#
# Schema-drift guard. Fails if:
#   1. the migration journal/snapshots are internally inconsistent, or
#   2. src/db/schema.ts has changes not captured in a migration (someone edited
#      the schema but forgot `npm run db:generate`).
#
# This is what prevents the stale-snapshot drift that this whole DB overhaul fixed.
# Needs no database — a dummy DATABASE_URL satisfies the drizzle.config.ts parse.
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgres://schema-drift-check-unused}"

echo "→ drizzle-kit check (journal/snapshot consistency)"
npx drizzle-kit check

echo "→ schema.ts vs migrations (no un-generated changes)"
# Generate into a throwaway copy so the real drizzle/ is never mutated.
# Must be a project-RELATIVE path: drizzle-kit prepends "./" to --out, which
# breaks for absolute paths (".//var/...").
tmp=".drift-check-tmp-$$"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp"
cp -R drizzle/. "$tmp/"
# --out overrides the config, which then drops schema/dialect — pass them explicitly.
out="$(npx drizzle-kit generate --dialect=postgresql --schema=./src/db/schema.ts --out="$tmp" --name=__drift_check__ </dev/null 2>&1 || true)"

if echo "$out" | grep -q "No schema changes"; then
  echo "✓ schema.ts is in sync with migrations — no drift"
else
  echo "✗ DRIFT: src/db/schema.ts has changes not in any migration."
  echo "  Run: npm run db:generate -- --name=<descriptive_name>"
  echo "---"
  echo "$out" | tail -25
  exit 1
fi
