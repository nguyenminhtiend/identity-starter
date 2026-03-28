---
name: remove-redundant
description: >-
  Remove redundant and duplicated code identified in the server API audit report
  (docs/AUDIT_REPORT.md). Use when the user references a REDUNDANT-N issue
  (REDUNDANT-1 through REDUNDANT-6), asks to deduplicate code, consolidate
  utilities, remove copy-pasted logic, unify patterns, or address any item from
  the Redundant API / Logic section of the audit report. Also trigger when the
  user mentions isUniqueViolation duplication, duplicated mapping functions,
  TOTP construction duplication, inconsistent factory patterns, POST /api/users
  bypass, or dual admin models. These are consolidation tasks — extract shared
  code, remove duplicates, and unify inconsistent patterns.
---

# Remove Redundant Skill

Address items from the **Redundant API / Logic** section of
`docs/AUDIT_REPORT.md`. These are duplicated functions, inconsistent patterns,
and overlapping endpoints that need consolidation.

## Before Removing Redundancy

1. Read `docs/AUDIT_REPORT.md` for the full description of the redundancy
2. Read ALL files involved — both the duplicate sources and the target location
3. Grep for all usages of the function/pattern being consolidated to find every call site
4. Read existing tests for all affected modules — tests need updating too

## General Deduplication Workflow

1. **Map all instances** — grep for the duplicated function/pattern across the entire codebase. The audit report may not list every occurrence.
2. **Choose the canonical location** — pick the module that owns the concept, or extract to a shared location (`packages/core`, `src/core/`).
3. **Extract and export** — move the function to the canonical location with proper types.
4. **Update all import sites** — replace every duplicate with an import from the canonical location.
5. **Delete the duplicates** — remove the old copies entirely. No `// removed` comments, no re-exports.
6. **Update tests** — tests that imported the old location need updating. Tests for the canonical version should be comprehensive.

## Redundancy Reference

### REDUNDANT-1: `isUniqueViolation()` duplicated in 3 files

**Files:**
- `src/modules/auth/auth.service.ts` (lines 41-51)
- `src/modules/user/user.service.ts` (lines 34-44)
- `src/modules/client/client.service.ts` (lines 19-29)

**Root cause:** Identical function checking for PostgreSQL error code `23505` copy-pasted across three service files.

**Fix:**
1. Create `src/core/db-utils.ts` (or add to an existing shared utility)
2. Extract the canonical `isUniqueViolation`:

```typescript
// src/core/db-utils.ts
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const pgCode = (error as { code?: string }).code;
  if (pgCode === '23505') {
    return true;
  }
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === '23505';
}
```

3. Update imports in all three service files:
```typescript
import { isUniqueViolation } from '../../core/db-utils.js';
```

4. Delete the three local copies

**Test:** The existing service tests already exercise unique violation handling. Add a focused unit test for `isUniqueViolation` in `src/core/__tests__/db-utils.test.ts` covering: plain PG error, Drizzle-wrapped error (with `cause`), non-Error input, and non-unique errors.

---

### REDUNDANT-2: `mapOAuthClientRow()` duplicated across OAuth and Client modules

**Files:**
- `src/modules/oauth/oauth.service.ts` (lines 128-149): `mapOAuthClientRow()` + `OauthClientSafeRow`
- `src/modules/client/client.service.ts` (lines 31-52): `mapToClientResponse()` + `SafeRowResult`

**Root cause:** Two functions doing the same DB row-to-`ClientResponse` mapping. The Client module owns this concept.

**Fix:**
1. Keep `mapToClientResponse()` in `client.service.ts` — it's the owner
2. Export it from the Client module's `index.ts` barrel:
```typescript
// src/modules/client/index.ts
export { mapToClientResponse } from './client.service.js';
```
3. In `oauth.service.ts`, replace:
```typescript
import { mapToClientResponse } from '../client/index.js';
```
4. Delete `mapOAuthClientRow()` and `OauthClientSafeRow` type from `oauth.service.ts`
5. Update any references within `oauth.service.ts` from `mapOAuthClientRow(row)` to `mapToClientResponse(row)`

**Important:** Verify the type signatures are compatible. The OAuth module may need to pass the same column selection as the Client module expects. Check that `SafeRowResult` / `OauthClientSafeRow` are structurally equivalent.

**Test:** Existing OAuth tests should pass without changes if the mapping is identical. Run both module test suites.

---

### REDUNDANT-3: TOTP construction duplicated 3 times

**File:** `src/modules/mfa/mfa.service.ts` (lines 80-87, 132-139, 285-292)

**Root cause:** `new OTPAuth.TOTP({ issuer, label, secret, algorithm: 'SHA1', digits: 6, period: 30 })` appears in `enrollTotp`, `verifyTotpEnrollment`, and `verifyMfaChallenge`.

**Fix:**
- Extract a helper within the same file (this is module-internal, not cross-module):

```typescript
function createTotpInstance(secretHex: string, label?: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: env.TOTP_ISSUER ?? 'IdentityStarter',
    label,
    secret: OTPAuth.Secret.fromHex(secretHex),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
}
```

- Replace all three constructions with calls to `createTotpInstance()`
- Keep the helper private to the module (no export needed)

**Why this matters beyond DRY:** If TOTP parameters change (e.g., upgrading from SHA1 to SHA256), three locations must be updated in lockstep. Missing one silently breaks verification for enrolled users — their OTPs stop validating with no error message.

**Test:** Existing MFA tests should pass unchanged. The behavior is identical — only the code structure changes.

---

### REDUNDANT-4: Inconsistent service factory pattern in Auth module

**Files:**
- `src/modules/auth/auth.service.ts` — `createAuthService()` factory (used in routes)
- `src/modules/auth/password-reset.service.ts` — `createPasswordResetService()` factory (defined but unused)
- `src/modules/auth/auth.routes.ts` — calls `requestPasswordReset` and `resetPassword` as bare functions

**Root cause:** Auth module uses factory pattern for main service but imports password-reset functions directly, bypassing the factory.

**Fix:**
1. In `auth.routes.ts`, use the factory:
```typescript
const passwordResetService = createPasswordResetService({ db, eventBus });

// In forgot-password route:
const result = await passwordResetService.requestPasswordReset(request.body.email);

// In reset-password route:
await passwordResetService.resetPassword(request.body);
```

2. Remove the bare function imports from `auth.routes.ts`
3. Ensure `createPasswordResetService` is exported from the auth module barrel

**Check the factory shape:** Read `createPasswordResetService()` to verify it returns an object with `requestPasswordReset` and `resetPassword` methods. If it doesn't exist yet, create it following the same pattern as `createAuthService()`.

**Test:** Existing route tests should pass. If route tests mock the bare functions, update mocks to mock the factory return value instead.

---

### REDUNDANT-5: `POST /api/users` bypasses the registration flow

**File:** `src/modules/user/user.routes.ts`

**Root cause:** `POST /api/users` creates users via `user.service.create()` without password hashing, email verification, or session creation. Any authenticated user can create accounts.

**Fix — option A (recommended): Remove the endpoint.**
- Delete the POST route from `user.routes.ts`
- User creation should only happen through `POST /auth/register`
- Update the barrel export if the route function was exported

**Fix — option B: Restrict to admin with proper security.**
- Gate behind `requireAdmin` or `requirePermission('users', 'write')`
- Add password hashing if the endpoint accepts passwords
- Add email verification token generation

Option A is simpler and safer. The endpoint likely exists from early scaffolding and was never meant for production.

**Test:** If removing, ensure no other code calls this endpoint. Grep for `POST /api/users` in tests and frontend code. Remove or update related tests.

---

### REDUNDANT-6: `requireAdmin` and `requirePermission` perform overlapping DB queries

**Files:** `src/core/plugins/admin.ts`, `src/core/plugins/rbac.ts`

**Root cause:** Two authorization models (`isAdmin` boolean + RBAC permissions) coexist. Both independently validate the session and query the database.

**Fix — phased migration:**

**Phase 1 (this task):** Make `requireAdmin` delegate to RBAC:
```typescript
// In admin.ts — delegate to RBAC
fastify.decorate('requireAdmin', async (request: FastifyRequest) => {
  await fastify.requirePermission('admin', 'access')(request);
});
```

**Phase 2 (separate task):** Ensure RBAC has proper admin role/permission seeded. Check that `backfillAdminRoles()` has been run or is part of migrations.

**Phase 3 (separate task):** Deprecate and remove `users.isAdmin` column via a migration.

**Important:** This is the same issue as SMELL-7. If SMELL-7 is being worked on, coordinate to avoid conflicts. The solution is identical.

**Test:** Verify admin-gated routes work with RBAC permissions. Test that a user with RBAC admin role can access admin routes. Test that a user without the role is denied.

## Formatting Rules (Biome)

All changes must pass biome lint:
- 2-space indent, single quotes, always semicolons, trailing commas everywhere
- Arrow functions always parenthesized: `(x) => x`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- No `any` — use `unknown`
- Line width: 100 characters

## Verification

After applying any deduplication:

```bash
pnpm biome check .                     # Lint passes
pnpm --filter server test:unit         # Unit tests pass
pnpm --filter server test:integration  # Integration tests pass
```

Run tests for **all affected modules**, not just the one you edited. Deduplication touches multiple modules by definition.

## Checklist

- [ ] Grep the entire codebase for all instances of the duplicated code
- [ ] Choose the canonical location (module owner or shared utility)
- [ ] Extract with proper types and export
- [ ] Update ALL import sites (not just the ones in the audit report)
- [ ] Delete ALL duplicate copies — no dead code left behind
- [ ] Update barrel exports (`index.ts`) for affected modules
- [ ] Update tests to import from the new location
- [ ] Add focused tests for extracted utilities
- [ ] Run tests for ALL affected modules
- [ ] `pnpm biome check .` passes
