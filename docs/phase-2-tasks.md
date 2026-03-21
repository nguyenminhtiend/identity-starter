# Phase 2: Authentication — Task Breakdown

## Layer 0: Infrastructure & Prerequisites

### Task 0.1 — Make REDIS_URL optional in env
- **File**: `core/env.ts`
- Change `REDIS_URL: z.url()` → `REDIS_URL: z.url().optional()` (not needed for Phase 2)
- Redis wiring deferred — no container changes needed

### Task 0.2 — Sessions DB schema
- **File**: `packages/db/src/schema/session.ts`
- Table: `sessions` with UUID v7 PK, `token` (unique, indexed), `user_id` FK, `expires_at`, `ip_address`, `user_agent`, `created_at`
- Export `sessionColumns` (all columns — no sensitive fields to exclude)
- Export from `packages/db/src/schema/index.ts` and `packages/db/src/index.ts`

### Task 0.3 — Passkeys DB schema
- **File**: `packages/db/src/schema/passkey.ts`
- Table: `passkeys` with UUID v7 PK, `user_id` FK, `credential_id` (unique, indexed), `public_key` (bytea), `counter` (integer), `device_type`, `backed_up` (boolean), `transports` (text[]), `name`, `created_at`
- Export `passkeyColumns`
- Export from barrel files

### Task 0.4 — Generate Drizzle migration
- Run `pnpm db:generate`
- Verify migration SQL is correct (FK constraints, indexes, column types)
- Run migration against local DB

### Task 0.5 — Install missing dependencies
- `pnpm --filter server add @simplewebauthn/server`
- Verify `@node-rs/argon2` is importable (already in deps)
- Do NOT install `jose` (deferred to Phase 3)

### Task 0.6 — Add new env variables
- **File**: `core/env.ts`
- Add `WEBAUTHN_RP_NAME` (relying party name, e.g., "Identity Starter")
- Add `WEBAUTHN_RP_ID` (relying party ID, e.g., "localhost")
- Add `WEBAUTHN_ORIGIN` (e.g., "http://localhost:3000")
- Add `SESSION_TTL_SECONDS` (default: 604800 = 7 days)

---

## Layer 1: Session Module

> No dependencies on other modules. Owns the `sessions` table (DB-only, TTL via `expires_at`).

### Task 1.1 — Session schemas (`session.schemas.ts`)
- `Session` interface (id, token, userId, expiresAt, ipAddress, userAgent, createdAt)
- `CreateSessionInput` schema (userId, ipAddress?, userAgent?)
- `sessionIdParamSchema` (id: z.uuid())

### Task 1.2 — Session events (`session.events.ts`)
- `SESSION_EVENTS`: `CREATED`, `REVOKED`
- Payload types: `SessionCreatedPayload`, `SessionRevokedPayload`

### Task 1.3 — Session service (`session.service.ts`)
- `createSession(db, eventBus, input)` → insert DB row with `expires_at = NOW() + SESSION_TTL_SECONDS`
- `validateSession(db, token)` → query DB `WHERE token = $1 AND expires_at > NOW()`, return session or null
- `revokeSession(db, eventBus, id)` → hard-delete from DB
- `revokeAllUserSessions(db, eventBus, userId)` → bulk delete all sessions for user
- `listUserSessions(db, userId)` → list active (non-expired) sessions for a user
- `deleteExpiredSessions(db)` → cleanup: `DELETE FROM sessions WHERE expires_at <= NOW()` (called periodically or lazily)
- Token generation: `crypto.randomBytes(32).toString('base64url')`

### Task 1.4 — Session validation middleware
- **File**: `session.middleware.ts` (or `core/plugins/auth.ts`)
- Fastify `onRequest` hook that:
  1. Extracts `Authorization: Bearer <token>` header
  2. Calls `validateSession()` to get session + userId
  3. Decorates `request.session` and `request.userId`
  4. Returns 401 if missing/invalid/expired
- Export as reusable Fastify plugin so other modules can `{ preHandler: requireSession }`
- Add Fastify type declaration for `request.session` and `request.userId`

### Task 1.5 — Session factory (`__tests__/session.factory.ts`)
- `makeCreateSessionInput(overrides?)`
- `makeSession(overrides?)`

### Task 1.6 — Session tests
- Schema tests: validation paths for all schemas
- Service unit tests: event constants, domain event structure
- Service integration tests: create/validate/revoke with real DB
- Test TTL behavior: validate returns null for expired sessions, cleanup deletes expired rows

---

## Layer 2: Auth Module

> Queries `users` and `sessions` tables directly via `@identity-starter/db`.
> Uses `@node-rs/argon2` for password hashing.

### Task 2.1 — Auth schemas (`auth.schemas.ts`)
- `registerSchema`: email (z.email()), password (z.string().min(8)), displayName
- `loginSchema`: email, password
- `changePasswordSchema`: currentPassword, newPassword
- Response types as needed

### Task 2.2 — Auth events (`auth.events.ts`)
- `AUTH_EVENTS`: `REGISTERED`, `LOGIN`, `LOGOUT`, `PASSWORD_CHANGED`, `FAILED_LOGIN`
- Payload types for each

### Task 2.3 — Auth service (`auth.service.ts`)
- `register(db, eventBus, input)`:
  1. Check email uniqueness (query users table)
  2. Hash password with Argon2
  3. Insert user into users table
  4. Create session (insert into sessions table with TTL)
  5. Return session token + user
- `login(db, eventBus, input, meta)`:
  1. Find user by email (query users table, include passwordHash)
  2. Verify password with Argon2
  3. Check user status (not suspended)
  4. Create session
  5. Emit login event
  6. Return session token + user
- `logout(db, eventBus, sessionId)`:
  1. Revoke session (delete from DB)
  2. Emit logout event
- `changePassword(db, eventBus, userId, input)`:
  1. Find user with password hash
  2. Verify current password
  3. Hash new password
  4. Update user record
  5. Emit password_changed event

### Task 2.4 — Auth routes (`auth.routes.ts`)
- `POST /api/auth/register` — public
- `POST /api/auth/login` — public
- `POST /api/auth/logout` — requires session middleware
- `POST /api/auth/change-password` — requires session middleware
- Session token returned in response body (not cookies — API-first)

### Task 2.5 — Auth factory (`__tests__/auth.factory.ts`)
- `makeRegisterInput(overrides?)`
- `makeLoginInput(overrides?)`
- `makeChangePasswordInput(overrides?)`

### Task 2.6 — Auth tests
- Schema tests: all validation paths
- Route unit tests: mocked service, test all status codes
- Service integration tests: full register → login → logout flow with real DB
- Route integration tests: HTTP lifecycle tests
- Test error cases: duplicate email, wrong password, suspended account, expired session

---

## Layer 3: Passkey Module

> Queries `passkeys` and `users` tables directly.
> Uses `@simplewebauthn/server` for WebAuthn operations.

### Task 3.1 — Passkey schemas (`passkey.schemas.ts`)
- `Passkey` interface
- `RegisterPasskeyOptionsInput` (empty or userId from session)
- `VerifyPasskeyRegistrationInput` (WebAuthn response object)
- `PasskeyLoginOptionsInput` (email or empty for discoverable credentials)
- `VerifyPasskeyLoginInput` (WebAuthn response object)
- `updatePasskeySchema` (name: z.string())
- `passkeyIdParamSchema`

### Task 3.2 — Passkey events (`passkey.events.ts`)
- `PASSKEY_EVENTS`: `REGISTERED`, `DELETED`
- Payload types

### Task 3.3 — Passkey service (`passkey.service.ts`)
- `generateRegistrationOptions(db, userId)` → uses `@simplewebauthn/server`
- `verifyRegistration(db, eventBus, userId, response, expectedChallenge)` → store credential
- `generateAuthenticationOptions(db)` → for passwordless login
- `verifyAuthentication(db, eventBus, response, expectedChallenge)` → verify + create session
- `listUserPasskeys(db, userId)` → list passkeys for a user
- `renamePasskey(db, id, name)` → update passkey name
- `deletePasskey(db, eventBus, id)` → remove passkey
- Challenge storage: DB table `webauthn_challenges` with short TTL (5 min via `expires_at`), cleaned up on verify or lazily

### Task 3.4 — Passkey routes (`passkey.routes.ts`)
- `POST /api/auth/passkeys/register/options` — requires session
- `POST /api/auth/passkeys/register/verify` — requires session
- `POST /api/auth/passkeys/login/options` — public
- `POST /api/auth/passkeys/login/verify` — public (returns session token)

### Task 3.5 — Passkey factory (`__tests__/passkey.factory.ts`)
- `makePasskey(overrides?)`
- WebAuthn mock helpers

### Task 3.6 — Passkey tests
- Schema tests
- Route unit tests (mocked service + WebAuthn)
- Service integration tests (real DB, mocked WebAuthn crypto)
- Route integration tests

---

## Layer 4: Account Module

> End-user self-service. Queries users, sessions, passkeys tables directly.
> All routes require session middleware.

### Task 4.1 — Account schemas (`account.schemas.ts`)
- `updateProfileSchema`: displayName (optional), metadata (optional)
- Reuse `sessionIdParamSchema` and `passkeyIdParamSchema` from Zod schemas
- `updatePasskeyNameSchema`: name

### Task 4.2 — Account service (`account.service.ts`)
- `getProfile(db, userId)` → query users table
- `updateProfile(db, eventBus, userId, input)` → update users table
- `listSessions(db, userId)` → query sessions table
- `revokeSession(db, eventBus, sessionId, userId)` → verify ownership + delete
- `listPasskeys(db, userId)` → query passkeys table
- `renamePasskey(db, id, userId, name)` → verify ownership + rename
- `deletePasskey(db, eventBus, id, userId)` → verify ownership + delete

### Task 4.3 — Account routes (`account.routes.ts`)
- `GET /api/account/profile` — get own profile
- `PATCH /api/account/profile` — update own profile
- `GET /api/account/sessions` — list own sessions
- `DELETE /api/account/sessions/:id` — revoke own session
- `GET /api/account/passkeys` — list own passkeys
- `PATCH /api/account/passkeys/:id` — rename own passkey
- `DELETE /api/account/passkeys/:id` — delete own passkey
- All routes require session middleware

### Task 4.4 — Account factory (`__tests__/account.factory.ts`)
- `makeUpdateProfileInput(overrides?)`

### Task 4.5 — Account tests
- Schema tests
- Route unit tests (mocked service)
- Service integration tests (real DB — create user/sessions/passkeys, then self-service)
- Route integration tests (HTTP lifecycle with authenticated requests)

---

## Layer 5: Wiring & Verification

### Task 5.1 — Register all modules in module-loader
- **File**: `core/module-loader.ts`
- Register `sessionRoutes` (if any external routes), `authRoutes`, `passkeyRoutes`, `accountRoutes`
- Correct prefixes per API spec

### Task 5.2 — End-to-end integration tests
- Full auth flow: register → login → access protected route → logout
- Passkey flow: login → register passkey → logout → passkey login
- Account self-service: update profile → list sessions → revoke session
- Session expiry behavior

### Task 5.3 — Verification
- `pnpm biome check .` — zero errors
- `pnpm turbo test` — all tests pass
- `pnpm turbo build` — builds cleanly
- Manual smoke test with curl/httpie

---

## Suggested Implementation Order

```
0.1  Make REDIS_URL optional
0.2  Sessions DB schema
0.3  Passkeys DB schema
0.4  Generate migration
0.5  Install dependencies
0.6  Add env variables
 ↓
1.1–1.6  Session module (DB-only with TTL — foundation for all auth)
 ↓
2.1–2.6  Auth module (register/login/logout — core flows)
 ↓
3.1–3.6  Passkey module (WebAuthn — can parallel with auth testing)
 ↓
4.1–4.5  Account module (self-service — depends on data from auth/session/passkey)
 ↓
5.1–5.3  Wiring & verification
```

**Estimated tasks**: 27 discrete tasks across 6 layers.
