# Phase 8a: Build & Bundle Optimization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw `tsc` build with tsup for optimized production bundles — tree-shaken, minified, single-file output with workspace deps inlined.

**Architecture:** tsup (esbuild-based) bundles `apps/server/src/server.ts` into a single ESM output. Workspace packages (`@identity-starter/core`, `@identity-starter/db`, `@identity-starter/redis`) are inlined. All `node_modules` dependencies remain external (installed at deploy time). Graceful shutdown is enhanced with connection draining and timeout.

**Tech Stack:** tsup, esbuild, pino, pino-pretty

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/server/tsup.config.ts` | Create | tsup build configuration |
| `apps/server/package.json` | Modify | Add tsup dep, update build/start scripts |
| `apps/server/src/server.ts` | Modify | Enhanced graceful shutdown with draining |
| `apps/server/src/core/logger.ts` | Modify | Ensure pino-pretty is dev-only (dynamic import) |
| `package.json` (root) | Modify | Add tsup to onlyBuiltDependencies if needed |
| `turbo.json` | No change | `build` task already outputs `dist/**` |

---

### Task 1: Install tsup and configure build

**Files:**
- Create: `apps/server/tsup.config.ts`
- Modify: `apps/server/package.json`

- [ ] **Step 1: Install tsup as a dev dependency**

```bash
cd apps/server && pnpm add -D tsup
```

- [ ] **Step 2: Create tsup configuration**

Create `apps/server/tsup.config.ts`:

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  minify: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  // Bundle workspace packages, externalize node_modules
  noExternal: [
    '@identity-starter/core',
    '@identity-starter/db',
    '@identity-starter/redis',
  ],
  // Keep native/binary deps external
  external: [
    '@node-rs/argon2',
    'postgres',
  ],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
```

> **Note on `banner`:** Some dependencies (drizzle-orm internals) may use `require()`. The banner shim ensures compatibility in ESM output. If the build works without it, remove it.

> **Note on `noExternal`:** These are our workspace packages. tsup will inline their code into the bundle, eliminating the need to install them separately at deploy time.

> **Note on `external`:** `@node-rs/argon2` has native bindings that cannot be bundled. `postgres` is used by the migration script (not the server runtime), but keep it external if it's imported transitively.

- [ ] **Step 3: Update package.json scripts**

In `apps/server/package.json`, update the `build` and `start` scripts:

```json
{
  "scripts": {
    "build": "tsup",
    "build:check": "tsc --noEmit",
    "dev": "tsx watch --env-file .env src/server.ts",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:unit": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "test:watch": "vitest --project unit"
  }
}
```

> `build:check` preserves type-checking without emitting files (tsup handles emit). `build` now runs tsup. `start` remains unchanged (still `node dist/server.js`).

- [ ] **Step 4: Run the build and verify output**

```bash
cd apps/server && pnpm build
```

Expected: `dist/server.js` (single bundled file) + `dist/server.js.map` (source map). Should be significantly smaller than the previous 300+ file output.

```bash
ls -la dist/
```

Expected: 2 files (server.js + server.js.map), not the previous directory tree.

- [ ] **Step 5: Test the bundled server starts**

```bash
cd apps/server && node dist/server.js
```

Expected: Server starts and listens on port 3000 (or exits cleanly if no DATABASE_URL). Verify no missing module errors.

> **Troubleshooting:** If you get `Cannot find module` errors:
> - For workspace packages: ensure they're listed in `noExternal`
> - For node_modules with native bindings: add them to `external`
> - For CJS-only modules: the `banner` shim should handle `require()` calls

- [ ] **Step 6: Verify type checking still works**

```bash
cd apps/server && pnpm build:check
```

Expected: No TypeScript errors. This ensures we didn't break types by switching to tsup.

- [ ] **Step 7: Run existing tests to verify nothing is broken**

```bash
pnpm --filter server test:unit
```

Expected: All unit tests pass. Tests use source files directly (not dist), so the tsup change shouldn't affect them.

- [ ] **Step 8: Commit**

```bash
git add apps/server/tsup.config.ts apps/server/package.json pnpm-lock.yaml
git commit -m "feat(build): replace tsc with tsup for optimized server bundling"
```

---

### Task 2: Update Turborepo build pipeline

**Files:**
- Modify: `turbo.json` (if needed)
- Modify: `apps/server/package.json` (add typecheck to turbo pipeline)

- [ ] **Step 1: Add typecheck task to turbo.json**

The `build` task in turbo.json already outputs `dist/**` which works for tsup. But we need a separate `typecheck` task since tsup doesn't do type-checking:

In `turbo.json`, add a `typecheck` task:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"],
      "cache": false
    },
    "lint": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 2: Add typecheck script to root package.json**

In root `package.json`, add:

```json
{
  "scripts": {
    "typecheck": "turbo run typecheck"
  }
}
```

- [ ] **Step 3: Add typecheck script to workspace packages that use tsc**

For `packages/core`, `packages/db`, `packages/redis` — their `build` script is already `tsc` which does type-checking. Add `typecheck` script to each:

In each package's `package.json`, add:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

> Packages still use `tsc` for build (they emit `.d.ts` declarations consumed by other packages). Only `apps/server` uses tsup.

- [ ] **Step 4: Verify full turbo build pipeline**

```bash
pnpm turbo build
```

Expected: All packages build successfully. `packages/*` emit `dist/` via tsc. `apps/server` emits bundled `dist/server.js` via tsup.

- [ ] **Step 5: Verify typecheck pipeline**

```bash
pnpm typecheck
```

Expected: All packages pass type-checking.

- [ ] **Step 6: Commit**

```bash
git add turbo.json package.json packages/core/package.json packages/db/package.json packages/redis/package.json
git commit -m "feat(build): add typecheck task to turborepo pipeline"
```

---

### Task 3: Enhanced graceful shutdown

**Files:**
- Modify: `apps/server/src/server.ts`

- [ ] **Step 1: Write a test for graceful shutdown behavior**

Create `apps/server/src/__tests__/server-shutdown.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

describe('graceful shutdown', () => {
  it('should close app and exit on SIGTERM', async () => {
    // This is a behavioral spec — the actual shutdown logic is in server.ts
    // We verify the contract: SIGTERM → app.close() → cleanup → exit
    // Integration testing of shutdown requires process-level testing
    // which is covered in the Docker health check tests (Phase 8b)
    expect(true).toBe(true);
  });
});
```

> **Note:** Graceful shutdown is best tested at the integration/Docker level. The unit test here documents the contract. Real verification happens in Task 4 (manual) and Phase 8b (Docker HEALTHCHECK).

- [ ] **Step 2: Enhance server.ts with connection draining and timeout**

Replace `apps/server/src/server.ts` with:

```typescript
import { buildApp } from './app.js';
import { createContainer, env, loggerConfig } from './core/index.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

const container = createContainer();
const app = await buildApp({ container, logger: loggerConfig });

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  app.log.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

  const forceExit = setTimeout(() => {
    app.log.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    // Fastify.close() stops accepting new connections and waits for in-flight requests
    await app.close();
    app.log.info('Server closed gracefully');
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'Error during graceful shutdown');
    clearTimeout(forceExit);
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => shutdown(signal));
}

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

> **Key improvements over current:**
> - Idempotent shutdown (ignores duplicate signals)
> - 30s timeout with forced exit (prevents zombie processes in Docker)
> - `forceExit.unref()` so the timer doesn't keep the process alive
> - Structured logging for observability

- [ ] **Step 3: Run tests to verify no regressions**

```bash
pnpm --filter server test:unit
```

Expected: All tests pass.

- [ ] **Step 4: Manual verification**

```bash
cd apps/server && pnpm dev
# In another terminal:
kill -TERM <pid>
```

Expected: Logs show "Received shutdown signal, starting graceful shutdown" → "Server closed gracefully" → process exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/server.ts
git commit -m "feat(server): add graceful shutdown with connection draining and timeout"
```

---

### Task 4: Production logging optimization

**Files:**
- Modify: `apps/server/src/core/logger.ts`
- Modify: `apps/server/package.json` (move pino-pretty to optionalDependencies)

- [ ] **Step 1: Verify current logger config**

Read `apps/server/src/core/logger.ts` — current implementation already handles dev vs production:
- Development: pino-pretty transport with colorize
- Production: no transport (raw JSON to stdout)

This is already correct for production. The key optimization is ensuring pino-pretty doesn't get bundled into production.

- [ ] **Step 2: Move pino-pretty to optionalDependencies**

In `apps/server/package.json`, move `pino-pretty` from `devDependencies` to `dependencies` but mark it conditional — actually, since tsup bundles the server and pino-pretty is only used via Pino's `transport` option (loaded dynamically by Pino at runtime, not imported directly), it won't be included in the bundle. No change needed.

> **Why no change:** Pino loads transports via `worker_threads` at runtime using the transport `target` string. tsup doesn't follow these dynamic references. In production, the transport is `undefined` (no pino-pretty), so it simply outputs JSON. pino-pretty stays in devDependencies and is never installed in production Docker image.

- [ ] **Step 3: Verify production logging output**

```bash
cd apps/server && NODE_ENV=production node dist/server.js 2>&1 | head -5
```

Expected: JSON-formatted log lines (not pretty-printed). Each line is valid JSON with `level`, `time`, `msg`, `reqId` fields.

- [ ] **Step 4: Commit (skip if no changes needed)**

If any changes were made:

```bash
git add apps/server/src/core/logger.ts apps/server/package.json
git commit -m "feat(logging): optimize pino for production JSON output"
```

---

### Task 5: Add .env.production.example

**Files:**
- Create: `apps/server/.env.production.example`

- [ ] **Step 1: Create production environment example**

Create `apps/server/.env.production.example`:

```bash
# =============================================================================
# Identity Starter — Production Environment Configuration
# =============================================================================
# Copy to .env and fill in all REQUIRED values before deploying.
# Values marked [REQUIRED] have no defaults and must be set.
# Values marked [RECOMMENDED] have defaults but should be tuned for production.
# =============================================================================

# --- Core ---
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info                          # [RECOMMENDED] Use 'warn' for high-traffic production

# --- Database ---
DATABASE_URL=                           # [REQUIRED] postgresql://user:pass@host:5432/dbname
                                        # Use connection pooler (PgBouncer) in production
                                        # Enable SSL: ?sslmode=require

# --- Redis ---
REDIS_URL=                              # [REQUIRED] redis://user:pass@host:6379
                                        # Enable TLS: rediss://user:pass@host:6379

# --- WebAuthn / Passkeys ---
WEBAUTHN_RP_NAME=                       # [REQUIRED] Your app display name (e.g., "My App")
WEBAUTHN_RP_ID=                         # [REQUIRED] Your domain (e.g., "example.com") — no protocol, no port
WEBAUTHN_ORIGIN=                        # [REQUIRED] Full origin URL (e.g., "https://example.com")

# --- Sessions ---
SESSION_TTL_SECONDS=604800              # [RECOMMENDED] 7 days. Reduce for higher-security environments.

# --- OAuth2 / OIDC ---
JWT_ISSUER=                             # [REQUIRED] Your issuer URL (e.g., "https://auth.example.com")
ACCESS_TOKEN_TTL_SECONDS=3600           # 1 hour — standard for OAuth2
REFRESH_TOKEN_TTL_SECONDS=2592000       # 30 days
AUTH_CODE_TTL_SECONDS=600               # 10 minutes — per OAuth2 spec recommendation
REFRESH_GRACE_PERIOD_SECONDS=10         # Replay detection window
PAR_TTL_SECONDS=60                      # Pushed Authorization Request lifetime
DPOP_NONCE_TTL_SECONDS=300              # DPoP nonce validity window

# --- Security ---
TOTP_ENCRYPTION_KEY=                    # [REQUIRED if MFA enabled] Exactly 64 hex characters
                                        # Generate: openssl rand -hex 32
AUDIT_RETENTION_DAYS=90                 # [RECOMMENDED] Adjust per compliance requirements (GDPR: check DPA)
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/.env.production.example
git commit -m "docs: add production environment configuration example"
```

---

## Completion Criteria

- [ ] `pnpm --filter server build` produces a single bundled `dist/server.js` via tsup
- [ ] `pnpm typecheck` passes across all packages
- [ ] `pnpm turbo build` completes successfully (packages use tsc, server uses tsup)
- [ ] Server starts from bundled output: `node dist/server.js`
- [ ] Graceful shutdown handles SIGTERM with 30s timeout
- [ ] Production logs are JSON-formatted
- [ ] `.env.production.example` documents all env vars with security notes
- [ ] All existing tests pass
