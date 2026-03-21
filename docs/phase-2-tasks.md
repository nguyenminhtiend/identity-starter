# Phase 2: Auth Core — Task Breakdown

## Layer 0: Infrastructure & Prerequisites ✅

> All tasks completed.

### Task 0.1 — Make REDIS_URL optional in env ✅
- **File**: `core/env.ts`
- Changed `REDIS_URL: z.url()` → `REDIS_URL: z.url().optional()`

### Task 0.2 — Sessions DB schema ✅
- **File**: `packages/db/src/schema/session.ts`
- Table: `sessions` with UUID v7 PK, `token` (unique, indexed), `user_id` FK, `expires_at`, `last_active_at`, `ip_address`, `user_agent`, `created_at`
- Exported `sessionColumns`

### Task 0.3 — Passkeys DB schema ✅
- **File**: `packages/db/src/schema/passkey.ts`
- Table: `passkeys` with UUID v7 PK, `user_id` FK, `credential_id` (unique, indexed), `public_key` (bytea), `counter`, `device_type`, `backed_up`, `transports` (text[]), `name`, `created_at`
- Exported `passkeyColumns` (excludes `publicKey`)

### Task 0.4 — Generate Drizzle migration ✅
- Migration `0001_large_night_thrasher.sql` generated with sessions + passkeys tables

### Task 0.5 — Install missing dependencies ✅
- `@simplewebauthn/server` and `@node-rs/argon2` available in `apps/server`

### Task 0.6 — Add new env variables ✅
- `WEBAUTHN_RP_NAME`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `SESSION_TTL_SECONDS`

---

## Layer 1: Session Module

> No dependencies on other modules. Owns the `sessions` table (DB-only, TTL via `expires_at`).

### Task 1.1 — Session schemas (`session.schemas.ts`)
- `Session` interface (id, token, userId, expiresAt, lastActiveAt, ipAddress, userAgent, createdAt)
- `CreateSessionInput` schema (userId, ipAddress?, userAgent?)
- `sessionIdParamSchema` (id: z.uuid())

### Task 1.2 — Session events (`session.events.ts`)
- `SESSION_EVENTS`: `CREATED`, `REVOKED`
- Payload types: `SessionCreatedPayload`, `SessionRevokedPayload`

### Task 1.3 — Session service (`session.service.ts`)
- `createSession(db, eventBus, input)` → insert DB row with `expires_at = NOW() + SESSION_TTL_SECONDS`
- `validateSession(db, token)` → query DB `WHERE token = $1 AND expires_at > NOW()`, update `last_active_at`, return session or null
- `revokeSession(db, eventBus, id)` → hard-delete from DB
- `revokeAllUserSessions(db, eventBus, userId)` → bulk delete all sessions for user
- `deleteExpiredSessions(db)` → cleanup: `DELETE FROM sessions WHERE expires_at <= NOW()`
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
- Middleware unit tests: Bearer extraction, 401 responses

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

## Layer 3: Wiring & Verification

### Task 3.1 — Register auth module in module-loader
- **File**: `core/module-loader.ts`
- Register `authRoutes` with prefix `/api/auth`

### Task 3.2 — End-to-end integration tests
- Full auth flow: register → login → access protected route → logout
- Session expiry behavior
- Change password flow

### Task 3.3 — Verification
- `pnpm biome check .` — zero errors
- `pnpm turbo test` — all tests pass
- `pnpm turbo build` — builds cleanly
- Manual smoke test with curl/httpie

---

## Suggested Implementation Order

```
Layer 0 ✅ (done)
 ↓
1.1–1.6  Session module (DB-only with TTL — foundation for all auth)
 ↓
2.1–2.6  Auth module (register/login/logout — core flows)
 ↓
3.1–3.3  Wiring & verification
```

**Estimated tasks**: 16 discrete tasks across 4 layers (~12 remaining).
