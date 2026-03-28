---
name: fix-bug
description: >-
  Fix bugs identified in the server API audit report (docs/AUDIT_REPORT.md).
  Use when the user references a BUG-N issue (BUG-1 through BUG-10), asks to
  fix a security bug, mentions token leaks, event bus issues, non-atomic
  operations, login throttling, or unbounded queries. Also trigger when the user
  says "fix bug from audit", "address BUG-X", or references any issue from the
  Bugs section of the audit report. Each bug has a specific root cause and
  prescribed fix — this skill ensures the fix is correct, safe, and tested.
---

# Fix Bug Skill

Fix bugs from the **Bugs & Incorrect Logic** section of `docs/AUDIT_REPORT.md`.
These are logic errors, security flaws, and incorrect implementations that need
targeted fixes with regression tests.

## Before Fixing

1. Read `docs/AUDIT_REPORT.md` to understand the full bug description, root cause, and recommended solution
2. Read the affected source file(s) end-to-end to understand surrounding context
3. Read existing tests for the affected module to understand current coverage
4. Read the `zod-v4` skill when modifying Zod schemas
5. Read the `unit-test` and `integration-test` skills when writing regression tests

## General Fix Workflow

1. **Understand the root cause** — read the audit report entry and the actual source code. Verify the bug still exists (it may have been partially fixed).
2. **Write a failing test first** — capture the broken behavior in a test that currently fails or would fail. This proves the bug exists and prevents regressions.
3. **Apply the minimal fix** — change only what's necessary. Avoid refactoring surrounding code unless it's directly related to the bug.
4. **Verify the fix** — run the test suite for the affected module. Ensure no existing tests break.
5. **Update response schemas** — if the fix changes API response shapes (e.g., removing a field), update the corresponding Zod response schemas.

## Bug Reference

### BUG-1: `forgot-password` leaks reset token in response (CRITICAL)

**File:** `src/modules/auth/auth.routes.ts`

**Root cause:** The `POST /auth/forgot-password` handler returns `resetToken` in the JSON response body alongside the generic message.

**Fix:**
- Remove `resetToken` from the response object — return only `{ message }` in all cases
- Update the response schema to exclude `resetToken`
- In dev mode, log the token to console for testing convenience (use `fastify.log.debug`)
- The response must be identical whether the user exists or not (enumeration protection)

```typescript
// BEFORE (broken)
return reply.status(200).send({
  message: 'If an account exists...',
  resetToken: token ?? undefined,
});

// AFTER (fixed)
return reply.status(200).send({
  message: 'If an account exists, a password reset link has been sent.',
});
```

**Test:** Verify the response body has no `resetToken` property for both existing and non-existing emails.

---

### BUG-2: `resend-verification` leaks verification token (HIGH)

**File:** `src/modules/auth/email-verification.service.ts`

**Root cause:** `resendVerificationForEmail()` returns `{ message, verificationToken }` where `verificationToken` is the raw token when eligible, `undefined` otherwise.

**Fix:**
- Remove `verificationToken` from the return type — return only `{ message }`
- Update the route handler and response schema
- Log the token in dev mode for testing

**Test:** Verify the response contains only `message`, never `verificationToken`.

---

### BUG-3: `register` returns `verificationToken` in response (HIGH)

**Files:** `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.routes.ts`

**Root cause:** Registration calls `generateVerificationToken()` and includes the token in `AuthResponse`.

**Fix:**
- Remove `verificationToken` from `AuthResponse` type and `authResponseSchema`
- Update `toAuthResponse()` helper to not include it
- Log token in dev mode

**Test:** Verify registration response has no `verificationToken` field.

---

### BUG-4: Event bus `subscribe` wrapper ignores Emittery's event shape (MEDIUM)

**File:** `src/infra/event-bus.ts`

**Root cause:** The wrapper destructures `{ data }` from the argument, but Emittery passes the emitted value directly — not wrapped in `{ name, data }`. Handlers receive `undefined` instead of the actual event.

**Fix:**
- Remove the `EmitteryEvent` interface
- Fix the wrapper to pass the argument directly:

```typescript
// BEFORE (broken)
const wrapper = (wrapped: unknown) => {
  const { data } = wrapped as EmitteryEvent;
  return handler(data);
};

// AFTER (fixed)
const wrapper = (event: unknown) => handler(event as DomainEvent);
```

**Test:** Write an integration test that publishes an event and verifies the subscriber receives the correct payload (not `undefined`). This is critical — this bug silently breaks all event-driven side effects including audit logging.

---

### BUG-5: `password-reset` is not atomic (MEDIUM)

**File:** `src/modules/auth/password-reset.service.ts`

**Root cause:** `resetPassword()` performs four sequential operations without a transaction: validate token, update password, revoke sessions, mark token used.

**Fix:**
- Wrap steps 2-4 in a `db.transaction()` block
- Token validation (step 1) can stay outside since it's a read

```typescript
// AFTER (fixed)
await db.transaction(async (tx) => {
  await tx
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, record.userId));

  await revokeAllUserSessions(tx, eventBus, record.userId);

  await tx
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, record.id));
});
```

Note: `revokeAllUserSessions` needs to accept the transaction handle (`tx`) instead of `db`. Check if it already does — if not, update its signature to accept `Database | Transaction`.

**Test:** Verify that if an error occurs during session revocation, the password is not changed and the token remains unused.

---

### BUG-6: Login delay uses `setTimeout` holding connections (MEDIUM)

**File:** `src/modules/auth/auth.service.ts`

**Root cause:** Progressive login delay uses `await new Promise(resolve => setTimeout(resolve, delaySec * 1000))`, holding the HTTP connection open for up to 30 seconds.

**Fix:**
- Replace the `setTimeout` with an immediate HTTP 429 response
- Include a `Retry-After` header with the delay value

```typescript
// BEFORE (broken — holds connection)
if (delaySec > 0) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delaySec * 1000);
  });
}

// AFTER (fixed — immediate rejection)
if (delaySec > 0) {
  throw new TooManyRequestsError(delaySec);
}
```

You may need to create a `TooManyRequestsError` domain error class if one doesn't exist. It should map to HTTP 429 in the error handler plugin, and set the `Retry-After` header.

**Test:** Verify that when delay is triggered, the response is 429 with `Retry-After` header (not a delayed 200/401).

---

### BUG-7: Redundant catch re-throws identical error (LOW)

**File:** `src/modules/oauth/oauth.service.ts`

**Root cause:** The `authorize()` function wraps `getClientByClientId()` in a try-catch where both branches throw the same `error`.

**Fix:**
- Remove the try-catch entirely — let the error propagate naturally

```typescript
// BEFORE (dead code)
let client: ClientResponse;
try {
  client = await getClientByClientId(deps.db, query.client_id);
} catch (error) {
  if (error instanceof NotFoundError) {
    throw error;
  }
  throw error;
}

// AFTER (clean)
const client = await getClientByClientId(deps.db, query.client_id);
```

**Test:** Existing tests should continue to pass — no behavioral change.

---

### BUG-8: `x-session-cookie` header is attacker-controlled (MEDIUM)

**File:** `src/core/plugins/auth.ts`

**Root cause:** `getSessionCookieName()` reads the cookie name from the `x-session-cookie` request header with no validation.

**Fix:**
- Add a server-side allowlist of valid cookie names
- Validate the header value against the allowlist
- Fall back to the default if invalid

```typescript
const VALID_COOKIE_NAMES = new Set([DEFAULT_COOKIE_NAME, 'admin_session']);

export function getSessionCookieName(request: FastifyRequest): string {
  const header = request.headers['x-session-cookie'];
  if (typeof header === 'string' && VALID_COOKIE_NAMES.has(header)) {
    return header;
  }
  return DEFAULT_COOKIE_NAME;
}
```

**Test:** Verify that arbitrary cookie names are rejected, only allowlisted names work, and missing/empty header falls back to default.

---

### BUG-9: `verifyAuditChain` loads ALL audit logs into memory (MEDIUM)

**File:** `src/modules/audit/audit.service.ts`

**Root cause:** `verifyAuditChain()` runs a SELECT with no limit, loading every row into memory.

**Fix:**
- Implement cursor-based batch processing (e.g., 1000 rows at a time)
- Keep only the previous row's hash in memory for chain verification

```typescript
export async function verifyAuditChain(db: Database) {
  const BATCH_SIZE = 1000;
  let offset = 0;
  let previousHash: string | null = null;
  let totalEntries = 0;
  let firstInvalidEntryId: string | null = null;

  while (true) {
    const batch = await db
      .select()
      .from(auditLogs)
      .orderBy(asc(auditLogs.createdAt))
      .limit(BATCH_SIZE)
      .offset(offset);

    if (batch.length === 0) break;

    for (const entry of batch) {
      totalEntries++;
      // verify chain integrity with previousHash
      // ...
      previousHash = entry.hash;
    }

    if (batch.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return { valid: !firstInvalidEntryId, totalEntries, checkedEntries: totalEntries, firstInvalidEntryId };
}
```

**Test:** Verify chain verification works correctly with batched processing and returns early on the first invalid entry.

---

### BUG-10: `exportAuditLogs` has no row limit (LOW)

**File:** `src/modules/audit/audit.service.ts`

**Root cause:** `exportAuditLogs()` returns all matching rows with no limit or pagination.

**Fix:**
- Add a configurable max-row limit (e.g., 100,000)
- Return a flag or header indicating whether results were truncated

```typescript
const MAX_EXPORT_ROWS = 100_000;

export async function exportAuditLogs(db: Database, query: AuditExportQuery) {
  const conditions = buildWhereConditions(query);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(asc(auditLogs.createdAt))
    .limit(MAX_EXPORT_ROWS);
}
```

**Test:** Verify the query includes a limit and that results are capped.

## Formatting Rules (Biome)

All fixes must pass biome lint:
- 2-space indent, single quotes, always semicolons, trailing commas everywhere
- Arrow functions always parenthesized: `(x) => x`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- No `any` — use `unknown`
- Line width: 100 characters

## Verification

After applying any fix:

```bash
pnpm biome check .                     # Lint passes
pnpm --filter server test:unit         # Unit tests pass
pnpm --filter server test:integration  # Integration tests pass (if applicable)
```

## Checklist

- [ ] Read the audit report entry and source code before changing anything
- [ ] Write a regression test that captures the bug
- [ ] Apply the minimal fix — no unrelated refactoring
- [ ] Update Zod response schemas if API shape changed
- [ ] Update barrel exports if public API changed
- [ ] All existing tests still pass
- [ ] New regression test passes
- [ ] `pnpm biome check .` passes
