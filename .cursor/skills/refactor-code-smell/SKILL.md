---
name: refactor-code-smell
description: >-
  Refactor code smells and security concerns from the server API audit report
  (docs/AUDIT_REPORT.md). Use when the user references a SMELL-N issue (SMELL-1
  through SMELL-11), asks to fix a security concern, harden configuration,
  improve CORS, fix environment defaults, add audience validation, clean up
  authorization models, or address any item from the Code Smells section of the
  audit report. Also trigger when the user mentions cookie secret defaults,
  TOTP key configuration, recovery code performance, plaintext tokens in DB,
  session cleanup, expired session filtering, or ilike injection.
---

# Refactor Code Smell Skill

Address items from the **Code Smells & Security Concerns** section of
`docs/AUDIT_REPORT.md`. These are security hardening, configuration safety,
performance, and correctness issues that require careful refactoring without
breaking existing behavior.

## Before Refactoring

1. Read `docs/AUDIT_REPORT.md` for the full smell description and recommended solution
2. Read the affected source file(s) end-to-end — these changes often touch configuration or cross-cutting concerns
3. Read existing tests to understand what's currently covered
4. Check if the smell interacts with other modules (smells often affect shared infrastructure)

## General Refactor Workflow

1. **Understand the security impact** — smells in this list range from critical (forged cookies) to low (dead code). Prioritize understanding the attack vector before coding.
2. **Check for dependent code** — use grep/glob to find all callers of the function or config value being changed. Smells often affect multiple modules.
3. **Refactor incrementally** — make the change, verify tests pass, then add new tests for the hardened behavior.
4. **Preserve backward compatibility where needed** — some changes (like env variable formats) affect deployment configs. Note any migration steps.

## Smell Reference

### SMELL-1: `COOKIE_SECRET` defaults to `'change-me-in-production'` (CRITICAL)

**File:** `src/core/env.ts`

**Root cause:** Zod `.default('change-me-in-production')` means the server starts without a secret, even in production.

**Fix:**
- Remove the `.default()` for the cookie secret
- Add a startup refinement that rejects the known-weak value in production

```typescript
COOKIE_SECRET: z.string().refine(
  (v) => process.env.NODE_ENV !== 'production' || v !== 'change-me-in-production',
  'COOKIE_SECRET must be set to a secure value in production',
),
```

For local development, update `.env.example` to include a placeholder and document that `COOKIE_SECRET` must be set explicitly.

**Impact:** Deployments that don't set `COOKIE_SECRET` will fail at startup in production. This is intentional — silent fallback to a weak secret is worse.

**Test:** Unit test the env schema: verify it rejects the default value when `NODE_ENV=production`, accepts any other string, and accepts the default in development.

---

### SMELL-2: `TOTP_ENCRYPTION_KEY` is optional but silently breaks MFA (MEDIUM)

**File:** `src/core/env.ts`

**Root cause:** `TOTP_ENCRYPTION_KEY` is `.optional()` in the schema, but every MFA operation calls `requireTotpKey()` which throws at runtime.

**Fix — option A (recommended):** Make `TOTP_ENCRYPTION_KEY` required and fail at startup:
```typescript
TOTP_ENCRYPTION_KEY: z.string().min(32),
```

**Fix — option B:** Keep it optional but conditionally skip MFA route registration:
```typescript
if (!env.TOTP_ENCRYPTION_KEY) {
  fastify.log.warn('TOTP_ENCRYPTION_KEY not set — MFA routes disabled');
  return; // skip registering MFA routes
}
```

**Test:** Verify startup fails with a clear error when the key is missing (option A), or that MFA routes return 501 (option B).

---

### SMELL-3: Recovery codes verified with Argon2 — expensive sequential hashing (LOW)

**File:** `src/modules/mfa/mfa.service.ts`

**Root cause:** Each recovery code is verified with Argon2id (64MB memory, ~200ms each). With 8 codes, worst case is ~1.6 seconds of CPU-blocking work.

**Fix:**
- Switch recovery codes to HMAC-SHA256 keyed with a server-side secret (e.g., `TOTP_ENCRYPTION_KEY`)
- This provides integrity verification in microseconds while preventing brute-force without the server key

```typescript
import { createHmac } from 'node:crypto';

function hmacRecoveryCode(code: string, key: string): string {
  return createHmac('sha256', key).update(code).digest('hex');
}
```

**Migration:** Existing Argon2 hashes need a migration path. Either:
- Add a `hashType` column and support both during transition
- Or re-generate all recovery codes on next MFA interaction (simpler, acceptable for most deployments)

**Test:** Verify HMAC-based recovery code verification is correct and fast. Ensure old codes are handled gracefully.

---

### SMELL-4: `rotationGracePlaintext` stores plaintext refresh token in DB (HIGH)

**File:** `src/modules/token/refresh-token.service.ts`

**Root cause:** During rotation, the new plaintext token is stored in `rotationGracePlaintext` for grace-period retries.

**Fix:**
- Store the SHA-256 hash of the new token instead of the plaintext
- During grace-period lookup, hash the incoming token and compare

```typescript
import { createHash } from 'node:crypto';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// When storing:
.set({
  revokedAt: now,
  rotationGracePlaintext: sha256(newPlain), // store hash, not plaintext
})

// When checking grace period:
const incomingHash = sha256(incomingToken);
// compare incomingHash against stored rotationGracePlaintext
```

**Column name:** The column name `rotationGracePlaintext` becomes misleading after this change. Consider renaming to `rotationGraceHash` in a migration, or add a code comment explaining the name is historical.

**Test:** Verify grace-period retry works with the hashed approach. Verify the DB column never contains a raw token.

---

### SMELL-5: OAuth token endpoint CORS reflects any origin (HIGH)

**File:** `src/modules/oauth/oauth.routes.ts`

**Root cause:** The CORS hook reflects `request.headers.origin` verbatim as `Access-Control-Allow-Origin` with `credentials: true`.

**Fix:**
- Look up the requesting client's registered redirect URIs
- Only set CORS headers if the origin matches a registered client origin
- Otherwise, omit CORS headers entirely

```typescript
async function setOAuthTokenEndpointCors(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const origin = request.headers.origin;
  if (!origin) return;

  // Check if origin matches any registered client's allowed origins
  const isAllowed = await isRegisteredClientOrigin(deps.db, origin);
  if (!isAllowed) return;

  reply.header('Access-Control-Allow-Origin', origin);
  reply.header('Access-Control-Allow-Methods', 'POST');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, DPoP');
  reply.header('Access-Control-Allow-Credentials', 'true');
}
```

You'll need to implement `isRegisteredClientOrigin()` which extracts the origin from registered redirect URIs and matches against it. Consider caching this lookup.

**Test:** Verify CORS headers are set for registered origins and omitted for unknown origins.

---

### SMELL-6: No `audience` validation on access token verification (HIGH)

**File:** `src/modules/token/jwt.service.ts`

**Root cause:** `verifyAccessToken()` calls `jose.jwtVerify()` without passing an `audience` parameter.

**Fix:**
- Add an optional `audience` parameter to `verifyAccessToken()`
- Pass it to `jose.jwtVerify()` options
- At endpoints where audience is known (resource servers), pass the expected client ID
- At `/oauth/userinfo`, validate `payload.aud` post-verification against registered clients

```typescript
export async function verifyAccessToken(
  token: string,
  options?: { audience?: string },
): Promise<JWTPayload> {
  const { payload } = await jose.jwtVerify(token, keyResolver, {
    issuer,
    algorithms: ['RS256'],
    audience: options?.audience,
  });
  return payload;
}
```

**Test:** Verify tokens with wrong audience are rejected. Verify tokens with correct audience pass.

---

### SMELL-7: Dual admin authorization models (`isAdmin` + RBAC) (MEDIUM)

**Files:** `src/core/plugins/admin.ts`, `src/core/plugins/rbac.ts`

**Root cause:** `requireAdmin` checks `users.isAdmin` boolean; `requirePermission` checks RBAC tables. Two sources of truth for authorization.

**Fix — phased approach:**
1. First, ensure RBAC has an `admin` resource with `access` action
2. Run `backfillAdminRoles()` to sync existing `isAdmin: true` users to RBAC
3. Update `requireAdmin` to delegate to `requirePermission('admin', 'access')`
4. Eventually deprecate and remove `users.isAdmin` column

Start with step 3 — it's the lowest-risk change:

```typescript
// In admin.ts
fastify.decorate('requireAdmin', async (request: FastifyRequest) => {
  await fastify.requirePermission('admin', 'access')(request);
});
```

**Test:** Verify admin-protected routes still work. Verify users with RBAC admin role can access. Verify users without the role are denied.

---

### SMELL-8: No automated expired session cleanup (MEDIUM)

**File:** `src/modules/session/session.service.ts`

**Root cause:** `deleteExpiredSessions()` exists but is never called.

**Fix:**
- Add a periodic cleanup interval in the server startup (e.g., `app.ts` or a lifecycle plugin)
- Clean up sessions, challenges, login attempts, and PAR requests

```typescript
// In a lifecycle plugin or app.ts
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

fastify.addHook('onReady', () => {
  const interval = setInterval(async () => {
    try {
      await deleteExpiredSessions(db);
      // also clean up other expired records
    } catch (err) {
      fastify.log.error(err, 'Session cleanup failed');
    }
  }, CLEANUP_INTERVAL_MS);

  fastify.addHook('onClose', () => clearInterval(interval));
});
```

**Test:** Verify the cleanup runs and removes expired records. Verify it doesn't remove active sessions.

---

### SMELL-9: Account session list includes expired sessions (LOW)

**File:** `src/modules/account/account.service.ts`

**Root cause:** `listSessions()` queries with only `eq(sessions.userId, userId)` — no expiration filter.

**Fix:**
- Add `gt(sessions.expiresAt, new Date())` to the where clause

```typescript
const rows = await db
  .select(sessionColumns)
  .from(sessions)
  .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
```

Apply the same filter in admin `listSessions()` if applicable.

**Test:** Create sessions with past and future expiry dates. Verify only non-expired sessions are returned.

---

### SMELL-10: `ilike` pattern injection in admin user search (LOW)

**File:** `src/modules/admin/admin.service.ts`

**Root cause:** `%` and `_` in search input are interpreted as SQL LIKE wildcards.

**Fix:**
- Escape LIKE special characters before wrapping:

```typescript
function escapeLikePattern(input: string): string {
  return input.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// Usage:
if (query.email) {
  const escaped = escapeLikePattern(query.email);
  conditions.push(ilike(users.email, `%${escaped}%`));
}
```

**Test:** Search for email containing `%` or `_` — verify results are exact matches, not wildcard matches.

---

### SMELL-11: CORS hardcoded to single origin (LOW)

**File:** `src/app.ts`

**Root cause:** Global CORS uses `origin: env.WEBAUTHN_ORIGIN` (single URL). The admin dashboard on a different port can't make cross-origin requests.

**Fix:**
- Add a `CORS_ORIGINS` env variable that accepts comma-separated origins
- Parse and pass as array to `@fastify/cors`

```typescript
// In env.ts
CORS_ORIGINS: z.string().default('http://localhost:3100,http://localhost:3002'),

// In app.ts
await app.register(cors, {
  origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()),
  credentials: true,
});
```

**Test:** Verify requests from both configured origins receive CORS headers. Verify unlisted origins are rejected.

## Formatting Rules (Biome)

All changes must pass biome lint:
- 2-space indent, single quotes, always semicolons, trailing commas everywhere
- Arrow functions always parenthesized: `(x) => x`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- No `any` — use `unknown`
- Line width: 100 characters

## Verification

After applying any refactor:

```bash
pnpm biome check .                     # Lint passes
pnpm --filter server test:unit         # Unit tests pass
pnpm --filter server test:integration  # Integration tests pass (if applicable)
```

## Checklist

- [ ] Read the audit report entry and all affected source files
- [ ] Grep for all callers/dependents of the changed code
- [ ] Apply the refactor incrementally — verify tests pass after each step
- [ ] Add tests for the hardened/improved behavior
- [ ] Document any env variable changes in `.env.example`
- [ ] Note any migration steps needed for deployment
- [ ] All existing tests still pass
- [ ] `pnpm biome check .` passes
