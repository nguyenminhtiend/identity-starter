# Phase 8b: Docker & Compose

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Containerize the identity-starter server with a multi-stage Docker build, add docker-compose for local development, and create a migration init script for production deployments.

**Architecture:** Multi-stage Dockerfile (build → production) using node:24-slim. Production image runs as non-root `node` user. Migrations run as a separate init step before server starts. docker-compose orchestrates Postgres + Redis + server for local development.

**Tech Stack:** Docker (multi-stage), docker-compose, node:24-slim, pnpm

**Depends on:** Phase 8a (tsup build must be working)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `Dockerfile` | Create | Multi-stage build for production server image |
| `.dockerignore` | Create | Exclude unnecessary files from Docker context |
| `docker-compose.yml` | Create | Full local dev stack (Postgres + Redis + server) |
| `scripts/migrate.sh` | Create | Migration entrypoint script for init container |
| `apps/server/package.json` | Modify | Add `start:migrate` script |
| `apps/server/src/app.ts` | Modify | Enhance /health endpoint with DB/Redis checks |

---

### Task 1: Create .dockerignore

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

Create `.dockerignore` at project root:

```
node_modules
.git
.github
dist
*.md
!README.md
.env
.env.*
!.env.example
!.env.production.example
.turbo
.vscode
.idea
coverage
*.log
*.tsbuildinfo
apps/web
apps/admin
docs
lefthook.yml
biome.json
```

> **Key exclusions:** `node_modules` (reinstalled in Docker), `.git` (large, not needed), `apps/web`/`apps/admin` (frontend not in scope), `docs` (not needed in image).

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .dockerignore for optimized Docker context"
```

---

### Task 2: Create multi-stage Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create the Dockerfile**

Create `Dockerfile` at project root:

```dockerfile
# =============================================================================
# Stage 1: Install dependencies
# =============================================================================
FROM node:24-slim AS deps

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

# Copy workspace config files first (better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/redis/package.json ./packages/redis/
COPY packages/config/package.json ./packages/config/

# Install all dependencies (including dev for build step)
RUN pnpm install --frozen-lockfile

# =============================================================================
# Stage 2: Build
# =============================================================================
FROM deps AS build

# Copy source code
COPY packages/ ./packages/
COPY apps/server/ ./apps/server/
COPY turbo.json ./

# Build all packages (packages/* via tsc, server via tsup)
RUN pnpm turbo build

# Reinstall production dependencies only (pnpm prune is unreliable with workspaces)
RUN pnpm install --prod --frozen-lockfile

# =============================================================================
# Stage 3: Production
# =============================================================================
FROM node:24-slim AS production

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# Security: run as non-root
RUN groupadd --system appgroup && \
    useradd --system --gid appgroup --create-home appuser

WORKDIR /app

# Copy production node_modules from build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages/db/node_modules ./packages/db/node_modules

# Copy built server bundle
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/

# Copy migration files (needed for init container / migrate step)
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build /app/packages/db/package.json ./packages/db/

# Copy migration script
COPY scripts/migrate.sh ./scripts/

# Set ownership
RUN chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "apps/server/dist/server.js"]
```

> **Multi-stage rationale:**
> - **deps**: Installs all deps. Separate stage so package.json changes don't invalidate source code layer cache.
> - **build**: Copies source, runs turbo build, then prunes dev deps.
> - **production**: Minimal image with only production deps + built output.

> **Non-root user:** `appuser` with dedicated group. All app files owned by this user. Prevents container escape privilege escalation — critical for an IdP.

> **HEALTHCHECK:** Uses Node.js built-in `fetch()` (available in Node 24) to hit `/health`. No curl/wget needed in slim image.

- [ ] **Step 2: Build the Docker image**

```bash
docker build -t identity-starter:local .
```

Expected: Multi-stage build completes. Final image based on node:24-slim.

- [ ] **Step 3: Verify image size**

```bash
docker images identity-starter:local
```

Expected: Image size should be ~200-300MB (node:24-slim base + prod deps). Much smaller than a full node:24 image (~1GB).

- [ ] **Step 4: Test the image runs (will fail without DB, that's OK)**

```bash
docker run --rm -e DATABASE_URL=postgresql://test:test@host.docker.internal:5432/test identity-starter:local
```

Expected: Server attempts to start. May fail on DB connection — that's expected. Verify it doesn't fail on missing modules or permission errors.

- [ ] **Step 5: Verify non-root user**

```bash
docker run --rm --entrypoint sh identity-starter:local -c "whoami"
```

Expected: `appuser` (not `root`).

- [ ] **Step 6: Commit**

```bash
git add Dockerfile
git commit -m "feat(docker): add multi-stage Dockerfile with non-root user"
```

---

### Task 3: Create migration script

**Files:**
- Create: `scripts/migrate.sh`

- [ ] **Step 1: Create the migration entrypoint script**

Create `scripts/migrate.sh`:

```bash
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
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x scripts/migrate.sh
```

- [ ] **Step 3: Verify migration script works in Docker**

```bash
docker run --rm \
  -e DATABASE_URL=postgresql://admin:123456@host.docker.internal:5432/identity_start \
  --entrypoint sh \
  identity-starter:local \
  ./scripts/migrate.sh
```

Expected: "Running database migrations..." → "Migrations complete." (or connection error if DB is not running).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate.sh
git commit -m "feat(docker): add migration init script for production deployments"
```

---

### Task 4: Enhance /health endpoint

**Files:**
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Write a test for the health endpoint**

Create `apps/server/src/__tests__/health.integration.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createTestDb, type TestDb } from '../test/index.js';

describe('GET /health', () => {
  let testDb: TestDb;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildTestApp({ db: testDb.db });
  });

  afterAll(async () => {
    await app.close();
    await testDb.teardown();
  });

  it('should return status ok with database connectivity', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.checks).toHaveProperty('database');
    expect(body.checks.database).toBe('ok');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter server test:integration -- --grep "health"
```

Expected: FAIL — current /health endpoint returns `{ status: 'ok' }` without `checks` property.

- [ ] **Step 3: Enhance the /health endpoint in app.ts**

In `apps/server/src/app.ts`, replace the health endpoint:

```typescript
  app.get('/health', async (request) => {
    const checks: Record<string, string> = {};

    // Database check
    try {
      await request.server.container.db.execute(sql`SELECT 1`);
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }

    const status = Object.values(checks).every((v) => v === 'ok') ? 'ok' : 'degraded';

    return { status, checks };
  });
```

Also add the import at the top of `app.ts`:

```typescript
import { sql } from 'drizzle-orm';
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter server test:integration -- --grep "health"
```

Expected: PASS.

- [ ] **Step 5: Run all tests to verify no regressions**

```bash
pnpm --filter server test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/__tests__/health.integration.test.ts
git commit -m "feat(health): enhance /health endpoint with database connectivity check"
```

---

### Task 5: Create docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

Create `docker-compose.yml` at project root:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: "123456"
      POSTGRES_DB: identity_start
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U admin -d identity_start"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:8-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  migrate:
    build: .
    entrypoint: ["sh", "./scripts/migrate.sh"]
    environment:
      DATABASE_URL: postgresql://admin:123456@postgres:5432/identity_start
    depends_on:
      postgres:
        condition: service_healthy

  server:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOST: "0.0.0.0"
      DATABASE_URL: postgresql://admin:123456@postgres:5432/identity_start
      REDIS_URL: redis://redis:6379
      LOG_LEVEL: info
      WEBAUTHN_RP_NAME: Identity Starter
      WEBAUTHN_RP_ID: localhost
      WEBAUTHN_ORIGIN: http://localhost:3000
      JWT_ISSUER: http://localhost:3000
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""]
      interval: 10s
      timeout: 5s
      start_period: 15s
      retries: 3

volumes:
  pgdata:
  redisdata:
```

> **Key design decisions:**
> - **migrate** runs as a separate service with `service_completed_successfully` — init container pattern.
> - **postgres:17-alpine** — latest stable Postgres with minimal image.
> - **redis:8-alpine** — latest Redis with Alpine.
> - **Health checks** on all services ensure proper startup ordering.
> - **Named volumes** persist data across restarts.
> - **Server depends on migrate** — won't start until migrations complete.

- [ ] **Step 2: Test the full stack**

```bash
docker compose up --build
```

Expected: Postgres starts → Redis starts → migrations run → server starts. Health checks pass. Server accessible at `http://localhost:3000/health`.

- [ ] **Step 3: Verify health endpoint through Docker**

```bash
curl http://localhost:3000/health
```

Expected: `{"status":"ok","checks":{"database":"ok"}}`

- [ ] **Step 4: Tear down**

```bash
docker compose down
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(docker): add docker-compose with Postgres, Redis, and server"
```

---

### Task 6: Document dev vs full-stack compose usage

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add usage comments to docker-compose.yml header**

Add a comment block at the top of `docker-compose.yml`:

```yaml
# Local development:
#   docker compose up postgres redis       # Infra only (run server with: pnpm --filter server dev)
#   docker compose up                      # Full stack (Postgres + Redis + migrations + server)
```

> No override file needed — `docker compose up postgres redis` selectively starts only infra services out of the box.

- [ ] **Step 2: Test infra-only mode**

```bash
docker compose up postgres redis -d
```

Expected: Postgres and Redis start. Server does NOT start.

```bash
pnpm --filter server dev
```

Expected: Server starts locally, connects to Dockerized Postgres and Redis.

- [ ] **Step 4: Tear down**

```bash
docker compose down
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "docs(docker): add usage comments for dev vs full-stack compose"
```

---

## Completion Criteria

- [ ] `docker build -t identity-starter:local .` builds successfully
- [ ] Docker image runs as non-root `appuser`
- [ ] Docker image size is under 400MB
- [ ] `docker compose up` starts Postgres → Redis → migrations → server
- [ ] `docker compose up postgres redis` works for local dev
- [ ] `/health` returns database connectivity status
- [ ] Migration init container runs before server starts
- [ ] `scripts/migrate.sh` works standalone and in Docker
- [ ] All existing tests pass
