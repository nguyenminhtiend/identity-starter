#!/bin/sh
set -e

echo "Seeding E2E test data..."

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is required"
  exit 1
fi

cd /app/packages/db
node dist/seed-e2e.js

echo "Seed complete."
