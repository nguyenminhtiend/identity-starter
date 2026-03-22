#!/bin/bash
set -euo pipefail

COMPOSE_FILE="docker-compose.e2e.yml"
PROJECT="identity-e2e"

echo "=== E2E Test Suite ==="
echo ""

cleanup() {
  echo ""
  echo "Tearing down..."
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down -v 2>/dev/null || true
}
trap cleanup EXIT

echo "Cleaning up previous run..."
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down -v 2>/dev/null || true

echo "Building and starting stack..."
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up --build -d --wait

echo "Seeding test data..."
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --profile seed run --rm seed

echo "Running E2E tests..."
echo ""
pnpm --filter @identity-starter/e2e test

echo ""
echo "=== E2E tests passed ==="
