#!/bin/sh
set -e

echo "Seeding database..."

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is required"
  exit 1
fi

cd /app/packages/db
node dist/seed.js
