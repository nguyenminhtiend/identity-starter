# Identity Starter Server — Code Review Audit

## CRITICAL — Fix Immediately

### CRIT-1: `super_admin` role assignable via API → full privilege escalation

Any principal with `roles:write` permission can call `assignRole` with the `super_admin` role UUID. `hasPermission` unconditionally returns true for `super_admin`, granting full access to everything.

**Location:** `apps/server/src/modules/rbac/rbac.service.ts` lines 102-113

```typescript
export async function assignRole(
  db: Database,
  eventBus: EventBus,
  userId: string,
  roleId: string,
  assignedBy: string,
): Promise<void> {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) {
    throw new NotFoundError('Role', roleId);
  }
}
```

**Fix:**

```typescript
const [role] = await db
  .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
  .from(roles)
  .where(eq(roles.id, roleId))
  .limit(1);
if (!role) {
  throw new NotFoundError('Role', roleId);
}
if (role.name === 'super_admin') {
  throw new ForbiddenError('Cannot assign super_admin through the API');
}
```

---

### CRIT-2: DPoP-bound access tokens accepted via `Bearer` on `/oauth/userinfo`

When a JWT contains `cnf.jkt` (DPoP-bound), a client using `Authorization: Bearer` skips proof-of-possession validation entirely. The DPoP proof check only runs when `isDpop === true`, which requires `DPoP` prefix. An attacker who steals the JWT can use it without the private key.

**Location:** `apps/server/src/modules/oauth/oauth.routes.ts` lines 309-313

```typescript
      if (isDpop) {
        const dpopHdr = request.headers.dpop;
        // ... proof validation only here ...
      }
      // continues to return userinfo regardless
```

**Fix:**
After `verifyAccessToken`, check if the token is DPoP-bound and reject Bearer:

```typescript
const cnf = result.payload.cnf as { jkt?: string } | undefined;
if (cnf?.jkt) {
  if (!isDpop) {
    throw new UnauthorizedError('DPoP proof required for DPoP-bound token');
  }
  // ... existing DPoP validation ...
}
```

---

### CRIT-3: MFA challenge consumed AFTER session creation → race yields double sessions

Two parallel `/mfa/verify` requests with the same `mfaToken` can both pass the `usedAt IS NULL` select, both create sessions, and then both mark the challenge used. The `createSession` call (line 320) happens before the `UPDATE ... SET usedAt` (line 326).

**Location:** `apps/server/src/modules/mfa/mfa.service.ts` lines 320-326

```typescript
  const session = await createSession(db, eventBus, {
    userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  await db.update(mfaChallenges).set({ usedAt: now }).where(eq(mfaChallenges.id, challenge.id));
```

**Fix:**
Atomic claim-then-create inside a transaction:

```typescript
const session = await db.transaction(async (tx) => {
  const [claimed] = await tx
    .update(mfaChallenges)
    .set({ usedAt: now })
    .where(and(eq(mfaChallenges.id, challenge.id), isNull(mfaChallenges.usedAt)))
    .returning({ id: mfaChallenges.id });
  if (!claimed) {
    throw new UnauthorizedError('Invalid or expired MFA token');
  }
  return createSession(tx, eventBus, {
    userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
});
```

---

## HIGH — Must Fix Soon

### HIGH-1: Password reset token TOCTOU — single-use not enforced

Same race pattern as CRIT-3. The `usedAt` check is outside the transaction; two concurrent requests can both pass and reset the password twice (and revoke all sessions twice).

**Location:** `apps/server/src/modules/auth/password-reset.service.ts` lines 70-78

```typescript
  const [record] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.token, input.token))
    .limit(1);
  if (!record || record.usedAt !== null || record.expiresAt <= new Date()) {
    throw new UnauthorizedError('Invalid or expired reset token');
  }
```

**Fix:**
Move the claim inside the transaction:

```typescript
const newHash = await hashPassword(input.newPassword);
await db.transaction(async (tx) => {
  const [claimed] = await tx
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.token, input.token),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .returning({ id: passwordResetTokens.id, userId: passwordResetTokens.userId });
  if (!claimed) {
    throw new UnauthorizedError('Invalid or expired reset token');
  }
  await tx
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, claimed.userId));
});
```

---

### HIGH-2: Plaintext password-reset token leaked via event bus

The full bearer-equivalent token is broadcast to every event subscriber. Any handler that logs, forwards to analytics, or stores events leaks the reset link.

**Location:** `apps/server/src/modules/auth/password-reset.service.ts` lines 54-60

```typescript
  await eventBus.publish(
    createDomainEvent(AUTH_EVENTS.PASSWORD_RESET_REQUESTED, {
      userId: user.id,
      email: user.email,
      token,
    }),
  );
```

**Fix:**
Publish only non-secret identifiers. Pass the raw token only to the email-sending service directly, not through the general event bus:

```typescript
await eventBus.publish(
  createDomainEvent(AUTH_EVENTS.PASSWORD_RESET_REQUESTED, {
    userId: user.id,
    email: user.email,
    // no token here
  }),
);
```

---

### HIGH-3: IDOR on `GET /api/users/:id` — any user can read any profile

Any authenticated user can pass an arbitrary UUID and receive another user's email, status, metadata.

**Location:** `apps/server/src/modules/user/user.routes.ts` lines 11-22

```typescript
  fastify.get(
    '/:id',
    {
      schema: {
        params: userIdParamSchema,
        response: { 200: userResponseSchema },
      },
    },
    async (request) => {
      return userService.findById(request.params.id);
    },
  );
```

**Fix:**

```typescript
async (request) => {
  if (request.params.id !== request.userId) {
    throw new ForbiddenError('Cannot access another user\'s profile');
  }
  return userService.findById(request.params.id);
},
```

Or better: replace with `GET /me` using `request.userId`.

---

### HIGH-4: PAR `request_uri` consumption not atomic — double authorization

Same TOCTOU pattern. Two concurrent `/oauth/authorize?request_uri=urn:...` can both pass `usedAt === null` and execute two authorization flows from one PAR.

**Location:** `apps/server/src/modules/oauth/par.service.ts` lines 37-42

```typescript
  const [row] = await db
    .select().from(parRequests)
    .where(eq(parRequests.requestUri, requestUri)).limit(1);
  // ...
  if (row.usedAt !== null) { throw ... }
  await db.update(parRequests).set({ usedAt: new Date() }).where(eq(parRequests.id, row.id));
```

**Fix:**
`UPDATE ... WHERE used_at IS NULL RETURNING *` in a transaction, same pattern as CRIT-3/HIGH-1.

---

### HIGH-5: `setRolePermissions` not transactional — crash leaves role with zero permissions

Delete and insert are separate statements. A crash between them strips all permissions from the role.

**Location:** `apps/server/src/modules/rbac/rbac.service.ts` lines 91-97

```typescript
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (permissionIds.length > 0) {
    await db
      .insert(rolePermissions)
      .values(permissionIds.map((permissionId) => ({ roleId, permissionId })));
  }
```

**Fix:**

```typescript
await db.transaction(async (tx) => {
  await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (permissionIds.length > 0) {
    await tx.insert(rolePermissions).values(
      permissionIds.map((permissionId) => ({ roleId, permissionId })),
    );
  }
});
```

---

### HIGH-6: Audit hash chain only covers `id + action + createdAt` — tamperable

`details`, `actorId`, `resourceType`, `resourceId`, `ipAddress` are all excluded from the hash. A DB-level attacker can modify any of these columns without breaking chain verification.

**Location:** `apps/server/src/modules/audit/audit.service.ts` lines 8-9

```typescript
function computeHash(id: string, action: string, createdAt: Date): string {
  return createHash('sha256').update(`${id}${action}${createdAt.toISOString()}`).digest('hex');
```

**Fix:**
Hash a canonical JSON of the full row:

```typescript
function computeHash(entry: {
  id: string; action: string; createdAt: Date;
  actorId: string | null; resourceType: string;
  resourceId: string | null; details: unknown;
  ipAddress: string | null; prevHash: string | null;
}): string {
  const canonical = JSON.stringify({
    id: entry.id, action: entry.action, createdAt: entry.createdAt.toISOString(),
    actorId: entry.actorId, resourceType: entry.resourceType,
    resourceId: entry.resourceId, details: entry.details,
    ipAddress: entry.ipAddress, prevHash: entry.prevHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
```

---

### HIGH-7: Concurrent audit inserts break the chain

Two simultaneous `createAuditLog` calls read the same `lastEntry`, compute the same `prevHash`, and insert two rows pointing to the same predecessor. Verification will fail for one of them.

**Location:** `apps/server/src/modules/audit/audit.service.ts` lines 44-48

```typescript
  const [lastEntry] = await db
    .select({ ... })
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
```

**Fix:**
Serialize audit writes with an advisory lock or `SERIALIZABLE` transaction, or queue audit inserts through a single-writer channel (e.g. the event bus handler processes sequentially).

---

### HIGH-8: Audit listener stores raw event payloads including secrets

The listener blindly dumps payload as `details`. Events like `PASSWORD_RESET_REQUESTED` (which currently includes the token — HIGH-2) get persisted to `audit_logs`.

**Fix:**
Allowlist fields per event type, or redact sensitive keys before persistence.

---

### HIGH-9: Postgres connection pool never closed on shutdown

`createDb` returns `{ db, client }` but `container.ts` only keeps `db`. The underlying postgres connection pool is orphaned — never closed on `app.close()`.

**Location:** `apps/server/src/core/container.ts` lines 16-18

```typescript
  const { db } = createDb(env.DATABASE_URL);
  instance = { db, eventBus: new InMemoryEventBus() };
```

**Fix:**
Store client and close it:

```typescript
const { db, client } = createDb(env.DATABASE_URL);
instance = { db, client, eventBus: new InMemoryEventBus() };
// In app.ts onClose hook:
app.addHook('onClose', async () => {
  await container.client.end({ timeout: 5 });
});
```

---

### HIGH-10: JWT `audience` not validated on userinfo/introspection

Access tokens are issued with `aud: client_id`, but `/oauth/userinfo` calls `verifyAccessToken` without an audience parameter. A token minted for client A is valid at userinfo when presented by client B.

**Location:** `apps/server/src/modules/oauth/oauth.routes.ts` lines 321-323

```typescript
      const localJwks = jose.createLocalJWKSet(jwks);
      const result = await verifyAccessToken(localJwks, token, env.JWT_ISSUER);
      // no audience parameter ^^^
```

**Fix:**
Pass an expected audience or validate `aud` in application code after verification.

---

## MEDIUM — Should Fix

### MED-1: `pending_verification` users can password-login

Only `suspended` is rejected. Users with `status === 'pending_verification'` get a full session. Email verification is not an auth gate.

**Location:** `apps/server/src/modules/auth/auth.service.ts` lines 102-105

```typescript
  if (row.status === 'suspended') {
    // rejected
  }
  // pending_verification? passes through
```

**Fix:**
Add a check after password verification if your product requires verified email before API access.

---

### MED-2: MFA verify doesn't re-check suspension

Between password-OK and `/mfa/verify`, an admin could suspend the user. `verifyMfaChallenge` doesn't re-check `users.status`, so a session can be issued for a suspended account.

---

### MED-3: Login throttling leaks per-email failure history (user enumeration)

`TooManyRequestsError` fires before password check, based on email-keyed failure counts. An attacker can detect which emails have been targeted by prior attempts.

**Location:** `apps/server/src/modules/auth/auth.service.ts` lines 82-86

```typescript
  const failureCount = await getRecentFailureCount(db, input.email);
  const delaySec = calculateDelay(failureCount);
  if (delaySec > 0) {
    throw new TooManyRequestsError(delaySec);
  }
```

**Fix:**
Apply throttling after password verification, or use IP-based throttling with generic errors. Always run dummy `verifyPassword` for missing users.

---

### MED-4: ILIKE escape doesn't handle backslash

**Location:** `apps/server/src/modules/admin/admin.service.ts` lines 17-19

```typescript
function escapeLikePattern(input: string): string {
  return input.replace(/%/g, '\\%').replace(/_/g, '\\_');
}
```

Backslash is PostgreSQL's default LIKE escape character. Input containing `\` can produce unintended wildcards.

**Fix:**
Escape backslashes first: `input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');`

---

### MED-5: Discovery metadata DPoP algorithms don't match implementation

Discovery advertises `['ES256', 'RS256']`, but `dpop.service.ts` accepts `RS384, RS512, PS256, PS384, PS512, ES384, ES512`. Clients relying on discovery will use a subset.

**Fix:**
Align the arrays — either expand discovery or narrow the implementation.

---

### MED-6: Audit export loads up to 100k rows into memory

**Location:** `apps/server/src/modules/audit/audit.service.ts` lines 93-98

```typescript
export async function exportAuditLogs(db: Database, query: AuditExportQuery) {
  // ...
  return db.select().from(auditLogs).where(where)
    .orderBy(asc(auditLogs.createdAt))
    .limit(MAX_EXPORT_ROWS);
}
```

All rows are stringified to NDJSON in one shot. OOM risk under load.

**Fix:**
Stream rows using a cursor and `reply.raw.write()` per line.

---

### MED-7: `LOGIN` event emitted before MFA completes

**Location:** `apps/server/src/modules/auth/auth.service.ts` lines 136-138

```typescript
    await eventBus.publish(createDomainEvent(AUTH_EVENTS.LOGIN, { userId: row.id }));
    return { mfaRequired: true, mfaToken };
```

SIEM sees "login" before the user passes MFA. Misleading for audit and automation.

**Fix:**
Emit `PASSWORD_VERIFIED` here, `LOGIN` only after full session creation.

---

### MED-8: `decorateRequest('session', null as unknown as SessionLike)`

```typescript
fastify.decorateRequest('session', null as unknown as SessionLike);
```

This lies to TypeScript — handlers that skip `requireSession` see session typed as `SessionLike` but it's null at runtime. Use `SessionLike | null` in the module augmentation.

---

### MED-9: Session cleanup interval can overlap

```typescript
setInterval(async () => {
  await deleteExpiredSessions(options.container.db);
}, CLEANUP_INTERVAL_MS);
```

If cleanup takes longer than the interval, runs pile up. Use setTimeout chaining or a mutex.

---

### MED-10: Cookie `secure` flag tied only to `NODE_ENV`

```typescript
secure: process.env.NODE_ENV === 'production',
```

Staging behind TLS with `NODE_ENV !== 'production'` sends cookies over HTTP. Drive from explicit config.

---

### MED-11: `COOKIE_SECRET` / `TOTP_ENCRYPTION_KEY` defaults only rejected in `production`

Any non-production `NODE_ENV` (staging, uat) accepts the default `change-me-in-production`. Extend the check to all production-like environments.

---

### MED-12: DPoP `jti` replay not tracked

RFC 9449 recommends preventing proof replay. Currently only the `iat` window (~360s) limits reuse.

**Fix:**
Store `jti` in Redis with TTL matching proof max age; reject duplicates.

---

### MED-13: Unbounded `listClients` query

**Location:** `apps/server/src/modules/client/client.service.ts` lines 91-94

```typescript
export async function listClients(db: Database): Promise<ClientResponse[]> {
  const rows = await db.select(oauthClientColumns).from(oauthClients);
  return rows.map((r) => mapToClientResponse(r));
}
```

No pagination. Add limit/offset with a max page size.

---

### MED-14: Passkey challenge selected without ordering

**Location:** `apps/server/src/modules/passkey/passkey.service.ts` lines 92-99

```typescript
  const [challenge] = await db
    .select().from(webauthnChallenges)
    .where(and(
      eq(webauthnChallenges.userId, userId),
      eq(webauthnChallenges.type, 'registration'),
      gt(webauthnChallenges.expiresAt, new Date()),
    ))
    .limit(1);
```

If multiple unexpired challenges exist, selection is non-deterministic → flaky failures. Add `orderBy(desc(webauthnChallenges.createdAt))` or delete prior challenges on new registration options.

---

### MED-15: Recovery code insert loop — not batched

**Location:** `apps/server/src/modules/mfa/mfa.service.ts` lines 109-112

```typescript
  for (const code of rawCodes) {
    const codeHash = hmacRecoveryCode(code, encryptionKey);
    await db.insert(recoveryCodes).values({ userId, codeHash });
  }
```

8 sequential inserts. Batch into one `INSERT ... VALUES` call with an array.

---

## LOW — Improvements / Nitpicks

| ID | Issue | Location |
| :--- | :--- | :--- |
| LOW-1 | `recovery_code` comparison uses `===` instead of `timingSafeEqual` | `mfa.service.ts:303` |
| LOW-2 | PKCE `code_verifier` comparison uses `===` | `oauth.service.ts` |
| LOW-3 | `decrypt()` doesn't validate ciphertext shape before `Buffer.from(undefined)` | `core/crypto.ts:22` |
| LOW-4 | Dynamic `await import('jose')` on every JWT auth request (cold path cost) | `core/plugins/auth.ts:71` |
| LOW-5 | Health check doesn't probe DB/Redis | `core/health.routes.ts` — add `/ready` endpoint |
| LOW-6 | `genReqId: () => crypto.randomUUID()` uses implicit global `crypto` | `app.ts:30` — use explicit import |
| LOW-7 | `vitest.config.ts` has `passWithNoTests: true` | CI can green with zero tests |
| LOW-8 | `amr` always `['pwd']` in OIDC tokens even for passkey auth | `oauth.service.ts:500` |
| LOW-9 | Passkey routes cast `request.body` as `unknown as RegistrationResponseJSON` | `passkey.routes.ts:38` — use proper Zod validation |
| LOW-10 | `password-reset.service.ts:39-40` — `count` field name guessing (`value ?? count`) | Fragile; align with a single alias |
| LOW-11 | In-memory event bus is not durable or shared across instances | Document limitation or replace with Redis pub/sub |
| LOW-12 | Dual admin model (`requireAdmin` uses `hasPermission + isAdmin` fallback) | Consolidate to RBAC only |
| LOW-13 | Passkey login error 'Passkey not found' enables credential enumeration | Use generic error |
| LOW-14 | Revocation endpoint is a no-op for JWT access tokens | Document or add `jti` denylist |

---

## Summary

**Counts:** 3 CRITICAL, 10 HIGH, 15 MEDIUM, 14 LOW

The most dangerous systemic pattern is check-then-act without atomicity (CRIT-3, HIGH-1, HIGH-4, HIGH-5, HIGH-7). Wrapping those in `UPDATE ... WHERE condition RETURNING` inside transactions eliminates the entire class. The RBAC escalation (CRIT-1) and DPoP bypass (CRIT-2) should be the first two fixes deployed.
