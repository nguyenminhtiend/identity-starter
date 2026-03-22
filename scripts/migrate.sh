#!/bin/sh
set -e

echo "Running database migrations..."

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is required"
  exit 1
fi

# Run Drizzle migrations from the packages/db directory
# (migrate.js uses relative path './drizzle' for migration files)
cd /app/packages/db
node dist/migrate.js

echo "Migrations complete."
