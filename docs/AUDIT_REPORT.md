# Identity Starter — Server API Audit Report

> Generated: 2026-03-28

---

## 1. Bugs & Incorrect Logic

### BUG-1: `forgot-password` endpoint leaks reset token in response (CRITICAL)

**File:** `src/modules/auth/auth.routes.ts:137`

**Description:** The `POST /auth/forgot-password` handler returns the raw password reset token (`resetToken`) directly in the HTTP JSON response body alongside the generic "If an account exists..." message.

**Why this is a problem:** Password reset tokens are one-time secrets that grant the ability to change a user's password. Exposing them in the API response means any client, proxy, browser extension, or network observer can capture the token. This completely negates the enumeration-protection pattern (the generic message) because the presence or absence of `resetToken` in the response reveals whether the account exists. Per OWASP 2026 guidelines, password reset tokens must only be delivered via a secure side-channel (email, SMS) and never in API responses.

**Solution:** Remove `resetToken` from the response schema and body. Introduce an `EmailService` (or a dev-mode `ConsoleEmailService` stub) that sends the token out-of-band. The endpoint should always return the same generic `{ message }` response regardless of whether the user exists.

---

### BUG-2: `resend-verification` leaks verification token in response (HIGH)

**File:** `src/modules/auth/email-verification.service.ts:117`

**Description:** The `resendVerificationForEmail()` function returns `{ message, verificationToken }` where `verificationToken` is the raw token when the user is eligible, and `undefined` otherwise.

**Why this is a problem:** Same root cause as BUG-1 — the verification token should be a server-side secret delivered via email. Returning it in the response leaks it to any observer and also leaks account existence/status (eligible users get a token, ineligible ones don't).

**Solution:** Remove `verificationToken` from the return type and response schema. Dispatch the token via the email service. Return only the generic message in all cases.

---

### BUG-3: `register` returns `verificationToken` in response (HIGH)

**File:** `src/modules/auth/auth.service.ts:83` + `src/modules/auth/auth.routes.ts:48`

**Description:** The registration flow calls `generateVerificationToken()` and includes the resulting token in the `AuthResponse` sent back to the client.

**Why this is a problem:** Verification tokens prove email ownership. If exposed in the registration response, any script can register an email and immediately verify it without access to the actual inbox, bypassing the entire email verification purpose. This is likely a development shortcut that was never removed.

**Solution:** Remove `verificationToken` from `AuthResponse` and `authResponseSchema`. Send the token via the email service. In dev mode, log it to console for convenience.

---

### BUG-4: Event bus `subscribe` wrapper ignores Emittery's actual event shape (MEDIUM)

**File:** `src/infra/event-bus.ts:37-40`

**Description:** The `subscribe` method wraps handlers with a function that casts the incoming argument as `EmitteryEvent` (`{ name, data }`) and reads `.data`. However, Emittery passes the emitted value directly — when `this.emitter.emit(eventName, event)` is called, the handler receives `event` itself, not `{ name: eventName, data: event }`.

**Why this is a problem:** The wrapper does `(wrapped as EmitteryEvent).data`, but `wrapped` is already the `DomainEvent` object. Since `DomainEvent` has no `.data` property, the handler receives `undefined`. This silently breaks all event subscribers, including the entire audit logging listener — meaning **no audit logs are being created from domain events**.

**Solution:** Remove the `EmitteryEvent` interface and fix the wrapper to pass the argument directly:
```ts
const wrapper = (event: unknown) => handler(event as DomainEvent);
```

---

### BUG-5: `password-reset` is not atomic (MEDIUM)

**File:** `src/modules/auth/password-reset.service.ts:80-92`

**Description:** The `resetPassword()` function performs four sequential operations outside a transaction: (1) validate token, (2) update password hash, (3) revoke all sessions, (4) mark token as used.

**Why this is a problem:** If the process crashes or an error occurs after step 2 but before step 4, the user's password has been changed but the reset token is still marked as unused. An attacker who intercepted the token could reuse it to reset the password again. This also means sessions may not be revoked, leaving the old password's sessions active after a reset.

**Solution:** Wrap steps 2-4 in a `db.transaction()` block, similar to how `verifyEmail` is implemented. Token validation (step 1) can remain outside the transaction since it's a read.

---

### BUG-6: Login delay uses server-side `setTimeout` holding connections (MEDIUM)

**File:** `src/modules/auth/auth.service.ts:98-101`

**Description:** When progressive login delay is triggered, the service uses `await new Promise(resolve => setTimeout(resolve, delaySec * 1000))` to artificially slow down the response. The delay can be up to 30 seconds.

**Why this is a problem:** This holds the HTTP connection, the Fastify request context, and associated memory open for the entire delay period. Under a distributed brute-force attack, an attacker can exhaust server connections and memory by triggering thousands of delayed requests simultaneously. This turns a brute-force mitigation into a denial-of-service vector. Node.js best practice (and OWASP rate-limiting guidance) is to reject immediately rather than hold connections.

**Solution:** Replace the `setTimeout` delay with an immediate HTTP 429 response containing a `Retry-After` header set to `delaySec`. This frees the connection immediately while still communicating the backoff period to legitimate clients.

---

### BUG-7: Redundant catch re-throws identical error (LOW)

**File:** `src/modules/oauth/oauth.service.ts:260-266`

**Description:** The `authorize()` function wraps `getClientByClientId()` in a try-catch where both the `if (error instanceof NotFoundError)` branch and the fallback branch throw the same `error` variable.

**Why this is a problem:** This is dead code that adds noise and suggests the developer intended different error handling (e.g., wrapping or transforming the error) but forgot to implement it. It makes the code misleading for future maintainers who may assume the catch block serves a purpose.

**Solution:** Remove the try-catch entirely. Let the `NotFoundError` propagate naturally.

---

### BUG-8: `x-session-cookie` header is attacker-controlled (MEDIUM)

**File:** `src/core/plugins/auth.ts:36-37`

**Description:** The `getSessionCookieName()` function reads the cookie name from the `x-session-cookie` request header. Any string value in this header becomes the cookie key that the server reads from `request.cookies`.

**Why this is a problem:** An attacker can set `x-session-cookie` to any arbitrary value, such as `__Host-csrf` or `_ga`, causing the server to read unrelated cookies as session tokens. While `validateSession` would reject invalid tokens, this creates a cookie confusion vector. More importantly, the server also *sets* cookies using this name (via `setSessionCookie`), meaning an attacker could cause the server to write session tokens into arbitrary cookie names, potentially overwriting security-relevant cookies.

**Solution:** Maintain a server-side allowlist of valid cookie names (e.g., `['session', 'admin_session']`). Validate the header value against this allowlist and fall back to the default if it doesn't match.

---

### BUG-9: `verifyAuditChain` loads ALL audit logs into memory (MEDIUM)

**File:** `src/modules/audit/audit.service.ts:104`

**Description:** The `verifyAuditChain()` function runs `db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt))` with no limit, loading every audit log row into a JavaScript array.

**Why this is a problem:** For an identity provider in production, the audit log table can grow to millions of rows. Loading them all into memory will cause Node.js to run out of heap memory and crash. Even before OOM, the query will block the event loop during JSON parsing of the large result set and cause request timeouts for other users.

**Solution:** Implement cursor-based streaming verification that processes rows in batches (e.g., 1000 at a time), keeping only the previous row's hash in memory. Alternatively, use a database-side verification function (PL/pgSQL) that returns only the first invalid entry.

---

### BUG-10: `exportAuditLogs` has no row limit (LOW)

**File:** `src/modules/audit/audit.service.ts:91-96`

**Description:** The `exportAuditLogs()` function accepts date filters but has no row limit or pagination. It returns all matching rows as a single array.

**Why this is a problem:** A broad date range (or no date filter) could return millions of rows, consuming excessive memory and potentially crashing the server. The NDJSON response is also built entirely in memory before sending.

**Solution:** Add a configurable max-row limit (e.g., 100,000) and use Fastify's streaming response to write NDJSON line-by-line. Return a `206 Partial Content` or a `Link` header for continuation if the limit is reached.

---

## 2. Redundant API / Logic

### REDUNDANT-1: `isUniqueViolation()` duplicated in 3 files

**Files:** `src/modules/auth/auth.service.ts:41-51`, `src/modules/user/user.service.ts:34-44`, `src/modules/client/client.service.ts:19-29`

**Description:** The exact same function that checks for PostgreSQL unique constraint violation (`code === '23505'`) is copy-pasted across three service files with identical logic.

**Why this is a problem:** Duplicated utility functions increase maintenance burden. If the error shape changes (e.g., a Drizzle ORM version upgrade changes how PG errors are surfaced), all three copies must be updated independently, and it's easy to miss one.

**Solution:** Extract `isUniqueViolation(error: unknown): boolean` into `packages/core/src/errors.ts` (alongside `DomainError`) or into `apps/server/src/core/db-utils.ts`. Import it in all three service files.

---

### REDUNDANT-2: `mapOAuthClientRow()` duplicated across OAuth and Client modules

**Files:** `src/modules/oauth/oauth.service.ts:128-149` vs `src/modules/client/client.service.ts:31-52`

**Description:** Both modules have nearly identical functions that map a raw DB row to a `ClientResponse` object. The OAuth module's version is named `mapOAuthClientRow` and the Client module's is `mapToClientResponse`, but they do the same thing.

**Why this is a problem:** Two copies of the same mapping logic means changes to the `ClientResponse` shape require updates in two places. The OAuth module also defines its own `OauthClientSafeRow` type alias when it could reuse the one from the Client module.

**Solution:** Export `mapToClientResponse` from `client.service.ts` and import it in `oauth.service.ts`. Remove the duplicate `mapOAuthClientRow` and `OauthClientSafeRow` type.

---

### REDUNDANT-3: TOTP construction duplicated 3 times

**File:** `src/modules/mfa/mfa.service.ts` lines 80-87, 132-139, 285-292

**Description:** The `new OTPAuth.TOTP({ issuer, label, secret, algorithm: 'SHA1', digits: 6, period: 30 })` construction appears three times: in `enrollTotp`, `verifyTotpEnrollment`, and `verifyMfaChallenge`.

**Why this is a problem:** If TOTP parameters need to change (e.g., upgrading from SHA1 to SHA256, changing the period), three locations must be updated. Missing one would cause verification failures for enrolled users.

**Solution:** Extract a `buildTotpInstance(secret: OTPAuth.Secret, label?: string): OTPAuth.TOTP` helper function within `mfa.service.ts` that encapsulates the shared configuration.

---

### REDUNDANT-4: Inconsistent service factory pattern in Auth module

**File:** `src/modules/auth/auth.service.ts` + `src/modules/auth/auth.routes.ts:136,155`

**Description:** The auth module defines a `createAuthService()` factory (used in routes for register/login/logout/changePassword), but the password-reset functions (`requestPasswordReset`, `resetPassword`) are imported and called directly as bare functions in `auth.routes.ts`, bypassing the factory pattern.

**Why this is a problem:** Inconsistent DI patterns make it harder to test and refactor. The password-reset service already has a `createPasswordResetService()` factory that's defined but never used in routes. New developers won't know which pattern to follow.

**Solution:** Use `createPasswordResetService()` in `auth.routes.ts` the same way `createAuthService()` is used. This makes all auth sub-services consistently use the factory pattern.

---

### REDUNDANT-5: `POST /api/users` bypasses the registration flow

**File:** `src/modules/user/user.routes.ts:11-23`

**Description:** The User module exposes a `POST /api/users` endpoint that creates users directly via `user.service.create()`. This inserts a user row without password hashing, email verification token generation, session creation, or auth events.

**Why this is a problem:** This endpoint overlaps with `POST /auth/register` but skips all security steps. It only requires `requireSession` (any logged-in user), not admin privileges. An authenticated non-admin user could create arbitrary user accounts in the system.

**Solution:** Either (a) remove `POST /api/users` entirely and use `/auth/register` as the only user creation path, or (b) gate it behind `requireAdmin` / `requirePermission('users', 'write')` for admin-provisioned accounts and add password hashing.

---

### REDUNDANT-6: `requireAdmin` and `requirePermission` perform overlapping DB queries

**Files:** `src/core/plugins/admin.ts`, `src/core/plugins/rbac.ts`

**Description:** Both `requireAdmin` (checks `users.isAdmin` column) and `requirePermission` (checks RBAC tables) independently call `requireSession` and then hit the database. If both are applied to the same route (or different routes in the same module), there's duplicated session validation and authorization work.

**Why this is a problem:** Extra DB round-trips on every request add latency. More importantly, two separate authorization models (`isAdmin` boolean vs RBAC permissions) can drift — a user could be `isAdmin: true` but lack RBAC roles, or vice versa, leading to inconsistent access.

**Solution:** Unify on the RBAC model. Replace `requireAdmin` with `requirePermission('admin', 'access')` or a super_admin role check. Deprecate the `users.isAdmin` column after backfilling RBAC roles.

---

## 3. Code Smells & Security Concerns

### SMELL-1: `COOKIE_SECRET` defaults to `'change-me-in-production'` (CRITICAL)

**File:** `src/core/env.ts:13`

**Description:** The `COOKIE_SECRET` environment variable has a Zod `.default('change-me-in-production')`, meaning the server will start successfully without setting it, even in production.

**Why this is a problem:** Signed cookies use this secret to verify integrity. A known default secret means any attacker can forge valid signed cookies, potentially hijacking sessions. This is the single highest-impact misconfiguration an IdP can ship with. The default value is also Google-searchable.

**Solution:** Remove the `.default()` for production. Add a startup check:
```ts
COOKIE_SECRET: z.string().refine(
  (v) => process.env.NODE_ENV !== 'production' || v !== 'change-me-in-production',
  'COOKIE_SECRET must be set to a secure value in production'
),
```

---

### SMELL-2: `TOTP_ENCRYPTION_KEY` is optional but silently breaks MFA

**File:** `src/core/env.ts:23`

**Description:** `TOTP_ENCRYPTION_KEY` is declared as `.optional()`, but every MFA operation (enroll, verify, disable) calls `requireTotpKey()` which throws a `ValidationError` if it's missing.

**Why this is a problem:** The failure only occurs at runtime when a user tries to enroll in MFA — not at startup. This creates a confusing user experience and a hidden operational issue. Operators may not realize MFA is broken until users report it.

**Solution:** Either (a) make `TOTP_ENCRYPTION_KEY` required (remove `.optional()`) and fail at startup, or (b) conditionally skip MFA route registration when the key is absent, returning 501 Not Implemented.

---

### SMELL-3: Recovery codes verified with Argon2 — expensive sequential hashing

**File:** `src/modules/mfa/mfa.service.ts:300-309`

**Description:** During MFA recovery code verification, all unused codes are loaded from the DB, and each is verified sequentially with `verifyPassword()` (Argon2id, memoryCost: 64MB, timeCost: 3).

**Why this is a problem:** Argon2 is intentionally slow (~200ms per verification with these parameters). With 8 recovery codes, worst-case verification takes ~1.6 seconds of CPU-intensive work. This blocks the Node.js thread pool and is disproportionate for short, high-entropy recovery codes that don't need brute-force resistance at the same level as passwords.

**Solution:** Switch recovery codes to HMAC-SHA256 keyed with a server-side secret (e.g., `TOTP_ENCRYPTION_KEY`). This provides integrity verification in microseconds while still preventing offline brute-force without the server key.

---

### SMELL-4: `rotationGracePlaintext` stores plaintext refresh token in DB

**File:** `src/modules/token/refresh-token.service.ts:148`

**Description:** During refresh token rotation, the new plaintext token is stored in the `rotationGracePlaintext` column of the old token's row. This allows returning the same new token during the grace period if the client retries.

**Why this is a problem:** Every other token in the system (session tokens, refresh tokens, auth codes) is stored as a SHA-256 hash. Storing one token in plaintext breaks the security invariant. If the database is compromised, this plaintext token can be used directly without cracking any hash.

**Solution:** Store the hash of the new token in `rotationGracePlaintext`. During grace-period retries, hash the incoming token and compare against the stored hash. Return the new plaintext only from the in-memory transaction result.

---

### SMELL-5: OAuth token endpoint CORS reflects any origin

**File:** `src/modules/oauth/oauth.routes.ts:84-95`

**Description:** The `setOAuthTokenEndpointCors` hook reads `request.headers.origin` and reflects it verbatim as `Access-Control-Allow-Origin`, along with `Allow-Credentials: true`.

**Why this is a problem:** This effectively allows any website to make credentialed cross-origin requests to the token endpoint. While OAuth 2.0 token endpoints may need CORS for SPA clients, reflecting any origin is overly permissive. An attacker's site could make authenticated requests to the token endpoint if the browser sends cookies. Per RFC 6749 and current best practices, token endpoints should restrict CORS to known client origins.

**Solution:** Look up the client's registered redirect URIs (the origins of registered SPAs) and only set `Access-Control-Allow-Origin` if the request origin matches a registered client origin. Otherwise, omit the CORS headers.

---

### SMELL-6: No `audience` validation on access token verification

**File:** `src/modules/token/jwt.service.ts:108-109`

**Description:** `verifyAccessToken()` calls `jose.jwtVerify()` with `{ issuer, algorithms: ['RS256'] }` but does not pass an `audience` parameter.

**Why this is a problem:** Access tokens are issued with an `aud` claim set to a specific client's `clientId`. Without audience validation, a token issued for Client A can be used at any endpoint that calls `verifyAccessToken` — including `/oauth/userinfo` — as if it were a token for Client B. This violates the principle of audience restriction (RFC 7519 Section 4.1.3) and enables token confusion attacks.

**Solution:** Add an `audience` parameter to `verifyAccessToken()` and pass it to `jose.jwtVerify()`. At the userinfo endpoint, the audience is not known upfront, so validate after verification that `payload.aud` matches a registered client.

---

### SMELL-7: Dual admin authorization models (`isAdmin` + RBAC)

**File:** `src/core/plugins/admin.ts:19-23`

**Description:** The `requireAdmin` plugin checks the `users.isAdmin` boolean column directly. The `requirePermission` plugin checks the RBAC tables (roles, permissions, user_roles). Both exist in parallel.

**Why this is a problem:** Two sources of truth for authorization is a recipe for privilege escalation bugs. An admin could be removed from the RBAC admin role but still have `isAdmin: true` (or vice versa). The `backfillAdminRoles()` function in RBAC suggests awareness of this gap, but it's a one-time migration, not an ongoing sync.

**Solution:** Migrate all `requireAdmin` usages to `requirePermission('admin', 'access')` or equivalent. Run `backfillAdminRoles()` as a migration, then deprecate and remove the `users.isAdmin` column.

---

### SMELL-8: No automated expired session cleanup

**File:** `src/modules/session/session.service.ts:121-128`

**Description:** `deleteExpiredSessions()` exists as a standalone function but is never called from any route, cron job, or lifecycle hook.

**Why this is a problem:** Expired sessions accumulate in the database indefinitely. Over time this degrades query performance on the `sessions` table, wastes storage, and makes admin session listings inaccurate. The same applies to expired `webauthnChallenges`, `mfaChallenges`, `loginAttempts`, and `parRequests`.

**Solution:** Add a startup hook or periodic interval (e.g., every 6 hours) that calls `deleteExpiredSessions()`, `deleteExpiredChallenges()`, `pruneOldAttempts()`, and cleans up expired PAR requests. Alternatively, integrate with a job scheduler.

---

### SMELL-9: Account session list includes expired sessions

**File:** `src/modules/account/account.service.ts:100-101`

**Description:** `listSessions()` queries all sessions for a user with `eq(sessions.userId, userId)` but does not filter out sessions where `expiresAt <= now`.

**Why this is a problem:** Users see stale/expired sessions in their account management UI, leading to confusion. They may try to revoke sessions that are already invalid, or believe their account is compromised because they see unfamiliar old sessions.

**Solution:** Add `gt(sessions.expiresAt, new Date())` to the where clause. Also apply the same filter in the admin `listSessions()`.

---

### SMELL-10: `ilike` pattern injection in admin user search

**File:** `src/modules/admin/admin.service.ts:29`

**Description:** The email search uses `ilike(users.email, \`%${query.email}%\`)` where `query.email` comes from the query string. While Drizzle ORM parameterizes the value, SQL `LIKE`/`ILIKE` patterns treat `%` and `_` as wildcards.

**Why this is a problem:** A user who searches for `%` or `_` gets unintended results because these characters are interpreted as LIKE wildcards within the parameterized value. For example, searching for `_@example.com` would match any single character before `@`. This isn't a SQL injection (the value is parameterized) but it's a logic bug that could leak information about other users' emails.

**Solution:** Escape `%` and `_` in the search input before wrapping:
```ts
const escaped = query.email.replace(/%/g, '\\%').replace(/_/g, '\\_');
conditions.push(ilike(users.email, `%${escaped}%`));
```

---

### SMELL-11: CORS hardcoded to single origin

**File:** `src/app.ts:37`

**Description:** The global CORS configuration sets `origin: env.WEBAUTHN_ORIGIN`, which is a single URL (e.g., `http://localhost:3100`). The admin dashboard runs on port 3002.

**Why this is a problem:** The admin dashboard cannot make cross-origin requests to the server because its origin (`http://localhost:3002`) is not in the allowed list. This either forces the admin to use a proxy or means CORS is being bypassed in development. In production with separate domains, this would completely break the admin app.

**Solution:** Accept a comma-separated list of origins in an env variable (e.g., `CORS_ORIGINS=http://localhost:3100,http://localhost:3002`) and pass an array or callback to `@fastify/cors`:
```ts
origin: env.CORS_ORIGINS.split(',').map(s => s.trim()),
```

---

## 4. Improvement Plan

### Phase 1 — Critical Security Fixes (P0)

| # | Issue | Action |
|---|---|---|
| 1 | BUG-1/2/3: Token leaks in responses | Remove `resetToken` and `verificationToken` from all API responses. Add email sending service (even a stub/log). |
| 2 | SMELL-1: Default cookie secret | Make `COOKIE_SECRET` required (no default) or add a production startup check. |
| 3 | SMELL-4: Plaintext refresh token in DB | Store `rotationGracePlaintext` as a hash; return the plaintext only in the HTTP response. |
| 4 | BUG-8: Attacker-controlled cookie name | Allowlist valid cookie names or use a server-side mapping. |
| 5 | SMELL-6: No audience validation on token verify | Pass expected `audience` to `jose.jwtVerify` at the userinfo and introspect endpoints. |

### Phase 2 — Logic Bugs (P1)

| # | Issue | Action |
|---|---|---|
| 6 | BUG-4: Event bus wrapper bug | Fix Emittery subscribe handler — the data is passed directly, not wrapped in `{name, data}`. Write a regression test. |
| 7 | BUG-5: Non-atomic password reset | Wrap password update + token consumption + session revocation in a single DB transaction. |
| 8 | BUG-6: Server-side sleep for login throttling | Replace `setTimeout` delay with HTTP 429 + `Retry-After` header. |
| 9 | BUG-9/10: Unbounded audit queries | Add streaming/pagination to `verifyAuditChain` and a row limit to `exportAuditLogs`. |
| 10 | SMELL-9: Expired sessions shown to users | Filter `sessions.expiresAt > now` in `account.service.listSessions()`. |

### Phase 3 — Redundancy & Consistency (P2)

| # | Issue | Action |
|---|---|---|
| 11 | REDUNDANT-1: Duplicated `isUniqueViolation` | Extract to `packages/core` or `core/db-utils.ts`. |
| 12 | REDUNDANT-2: Duplicated client mapping | Export from `client.service.ts` and import in `oauth.service.ts`. |
| 13 | REDUNDANT-3: Duplicated TOTP construction | Extract `createTotpInstance(secretHex, email?)` helper. |
| 14 | REDUNDANT-4: Inconsistent service factory usage | Use `createPasswordResetService` factory in routes (like other services). |
| 15 | REDUNDANT-5: `POST /api/users` bypasses registration flow | Remove or restrict to admin-only with proper authorization. |
| 16 | SMELL-7: Dual admin models | Migrate `requireAdmin` to use RBAC `requirePermission('admin', 'access')` and deprecate `users.isAdmin`. |

### Phase 4 — Operational Improvements (P3)

| # | Issue | Action |
|---|---|---|
| 17 | SMELL-3: Expensive recovery code verification | Switch recovery codes to HMAC-SHA256 with a server-side key. |
| 18 | SMELL-5: Open CORS on token endpoints | Restrict to registered client origins or remove `Access-Control-Allow-Credentials`. |
| 19 | SMELL-8: No session cleanup | Add a periodic cleanup job (cron or startup hook) for expired sessions, challenges, and login attempts. |
| 20 | SMELL-11: Single-origin CORS | Support multiple origins from an env variable (comma-separated). |
| 21 | SMELL-2: Optional TOTP key | Require `TOTP_ENCRYPTION_KEY` at startup if MFA feature is enabled, or gate MFA routes. |
| 22 | BUG-7: Dead catch block | Remove the redundant try-catch in `authorize()`. |
