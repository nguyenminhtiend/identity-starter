# Phase 9: E2E Production Tests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Black-box E2E tests that hit the production Docker stack via real HTTP, validating that the built bundle works end-to-end with real Postgres — covering auth, MFA, OAuth2/OIDC, admin, audit, and account management workflows.

**Architecture:** `docker-compose.e2e.yml` spins up Postgres (internal only) + migrate init container + production server on port 3001. A Drizzle seed script creates an admin user inside the Docker network. Vitest E2E tests run from the host, hitting `http://localhost:3001` with `fetch()`. Sequential test files exercise full user journeys against a single production-like database.

**Tech Stack:** Docker Compose, Vitest, Node fetch API, jose (JWT verification), otpauth (TOTP), Drizzle ORM (seeding)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/server/src/core/env.ts` | Modify | Add `RATE_LIMIT_ENABLED` env var |
| `apps/server/src/app.ts` | Modify | Gate rate-limit registration on env var |
| `packages/db/package.json` | Modify | Add `@node-rs/argon2` devDependency |
| `packages/db/src/seed-e2e.ts` | Create | Drizzle seed: admin user + super_admin role |
| `scripts/seed-e2e.sh` | Create | Shell wrapper for seed in Docker |
| `Dockerfile` | Modify | Copy all scripts (not just migrate.sh) |
| `docker-compose.e2e.yml` | Create | E2E stack: Postgres + migrate + server + seed |
| `pnpm-workspace.yaml` | Modify | Add `e2e` workspace |
| `e2e/package.json` | Create | E2E workspace member |
| `e2e/tsconfig.json` | Create | TypeScript config for E2E |
| `e2e/vitest.config.ts` | Create | Vitest config: sequential, 60s timeouts |
| `e2e/src/helpers/http-client.ts` | Create | fetch() wrapper with base URL, auth, query params |
| `e2e/src/helpers/constants.ts` | Create | Known credentials, URLs |
| `e2e/src/helpers/crypto.ts` | Create | PKCE, Basic auth, TOTP helpers |
| `e2e/src/01-health-discovery.e2e.ts` | Create | Health + OIDC discovery tests |
| `e2e/src/02-auth-lifecycle.e2e.ts` | Create | register → verify → login → change pw → logout |
| `e2e/src/03-mfa-flow.e2e.ts` | Create | TOTP enroll → MFA login → recovery codes |
| `e2e/src/04-password-reset.e2e.ts` | Create | forgot → reset → old session invalid |
| `e2e/src/05-admin-operations.e2e.ts` | Create | user mgmt, roles, sessions, RBAC, audit |
| `e2e/src/06-oauth-flow.e2e.ts` | Create | Auth code + PKCE, refresh, introspect, PAR, etc. |
| `e2e/src/07-account-management.e2e.ts` | Create | profile, sessions, passkey options |
| `scripts/e2e.sh` | Create | Orchestration: up → seed → test → down |
| `package.json` (root) | Modify | Add `test:e2e` script |

---

### Task 1: Drizzle seed script

**Files:**
- Modify: `packages/db/package.json`
- Create: `packages/db/src/seed-e2e.ts`
- Create: `scripts/seed-e2e.sh`
- Modify: `Dockerfile`

- [ ] **Step 1: Add `@node-rs/argon2` to packages/db**

```bash
cd packages/db && pnpm add -D @node-rs/argon2
```

- [ ] **Step 2: Create the Drizzle seed script**

Create `packages/db/src/seed-e2e.ts`:

```typescript
import { Algorithm, hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { roles } from './schema/role.js';
import { userRoles } from './schema/user-role.js';
import { users } from './schema/user.js';

const ADMIN_EMAIL = 'admin@e2e.local';
const ADMIN_PASSWORD = 'Admin123!';

const url = process.env.DATABASE_URL;
if (!url) {
  // biome-ignore lint/suspicious/noConsole: CLI seed script
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

const passwordHash = await hash(ADMIN_PASSWORD, {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536,
  timeCost: 3,
  outputLen: 32,
  parallelism: 1,
});

const [adminUser] = await db
  .insert(users)
  .values({
    email: ADMIN_EMAIL,
    passwordHash,
    displayName: 'E2E Admin',
    status: 'active',
    emailVerified: true,
    isAdmin: true,
  })
  .onConflictDoNothing()
  .returning({ id: users.id });

if (adminUser) {
  const [superAdminRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, 'super_admin'))
    .limit(1);

  if (superAdminRole) {
    await db.insert(userRoles).values({
      userId: adminUser.id,
      roleId: superAdminRole.id,
      assignedBy: adminUser.id,
    }).onConflictDoNothing();

    // biome-ignore lint/suspicious/noConsole: CLI seed script
    console.log(`Seeded admin user: ${ADMIN_EMAIL} (super_admin)`);
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI seed script
    console.error('super_admin role not found — did the server start and seed roles?');
    await client.end();
    process.exit(1);
  }
} else {
  // biome-ignore lint/suspicious/noConsole: CLI seed script
  console.log('Admin user already exists, skipping');
}

await client.end();
// biome-ignore lint/suspicious/noConsole: CLI seed script
console.log('E2E seed complete.');
```

- [ ] **Step 3: Build packages/db and verify seed compiles**

```bash
cd packages/db && pnpm build
ls dist/seed-e2e.js
```

Expected: `dist/seed-e2e.js` exists alongside `dist/migrate.js`.

- [ ] **Step 4: Create shell wrapper**

Create `scripts/seed-e2e.sh`:

```bash
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
```

```bash
chmod +x scripts/seed-e2e.sh
```

- [ ] **Step 5: Update Dockerfile to copy all scripts**

In `Dockerfile`, replace:

```dockerfile
COPY scripts/migrate.sh ./scripts/
```

with:

```dockerfile
COPY scripts/ ./scripts/
```

- [ ] **Step 6: Verify Docker image builds with seed included**

```bash
docker build -t identity-starter:e2e-test .
docker run --rm --entrypoint ls identity-starter:e2e-test scripts/
```

Expected: Both `migrate.sh` and `seed-e2e.sh` listed.

- [ ] **Step 7: Commit**

```bash
git add packages/db/package.json packages/db/src/seed-e2e.ts scripts/seed-e2e.sh Dockerfile pnpm-lock.yaml
git commit -m "feat(e2e): add Drizzle seed script for E2E admin user"
```

---

### Task 2: Rate limit configuration + Docker Compose E2E stack

Production mode has strict per-route rate limits (register: 5/15min, login: 10/15min, forgot-password: 3/15min). The E2E suite makes ~7 register and ~10 login calls across all workflows — exceeding these limits from the same IP. We add an env var to disable rate limiting for E2E.

**Files:**
- Modify: `apps/server/src/core/env.ts`
- Modify: `apps/server/src/app.ts`
- Create: `docker-compose.e2e.yml`

- [ ] **Step 1: Add RATE_LIMIT_ENABLED env var**

In `apps/server/src/core/env.ts`, add to the `EnvSchema` object:

```typescript
RATE_LIMIT_ENABLED: z
  .enum(['true', 'false'])
  .default('true')
  .transform((v) => v === 'true'),
```

- [ ] **Step 2: Gate rate-limit registration on env var**

In `apps/server/src/app.ts`, replace:

```typescript
if (env.NODE_ENV !== 'test') {
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
}
```

with:

```typescript
if (env.NODE_ENV !== 'test' && env.RATE_LIMIT_ENABLED) {
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
}
```

> When the global rate-limit plugin is not registered, per-route `config: { rateLimit: ... }` options on auth/passkey/mfa routes are silently ignored — they're just metadata that the plugin would read. The OAuth routes register their own local rate-limit instance (`{ global: false }`), but OAuth token limits (60/min) are not a problem for E2E.

- [ ] **Step 3: Verify existing tests still pass**

```bash
pnpm --filter server test:unit
```

Expected: All unit tests pass (rate limit tests use their own Fastify instance).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/core/env.ts apps/server/src/app.ts
git commit -m "feat(server): make rate limiting configurable via RATE_LIMIT_ENABLED env var"
```

- [ ] **Step 5: Create docker-compose.e2e.yml**

Create `docker-compose.e2e.yml` at project root:

```yaml
# E2E test stack — ephemeral, no persistent volumes
# Usage: scripts/e2e.sh (automated) or manually:
#   docker compose -p identity-e2e -f docker-compose.e2e.yml up --build -d --wait
#   docker compose -p identity-e2e -f docker-compose.e2e.yml --profile seed run --rm seed
#   pnpm --filter @identity-starter/e2e test
#   docker compose -p identity-e2e -f docker-compose.e2e.yml down -v

services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: "123456"
      POSTGRES_DB: identity_start_e2e
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U admin -d identity_start_e2e"]
      interval: 5s
      timeout: 3s
      retries: 5

  migrate:
    build: .
    entrypoint: ["sh", "./scripts/migrate.sh"]
    environment:
      DATABASE_URL: postgresql://admin:123456@postgres:5432/identity_start_e2e
    depends_on:
      postgres:
        condition: service_healthy

  server:
    build: .
    ports:
      - "3001:3000"
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOST: "0.0.0.0"
      DATABASE_URL: postgresql://admin:123456@postgres:5432/identity_start_e2e
      LOG_LEVEL: info
      RATE_LIMIT_ENABLED: "false"
      WEBAUTHN_RP_NAME: Identity Starter E2E
      WEBAUTHN_RP_ID: localhost
      WEBAUTHN_ORIGIN: http://localhost:3001
      JWT_ISSUER: http://localhost:3001
      TOTP_ENCRYPTION_KEY: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
      COOKIE_SECRET: e2e-test-cookie-secret
    depends_on:
      postgres:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""]
      interval: 10s
      timeout: 5s
      start_period: 15s
      retries: 3

  seed:
    build: .
    entrypoint: ["sh", "./scripts/seed-e2e.sh"]
    environment:
      DATABASE_URL: postgresql://admin:123456@postgres:5432/identity_start_e2e
    depends_on:
      server:
        condition: service_healthy
    profiles:
      - seed
```

> **Key differences from dev compose:**
> - Postgres has NO port mapping (internal to Docker network only)
> - No Redis (not used by any feature yet)
> - No named volumes (ephemeral DB per run)
> - Server exposed on port 3001 (avoids conflict with dev on 3000)
> - `TOTP_ENCRYPTION_KEY` set (required for MFA tests)
> - `JWT_ISSUER` and `WEBAUTHN_ORIGIN` point to `localhost:3001`
> - `seed` service in a profile — only runs via `docker compose --profile seed run --rm seed`
> - Separate project name (`-p identity-e2e`) used in orchestration script

- [ ] **Step 6: Test the stack starts**

```bash
docker compose -p identity-e2e -f docker-compose.e2e.yml up --build -d --wait
```

Expected: Postgres starts → migrate runs → server starts and passes health check.

- [ ] **Step 7: Test the seed runs**

```bash
docker compose -p identity-e2e -f docker-compose.e2e.yml --profile seed run --rm seed
```

Expected: "Seeded admin user: admin@e2e.local (super_admin)" then "Seed complete."

- [ ] **Step 8: Verify server responds**

```bash
curl http://localhost:3001/health
```

Expected: `{"status":"ok","checks":{"database":"ok"}}`

- [ ] **Step 9: Tear down**

```bash
docker compose -p identity-e2e -f docker-compose.e2e.yml down -v
```

- [ ] **Step 10: Commit**

```bash
git add docker-compose.e2e.yml
git commit -m "feat(e2e): add Docker Compose stack for E2E testing"
```

---

### Task 3: E2E workspace and test configuration

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `e2e/package.json`
- Create: `e2e/tsconfig.json`
- Create: `e2e/vitest.config.ts`

- [ ] **Step 1: Add e2e to pnpm workspace**

In `pnpm-workspace.yaml`, add `e2e` to the packages list:

```yaml
packages:
  - apps/*
  - packages/*
  - e2e
```

- [ ] **Step 2: Create e2e/package.json**

Create `e2e/package.json`:

```json
{
  "name": "@identity-starter/e2e",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "jose": "^6.2.2",
    "otpauth": "^9.5.0",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 3: Create e2e/tsconfig.json**

Create `e2e/tsconfig.json`:

```json
{
  "extends": "../packages/config/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create e2e/vitest.config.ts**

Create `e2e/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});
```

> `fileParallelism: false` ensures numbered test files run sequentially. `testTimeout: 60_000` accounts for slower production-mode responses (argon2 hashing is heavier without test shortcuts).

- [ ] **Step 5: Install dependencies**

```bash
pnpm install
```

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml e2e/package.json e2e/tsconfig.json e2e/vitest.config.ts pnpm-lock.yaml
git commit -m "feat(e2e): scaffold E2E workspace with vitest config"
```

---

### Task 4: E2E test helpers

**Files:**
- Create: `e2e/src/helpers/constants.ts`
- Create: `e2e/src/helpers/http-client.ts`
- Create: `e2e/src/helpers/crypto.ts`

- [ ] **Step 1: Create constants**

Create `e2e/src/helpers/constants.ts`:

```typescript
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
export const ADMIN_EMAIL = 'admin@e2e.local';
export const ADMIN_PASSWORD = 'Admin123!';
export const TEST_PASSWORD = 'TestUser123!';
```

- [ ] **Step 2: Create HTTP client**

Create `e2e/src/helpers/http-client.ts`:

```typescript
import { BASE_URL } from './constants.js';

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  token?: string;
  query?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
}

async function request<T = unknown>(
  method: string,
  path: string,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  const url = new URL(path, BASE_URL);

  if (options?.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = { ...options?.headers };

  if (options?.body) {
    headers['content-type'] = 'application/json';
  }

  if (options?.token) {
    headers.authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual',
  });

  let data: T;
  const is3xx = response.status >= 300 && response.status < 400;
  if (response.status === 204 || is3xx) {
    data = null as T;
  } else {
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      data = (await response.json()) as T;
    } else {
      data = (await response.text()) as unknown as T;
    }
  }

  return { status: response.status, headers: response.headers, data };
}

export const api = {
  get: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('POST', path, opts),
  patch: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('PATCH', path, opts),
  put: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('PUT', path, opts),
  delete: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
};
```

> **`redirect: 'manual'`** — always inspect raw responses. OAuth consent returns 302 with Location header containing the auth code. Without this, fetch follows the redirect and we lose the code.

- [ ] **Step 3: Create crypto helpers**

Create `e2e/src/helpers/crypto.ts`:

```typescript
import { createHash, randomBytes } from 'node:crypto';

export function pkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export function codeFromLocation(location: string): string {
  const url = new URL(location);
  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error(`No code in Location: ${location}`);
  }
  return code;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}@e2e.test`;
}
```

- [ ] **Step 4: Verify helpers compile**

```bash
cd e2e && pnpm exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add e2e/src/helpers/
git commit -m "feat(e2e): add HTTP client, constants, and crypto helpers"
```

---

### Task 5: Health & Discovery E2E tests

**Files:**
- Create: `e2e/src/01-health-discovery.e2e.ts`

- [ ] **Step 1: Write the test file**

Create `e2e/src/01-health-discovery.e2e.ts`:

```typescript
import * as jose from 'jose';
import { api } from './helpers/http-client.js';

describe('Health & Discovery', () => {
  it('GET /health returns ok with database check', async () => {
    const res = await api.get<{ status: string; checks: { database: string } }>('/health');

    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
    expect(res.data.checks.database).toBe('ok');
  });

  it('GET /.well-known/openid-configuration returns valid OIDC metadata', async () => {
    const res = await api.get<{
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      userinfo_endpoint: string;
      jwks_uri: string;
      response_types_supported: string[];
      grant_types_supported: string[];
    }>('/.well-known/openid-configuration');

    expect(res.status).toBe(200);
    expect(res.data.issuer).toBe('http://localhost:3001');
    expect(res.data.authorization_endpoint).toContain('/oauth/authorize');
    expect(res.data.token_endpoint).toContain('/oauth/token');
    expect(res.data.userinfo_endpoint).toContain('/oauth/userinfo');
    expect(res.data.jwks_uri).toContain('/.well-known/jwks.json');
    expect(res.data.response_types_supported).toEqual(['code']);
    expect(res.data.grant_types_supported).toContain('authorization_code');
  });

  it('GET /.well-known/jwks.json returns RSA signing keys', async () => {
    const res = await api.get<{ keys: jose.JWK[] }>('/.well-known/jwks.json');

    expect(res.status).toBe(200);
    expect(res.data.keys.length).toBeGreaterThan(0);
    const rsa = res.data.keys.find((k) => k.kty === 'RSA');
    expect(rsa).toBeDefined();
    expect(rsa?.kid).toBeDefined();
    expect(rsa?.n).toBeDefined();
    expect(rsa?.e).toBeDefined();
  });
});
```

- [ ] **Step 2: Run E2E stack and test**

```bash
# Start stack (if not already running)
docker compose -p identity-e2e -f docker-compose.e2e.yml up --build -d --wait
docker compose -p identity-e2e -f docker-compose.e2e.yml --profile seed run --rm seed

# Run tests
pnpm --filter @identity-starter/e2e test
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/01-health-discovery.e2e.ts
git commit -m "test(e2e): add health and OIDC discovery tests"
```

---

### Task 6: Auth Lifecycle E2E tests

**Files:**
- Create: `e2e/src/02-auth-lifecycle.e2e.ts`

- [ ] **Step 1: Write the test file**

Create `e2e/src/02-auth-lifecycle.e2e.ts`:

```typescript
import { TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('Auth Lifecycle', () => {
  const email = uniqueEmail('auth');
  let sessionToken: string;
  let verificationToken: string;

  it('registers a new user', async () => {
    const res = await api.post<{
      token: string;
      verificationToken: string;
      user: { id: string; email: string; displayName: string };
    }>('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'Auth E2E User' },
    });

    expect(res.status).toBe(201);
    expect(res.data.token).toBeDefined();
    expect(res.data.verificationToken).toBeDefined();
    expect(res.data.user.email).toBe(email);
    sessionToken = res.data.token;
    verificationToken = res.data.verificationToken;
  });

  it('rejects duplicate registration', async () => {
    const res = await api.post('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'Dup' },
    });

    expect(res.status).toBe(409);
  });

  it('verifies email', async () => {
    const res = await api.post<{ message: string }>('/api/auth/verify-email', {
      body: { token: verificationToken },
    });

    expect(res.status).toBe(200);
    expect(res.data.message).toContain('verified');
  });

  it('logs in with verified credentials', async () => {
    const res = await api.post<{ token: string; user: { email: string } }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });

    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();
    sessionToken = res.data.token;
  });

  it('rejects login with wrong password', async () => {
    const res = await api.post('/api/auth/login', {
      body: { email, password: 'wrong-password-123' },
    });

    expect(res.status).toBe(401);
  });

  it('changes password', async () => {
    const res = await api.post('/api/auth/change-password', {
      body: { currentPassword: TEST_PASSWORD, newPassword: 'NewPassword123!' },
      token: sessionToken,
    });

    expect(res.status).toBe(204);
  });

  it('logs out', async () => {
    const res = await api.post('/api/auth/logout', { token: sessionToken });

    expect(res.status).toBe(204);
  });

  it('rejects old session after logout', async () => {
    const res = await api.post('/api/auth/logout', { token: sessionToken });

    expect(res.status).toBe(401);
  });

  it('logs in with changed password', async () => {
    const res = await api.post<{ token: string }>('/api/auth/login', {
      body: { email, password: 'NewPassword123!' },
    });

    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @identity-starter/e2e test
```

Expected: All tests in 01 and 02 pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/02-auth-lifecycle.e2e.ts
git commit -m "test(e2e): add full auth lifecycle tests"
```

---

### Task 7: MFA Flow E2E tests

**Files:**
- Create: `e2e/src/03-mfa-flow.e2e.ts`

- [ ] **Step 1: Write the test file**

Create `e2e/src/03-mfa-flow.e2e.ts`:

```typescript
import * as OTPAuth from 'otpauth';
import { TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('MFA Flow', () => {
  const email = uniqueEmail('mfa');
  let sessionToken: string;
  let totp: OTPAuth.TOTP;
  let recoveryCodes: string[];

  it('registers and gets session', async () => {
    const res = await api.post<{ token: string }>('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'MFA E2E User' },
    });

    expect(res.status).toBe(201);
    sessionToken = res.data.token;
  });

  it('enrolls TOTP', async () => {
    const res = await api.post<{ otpauthUri: string; recoveryCodes: string[] }>(
      '/api/account/mfa/totp/enroll',
      { token: sessionToken },
    );

    expect(res.status).toBe(200);
    expect(res.data.otpauthUri).toContain('otpauth://totp/');
    expect(res.data.recoveryCodes).toHaveLength(8);

    const parsed = OTPAuth.URI.parse(res.data.otpauthUri);
    if (!(parsed instanceof OTPAuth.TOTP)) {
      throw new Error('expected TOTP URI');
    }
    totp = parsed;
    recoveryCodes = res.data.recoveryCodes;
  });

  it('verifies TOTP enrollment with valid OTP', async () => {
    const res = await api.post('/api/account/mfa/totp/verify', {
      body: { otp: totp.generate() },
      token: sessionToken,
    });

    expect(res.status).toBe(200);
  });

  it('login now returns MFA challenge instead of session', async () => {
    const res = await api.post<{ mfaRequired: boolean; mfaToken: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });

    expect(res.status).toBe(200);
    expect(res.data.mfaRequired).toBe(true);
    expect(res.data.mfaToken).toBeDefined();
  });

  it('completes MFA login with TOTP', async () => {
    const loginRes = await api.post<{ mfaToken: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });

    const res = await api.post<{ token: string; user: { email: string } }>(
      '/api/auth/mfa/verify',
      { body: { mfaToken: loginRes.data.mfaToken, otp: totp.generate() } },
    );

    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();
    expect(res.data.user.email).toBe(email);
  });

  it('recovery code login works and code is consumed', async () => {
    const loginRes = await api.post<{ mfaToken: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });

    const res = await api.post<{ token: string }>('/api/auth/mfa/verify', {
      body: { mfaToken: loginRes.data.mfaToken, recoveryCode: recoveryCodes[0] },
    });

    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();

    const loginRes2 = await api.post<{ mfaToken: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });

    const reuse = await api.post('/api/auth/mfa/verify', {
      body: { mfaToken: loginRes2.data.mfaToken, recoveryCode: recoveryCodes[0] },
    });

    expect(reuse.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @identity-starter/e2e test
```

Expected: All tests in 01–03 pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/03-mfa-flow.e2e.ts
git commit -m "test(e2e): add MFA TOTP enrollment and login flow tests"
```

---

### Task 8: Password Reset E2E tests

**Files:**
- Create: `e2e/src/04-password-reset.e2e.ts`

- [ ] **Step 1: Write the test file**

Create `e2e/src/04-password-reset.e2e.ts`:

```typescript
import { TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('Password Reset', () => {
  const email = uniqueEmail('reset');
  let sessionToken: string;

  it('registers user', async () => {
    const res = await api.post<{ token: string }>('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'Reset E2E User' },
    });

    expect(res.status).toBe(201);
    sessionToken = res.data.token;
  });

  it('requests password reset and gets token', async () => {
    const res = await api.post<{ message: string; resetToken?: string }>(
      '/api/auth/forgot-password',
      { body: { email } },
    );

    expect(res.status).toBe(200);
    expect(res.data.resetToken).toBeDefined();
  });

  it('returns generic response for unknown email', async () => {
    const res = await api.post<{ message: string; resetToken?: string }>(
      '/api/auth/forgot-password',
      { body: { email: 'nobody@e2e.test' } },
    );

    expect(res.status).toBe(200);
    expect(res.data.resetToken).toBeUndefined();
  });

  it('resets password and invalidates old session', async () => {
    const forgotRes = await api.post<{ resetToken: string }>('/api/auth/forgot-password', {
      body: { email },
    });

    const res = await api.post<{ message: string }>('/api/auth/reset-password', {
      body: { token: forgotRes.data.resetToken, newPassword: 'ResetPass123!' },
    });

    expect(res.status).toBe(200);

    const logoutRes = await api.post('/api/auth/logout', { token: sessionToken });
    expect(logoutRes.status).toBe(401);
  });

  it('logs in with new password', async () => {
    const res = await api.post<{ token: string }>('/api/auth/login', {
      body: { email, password: 'ResetPass123!' },
    });

    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @identity-starter/e2e test
```

Expected: All tests in 01–04 pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/04-password-reset.e2e.ts
git commit -m "test(e2e): add password reset workflow tests"
```

---

### Task 9: Admin Operations E2E tests

**Files:**
- Create: `e2e/src/05-admin-operations.e2e.ts`

- [ ] **Step 1: Write the test file**

Create `e2e/src/05-admin-operations.e2e.ts`:

```typescript
import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('Admin Operations', () => {
  let adminToken: string;
  let targetUserId: string;

  it('admin logs in with seeded credentials', async () => {
    const res = await api.post<{ token: string }>('/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });

    expect(res.status).toBe(200);
    adminToken = res.data.token;
  });

  it('registers a target user for admin operations', async () => {
    const res = await api.post<{ user: { id: string } }>('/api/auth/register', {
      body: { email: uniqueEmail('target'), password: TEST_PASSWORD, displayName: 'Target User' },
    });

    expect(res.status).toBe(201);
    targetUserId = res.data.user.id;
  });

  describe('user management', () => {
    it('lists users', async () => {
      const res = await api.get<{ data: unknown[]; total: number }>('/api/admin/users', {
        token: adminToken,
      });

      expect(res.status).toBe(200);
      expect(res.data.data.length).toBeGreaterThanOrEqual(2);
      expect(res.data.total).toBeGreaterThanOrEqual(2);
    });

    it('gets user by ID with roles', async () => {
      const res = await api.get<{ id: string; roles: unknown[] }>(
        `/api/admin/users/${targetUserId}`,
        { token: adminToken },
      );

      expect(res.status).toBe(200);
      expect(res.data.id).toBe(targetUserId);
    });

    it('suspends user', async () => {
      const res = await api.patch<{ status: string }>(
        `/api/admin/users/${targetUserId}/status`,
        { body: { status: 'suspended' }, token: adminToken },
      );

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('suspended');
    });

    it('reactivates user', async () => {
      const res = await api.patch<{ status: string }>(
        `/api/admin/users/${targetUserId}/status`,
        { body: { status: 'active' }, token: adminToken },
      );

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('active');
    });
  });

  describe('role management', () => {
    it('lists system roles', async () => {
      const res = await api.get<Array<{ id: string; name: string }>>('/api/admin/roles', {
        token: adminToken,
      });

      expect(res.status).toBe(200);
      expect(res.data.length).toBeGreaterThanOrEqual(3);
      expect(res.data.some((r) => r.name === 'super_admin')).toBe(true);
      expect(res.data.some((r) => r.name === 'admin')).toBe(true);
      expect(res.data.some((r) => r.name === 'user')).toBe(true);
    });

    it('creates a custom role', async () => {
      const res = await api.post<{ id: string; name: string; isSystem: boolean }>(
        '/api/admin/roles',
        {
          body: { name: `e2e-role-${Date.now()}`, description: 'E2E test role' },
          token: adminToken,
        },
      );

      expect(res.status).toBe(201);
      expect(res.data.isSystem).toBe(false);
    });

    it('assigns role to user', async () => {
      const rolesRes = await api.get<Array<{ id: string; name: string }>>('/api/admin/roles', {
        token: adminToken,
      });
      const userRole = rolesRes.data.find((r) => r.name === 'user');
      if (!userRole) {
        throw new Error('user role not found');
      }

      const res = await api.post(`/api/admin/users/${targetUserId}/roles`, {
        body: { roleId: userRole.id },
        token: adminToken,
      });

      expect(res.status).toBe(201);
    });

    it('removes role from user', async () => {
      const rolesRes = await api.get<Array<{ id: string; name: string }>>('/api/admin/roles', {
        token: adminToken,
      });
      const userRole = rolesRes.data.find((r) => r.name === 'user');
      if (!userRole) {
        throw new Error('user role not found');
      }

      const res = await api.delete(`/api/admin/users/${targetUserId}/roles/${userRole.id}`, {
        token: adminToken,
      });

      expect(res.status).toBe(204);
    });
  });

  describe('session management', () => {
    it('lists sessions', async () => {
      const res = await api.get<{ data: unknown[] }>('/api/admin/sessions', {
        token: adminToken,
      });

      expect(res.status).toBe(200);
      expect(res.data.data.length).toBeGreaterThan(0);
    });
  });

  describe('audit logs', () => {
    it('queries audit logs', async () => {
      const res = await api.get<{ data: unknown[]; total: number }>('/api/admin/audit-logs', {
        token: adminToken,
      });

      expect(res.status).toBe(200);
      expect(res.data.data.length).toBeGreaterThan(0);
      expect(res.data.total).toBeGreaterThan(0);
    });

    it('exports audit logs as NDJSON', async () => {
      const res = await api.get<string>('/api/admin/audit-logs/export', { token: adminToken });

      expect(res.status).toBe(200);
      const lines = (res.data as string).split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      expect(() => JSON.parse(lines[0])).not.toThrow();
    });
  });

  describe('RBAC enforcement', () => {
    it('non-admin gets 403 on admin routes', async () => {
      const regRes = await api.post<{ token: string }>('/api/auth/register', {
        body: {
          email: uniqueEmail('nonadmin'),
          password: TEST_PASSWORD,
          displayName: 'Non Admin',
        },
      });

      const res = await api.get('/api/admin/users', { token: regRes.data.token });
      expect(res.status).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @identity-starter/e2e test
```

Expected: All tests in 01–05 pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/05-admin-operations.e2e.ts
git commit -m "test(e2e): add admin operations, RBAC, and audit log tests"
```

---

### Task 10: OAuth2/OIDC E2E tests

**Files:**
- Create: `e2e/src/06-oauth-flow.e2e.ts`

- [ ] **Step 1: Write the test file**

Create `e2e/src/06-oauth-flow.e2e.ts`:

```typescript
import * as jose from 'jose';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/constants.js';
import { basicAuth, codeFromLocation, pkcePair, uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

const REDIRECT_URI = 'https://example.com/callback';
const SCOPE = 'openid profile email';

async function approveConsent(
  token: string,
  clientId: string,
  state: string,
  codeChallenge: string,
  nonce?: string,
): Promise<string> {
  const res = await api.post('/oauth/consent', {
    body: {
      client_id: clientId,
      scope: SCOPE,
      decision: 'approve',
      state,
      redirect_uri: REDIRECT_URI,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      ...(nonce ? { nonce } : {}),
    },
    token,
  });
  expect(res.status).toBe(302);
  const location = res.headers.get('location');
  if (!location) {
    throw new Error('expected Location header from consent');
  }
  return codeFromLocation(location);
}

describe('OAuth2/OIDC Flow', () => {
  let adminToken: string;
  let clientId: string;
  let clientSecret: string;

  it('admin logs in and creates OAuth client', async () => {
    const loginRes = await api.post<{ token: string }>('/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.data.token;

    const clientRes = await api.post<{ clientId: string; clientSecret: string }>(
      '/api/admin/clients',
      {
        body: {
          clientName: 'E2E OAuth App',
          redirectUris: [REDIRECT_URI],
          grantTypes: ['authorization_code', 'refresh_token', 'client_credentials'],
          scope: SCOPE,
          tokenEndpointAuthMethod: 'client_secret_basic',
          isConfidential: true,
        },
        token: adminToken,
      },
    );
    expect(clientRes.status).toBe(201);
    clientId = clientRes.data.clientId;
    clientSecret = clientRes.data.clientSecret;
  });

  it('full authorization code flow with PKCE + JWTs + userinfo', async () => {
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = `state-${Date.now()}`;
    const nonce = `nonce-${Date.now()}`;

    const authRes = await api.get<{ type: string }>('/oauth/authorize', {
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        nonce,
      },
      token: adminToken,
    });
    expect(authRes.status).toBe(200);
    expect(authRes.data.type).toBe('consent_required');

    const code = await approveConsent(adminToken, clientId, state, codeChallenge, nonce);

    const tokenRes = await api.post<{
      access_token: string;
      refresh_token: string;
      id_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    }>('/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.data.token_type).toBe('Bearer');
    expect(tokenRes.data.refresh_token).toBeDefined();
    expect(tokenRes.data.id_token).toBeDefined();
    expect(tokenRes.data.scope).toBe(SCOPE);

    const jwksRes = await api.get<jose.JSONWebKeySet>('/.well-known/jwks.json');
    const jwks = jose.createLocalJWKSet(jwksRes.data);
    const { payload } = await jose.jwtVerify(tokenRes.data.access_token, jwks, {
      issuer: 'http://localhost:3001',
      audience: clientId,
    });
    expect(payload.sub).toBeDefined();
    expect(payload.scope).toBe(SCOPE);

    const idDecoded = jose.decodeJwt(tokenRes.data.id_token);
    expect(idDecoded.nonce).toBe(nonce);
    expect(idDecoded.aud).toBe(clientId);

    const userinfoRes = await api.get<{ sub: string; name: string; email: string }>(
      '/oauth/userinfo',
      { headers: { authorization: `Bearer ${tokenRes.data.access_token}` } },
    );
    expect(userinfoRes.status).toBe(200);
    expect(userinfoRes.data.sub).toBe(payload.sub);
  });

  it('refresh token rotation: new token issued, old and new both distinct', async () => {
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = `state-rotate-${Date.now()}`;

    await api.get('/oauth/authorize', {
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
      token: adminToken,
    });

    const code = await approveConsent(adminToken, clientId, state, codeChallenge);

    const tokenRes = await api.post<{ access_token: string; refresh_token: string }>(
      '/oauth/token',
      {
        body: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier,
        },
        headers: { authorization: basicAuth(clientId, clientSecret) },
      },
    );
    const firstRefresh = tokenRes.data.refresh_token;

    const refreshRes = await api.post<{ access_token: string; refresh_token: string }>(
      '/oauth/token',
      {
        body: { grant_type: 'refresh_token', refresh_token: firstRefresh },
        headers: { authorization: basicAuth(clientId, clientSecret) },
      },
    );
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.data.access_token).not.toBe(tokenRes.data.access_token);
    expect(refreshRes.data.refresh_token).not.toBe(firstRefresh);

    const secondRefresh = await api.post<{ access_token: string; refresh_token: string }>(
      '/oauth/token',
      {
        body: { grant_type: 'refresh_token', refresh_token: refreshRes.data.refresh_token },
        headers: { authorization: basicAuth(clientId, clientSecret) },
      },
    );
    expect(secondRefresh.status).toBe(200);
    expect(secondRefresh.data.access_token).not.toBe(refreshRes.data.access_token);
    expect(secondRefresh.data.refresh_token).not.toBe(refreshRes.data.refresh_token);
  });

  it('PKCE: wrong code_verifier fails token exchange', async () => {
    const { codeChallenge } = pkcePair();
    const state = `state-pkce-${Date.now()}`;

    await api.get('/oauth/authorize', {
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
      token: adminToken,
    });

    const code = await approveConsent(adminToken, clientId, state, codeChallenge);
    const wrongVerifier = 'this-is-definitely-not-the-right-verifier-value-at-all';

    const tokenRes = await api.post('/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: wrongVerifier,
      },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });

    expect(tokenRes.status).toBe(401);
  });

  it('token introspection: active vs revoked', async () => {
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = `state-intro-${Date.now()}`;

    await api.get('/oauth/authorize', {
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
      token: adminToken,
    });

    const code = await approveConsent(adminToken, clientId, state, codeChallenge);

    const tokenRes = await api.post<{ access_token: string; refresh_token: string }>(
      '/oauth/token',
      {
        body: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier,
        },
        headers: { authorization: basicAuth(clientId, clientSecret) },
      },
    );

    const activeRes = await api.post<{ active: boolean; sub: string }>('/oauth/introspect', {
      body: { token: tokenRes.data.access_token },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(activeRes.status).toBe(200);
    expect(activeRes.data.active).toBe(true);

    await api.post('/oauth/revoke', {
      body: { token: tokenRes.data.refresh_token },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });

    const revokedRes = await api.post<{ active: boolean }>('/oauth/introspect', {
      body: { token: tokenRes.data.refresh_token, token_type_hint: 'refresh_token' },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(revokedRes.status).toBe(200);
    expect(revokedRes.data.active).toBe(false);
  });

  it('PAR flow: push request → authorize with request_uri → exchange', async () => {
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = `state-par-${Date.now()}`;

    const parRes = await api.post<{ request_uri: string; expires_in: number }>('/oauth/par', {
      body: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
      },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(parRes.status).toBe(201);
    expect(parRes.data.request_uri).toMatch(/^urn:ietf:params:oauth:request_uri:/);

    const authRes = await api.get<{ type: string }>('/oauth/authorize', {
      query: { request_uri: parRes.data.request_uri, client_id: clientId },
      token: adminToken,
    });
    expect(authRes.status).toBe(200);
    expect(authRes.data.type).toBe('consent_required');

    const code = await approveConsent(adminToken, clientId, state, codeChallenge);

    const tokenRes = await api.post<{ access_token: string }>('/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.data.access_token).toBeDefined();
  });

  it('client credentials flow', async () => {
    const tokenRes = await api.post<{
      access_token: string;
      token_type: string;
      refresh_token?: string;
      id_token?: string;
    }>('/oauth/token', {
      body: { grant_type: 'client_credentials' },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.data.token_type).toBe('Bearer');
    expect(tokenRes.data.refresh_token).toBeUndefined();
    expect(tokenRes.data.id_token).toBeUndefined();
  });

  it('consent revocation: DELETE /oauth/consent/:clientId', async () => {
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = `state-consent-del-${Date.now()}`;

    await api.get('/oauth/authorize', {
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
      token: adminToken,
    });

    const code = await approveConsent(adminToken, clientId, state, codeChallenge);

    const tokenRes = await api.post<{ refresh_token: string }>('/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });

    const delRes = await api.delete(`/oauth/consent/${clientId}`, { token: adminToken });
    expect(delRes.status).toBe(204);

    const failRefresh = await api.post('/oauth/token', {
      body: { grant_type: 'refresh_token', refresh_token: tokenRes.data.refresh_token },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(failRefresh.status).toBe(401);

    const reAuthRes = await api.get<{ type: string }>('/oauth/authorize', {
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state: `state-re-${Date.now()}`,
        code_challenge: pkcePair().codeChallenge,
        code_challenge_method: 'S256',
      },
      token: adminToken,
    });
    expect(reAuthRes.status).toBe(200);
    expect(reAuthRes.data.type).toBe('consent_required');
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @identity-starter/e2e test
```

Expected: All tests in 01–06 pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/06-oauth-flow.e2e.ts
git commit -m "test(e2e): add OAuth2/OIDC full flow tests including PAR, introspection, and consent"
```

---

### Task 11: Account Management E2E tests

**Files:**
- Create: `e2e/src/07-account-management.e2e.ts`

- [ ] **Step 1: Write the test file**

Create `e2e/src/07-account-management.e2e.ts`:

```typescript
import { TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('Account Management', () => {
  const email = uniqueEmail('account');
  let sessionToken: string;

  it('registers and logs in', async () => {
    const regRes = await api.post<{ token: string }>('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'Account E2E User' },
    });
    expect(regRes.status).toBe(201);
    sessionToken = regRes.data.token;
  });

  describe('profile', () => {
    it('gets profile', async () => {
      const res = await api.get<{ id: string; email: string; displayName: string }>(
        '/api/account/profile',
        { token: sessionToken },
      );

      expect(res.status).toBe(200);
      expect(res.data.email).toBe(email);
      expect(res.data.displayName).toBe('Account E2E User');
    });

    it('rejects profile without auth', async () => {
      const res = await api.get('/api/account/profile');
      expect(res.status).toBe(401);
    });

    it('updates display name', async () => {
      const res = await api.patch<{ displayName: string }>('/api/account/profile', {
        body: { displayName: 'Updated E2E Name' },
        token: sessionToken,
      });

      expect(res.status).toBe(200);
      expect(res.data.displayName).toBe('Updated E2E Name');
    });
  });

  describe('sessions', () => {
    it('creates a second session and lists them', async () => {
      await api.post('/api/auth/login', { body: { email, password: TEST_PASSWORD } });

      const res = await api.get<Array<{ id: string; isCurrent: boolean }>>(
        '/api/account/sessions',
        { token: sessionToken },
      );

      expect(res.status).toBe(200);
      expect(res.data.length).toBeGreaterThanOrEqual(2);
      expect(res.data.filter((s) => s.isCurrent)).toHaveLength(1);
    });

    it('rejects deleting current session', async () => {
      const listRes = await api.get<Array<{ id: string; isCurrent: boolean }>>(
        '/api/account/sessions',
        { token: sessionToken },
      );
      const current = listRes.data.find((s) => s.isCurrent);
      if (!current) {
        throw new Error('expected a current session');
      }

      const res = await api.delete(`/api/account/sessions/${current.id}`, {
        token: sessionToken,
      });
      expect(res.status).toBe(400);
    });

    it('deletes another session', async () => {
      const listRes = await api.get<Array<{ id: string; isCurrent: boolean }>>(
        '/api/account/sessions',
        { token: sessionToken },
      );
      const other = listRes.data.find((s) => !s.isCurrent);
      if (!other) {
        throw new Error('expected a non-current session');
      }

      const res = await api.delete(`/api/account/sessions/${other.id}`, {
        token: sessionToken,
      });
      expect(res.status).toBe(204);
    });
  });

  describe('passkey options (no WebAuthn ceremony)', () => {
    it('gets registration options', async () => {
      const res = await api.post('/api/auth/passkeys/register/options', {
        token: sessionToken,
      });

      expect(res.status).toBe(200);
    });

    it('gets login options (no auth required)', async () => {
      const res = await api.post('/api/auth/passkeys/login/options');

      expect(res.status).toBe(200);
    });

    it('lists passkeys (empty for new user)', async () => {
      const res = await api.get<unknown[]>('/api/account/passkeys', { token: sessionToken });

      expect(res.status).toBe(200);
      expect(res.data).toEqual([]);
    });
  });
});
```

> **Passkey limitation:** Only options endpoints are tested. Verify endpoints require a real WebAuthn authenticator response — skipped in E2E (covered by integration tests with `@simplewebauthn/server` mocks). Can add Playwright-based passkey E2E with virtual authenticators later.

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @identity-starter/e2e test
```

Expected: All tests in 01–07 pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/07-account-management.e2e.ts
git commit -m "test(e2e): add account management, sessions, and passkey options tests"
```

---

### Task 12: Orchestration script and root integration

**Files:**
- Create: `scripts/e2e.sh`
- Modify: `package.json` (root)

- [ ] **Step 1: Create orchestration script**

Create `scripts/e2e.sh`:

```bash
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
```

```bash
chmod +x scripts/e2e.sh
```

> **`trap cleanup EXIT`** ensures teardown runs even on test failure or Ctrl+C. Exit code propagates from `set -e` — if `pnpm test` fails, the script exits with that code after cleanup.
>
> **Important:** This script must be run from the repo root (relative `COMPOSE_FILE` path). `pnpm test:e2e` from root handles this automatically.

- [ ] **Step 2: Add test:e2e to root package.json**

In `package.json` (root), **merge** into the existing `scripts` object (do NOT replace the whole block):

```bash
pnpm pkg set scripts.test:e2e="./scripts/e2e.sh"
```

- [ ] **Step 3: Run the full E2E suite end-to-end**

```bash
pnpm test:e2e
```

Expected: Stack starts → seed runs → all 7 test files pass → teardown. Full output shows each workflow completing.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e.sh package.json
git commit -m "feat(e2e): add orchestration script and root test:e2e command"
```

---

## Completion Criteria

- [ ] `pnpm test:e2e` runs the full lifecycle: Docker up → seed → tests → teardown
- [ ] All 7 E2E workflow files pass against the production Docker stack
- [ ] Server runs with `NODE_ENV=production` (rate limiting, JSON logs, no pino-pretty)
- [ ] Postgres is internal to Docker network only (no host port mapping)
- [ ] Drizzle seed creates admin user with `super_admin` role
- [ ] E2E tests use only HTTP — no direct DB access from test runner
- [ ] Auth lifecycle: register → verify email → login → change password → logout
- [ ] MFA flow: TOTP enroll → MFA login → recovery code consumed
- [ ] Password reset: forgot → reset → old session invalidated
- [ ] Admin: user management, roles, audit logs, RBAC enforcement
- [ ] OAuth2: auth code + PKCE, refresh rotation, introspection, revocation, PAR, client credentials, consent management
- [ ] Account: profile CRUD, session management, passkey options
- [ ] No persistent volumes — clean DB each run
- [ ] `scripts/e2e.sh` handles cleanup on failure (trap EXIT)
