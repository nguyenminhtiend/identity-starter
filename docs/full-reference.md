# Identity Starter — Full Reference

> Learning + reference implementation of an identity provider (IdP).
> Modular monolith, pnpm + Turborepo monorepo, ESM-first.

---

## Table of Contents

- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Core Functions & Services](#core-functions--services)
- [Event System](#event-system)
- [Environment Variables](#environment-variables)
- [Phase Roadmap](#phase-roadmap)

---

## Database Schema

### `users`

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `email` | `varchar(255)` | UNIQUE, NOT NULL | — |
| `email_verified` | `boolean` | NOT NULL | `false` |
| `password_hash` | `text` | NULLABLE | `null` |
| `display_name` | `varchar(255)` | NOT NULL | — |
| `status` | `enum('active','suspended','pending_verification')` | NOT NULL | `'pending_verification'` |
| `metadata` | `jsonb` | NOT NULL | `{}` |
| `created_at` | `timestamp` | NOT NULL | `now()` |
| `updated_at` | `timestamp` | NOT NULL | `now()` |

**Safe columns** (`userColumns`): all columns except `password_hash`.

---

### `sessions`

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `token` | `text` | UNIQUE, INDEXED, NOT NULL | — |
| `user_id` | `uuid` | FK → `users.id` (CASCADE DELETE), NOT NULL | — |
| `expires_at` | `timestamp` | NOT NULL | — |
| `last_active_at` | `timestamp` | NOT NULL | `now()` |
| `ip_address` | `varchar(45)` | NULLABLE | — |
| `user_agent` | `text` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

**Safe columns** (`sessionColumns`): all columns exposed.
**Note**: `last_active_at` enables idle timeout detection (NIST 800-63B). Updated on each validated request.

---

### `passkeys`

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `user_id` | `uuid` | FK → `users.id` (CASCADE DELETE), NOT NULL | — |
| `credential_id` | `text` | UNIQUE, INDEXED, NOT NULL | — |
| `public_key` | `bytea` | NOT NULL | — |
| `counter` | `integer` | NOT NULL | `0` |
| `device_type` | `varchar(32)` | NOT NULL | — |
| `backed_up` | `boolean` | NOT NULL | `false` |
| `transports` | `text[]` | NULLABLE | — |
| `name` | `varchar(255)` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

**Safe columns** (`passkeyColumns`): all columns except `public_key`.
**Note**: `public_key` uses a custom `bytea` type that converts between `Uint8Array` (app) and `Buffer` (DB).

---

### `email_verification_tokens` (Phase 4)

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `user_id` | `uuid` | FK → `users.id` (CASCADE DELETE), NOT NULL | — |
| `token` | `text` | UNIQUE, INDEXED, NOT NULL | — |
| `expires_at` | `timestamp` | NOT NULL | — |
| `used_at` | `timestamp` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

**Note**: Short TTL (~24h). One-time use. On verification: set `users.email_verified = true`, `users.status = 'active'`.

---

### `webauthn_challenges` (Phase 3)

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `user_id` | `uuid` | FK → `users.id` (CASCADE DELETE), NULLABLE | — |
| `challenge` | `text` | UNIQUE, NOT NULL | — |
| `type` | `enum('registration','authentication')` | NOT NULL | — |
| `expires_at` | `timestamp` | NOT NULL | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

**Note**: Short TTL (~5 min). Consumed on verify, cleaned up lazily.

---

### `login_attempts` (Phase 4)

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `email` | `varchar(255)` | INDEXED, NOT NULL | — |
| `ip_address` | `varchar(45)` | INDEXED, NOT NULL | — |
| `success` | `boolean` | NOT NULL | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

**Note**: Used for rate limiting and account lockout. Query recent failures per email/IP to enforce progressive delays. Rows older than 24h can be pruned.

---

### `totp_secrets` (Phase 4)

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `user_id` | `uuid` | FK → `users.id` (CASCADE DELETE), UNIQUE, NOT NULL | — |
| `secret` | `text` | NOT NULL | — |
| `verified` | `boolean` | NOT NULL | `false` |
| `created_at` | `timestamp` | NOT NULL | `now()` |

**Note**: One TOTP secret per user. `secret` is encrypted at rest. `verified` flips to true after first successful verification.

---

### `recovery_codes` (Phase 4)

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `user_id` | `uuid` | FK → `users.id` (CASCADE DELETE), NOT NULL | — |
| `code_hash` | `text` | NOT NULL | — |
| `used_at` | `timestamp` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

**Note**: 8 codes generated at MFA enrollment. Each code is single-use. Hashed with Argon2. Regeneration invalidates all previous codes.

---

### `password_reset_tokens` (Phase 4)

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `user_id` | `uuid` | FK → `users.id` (CASCADE DELETE), NOT NULL | — |
| `token` | `text` | UNIQUE, INDEXED, NOT NULL | — |
| `expires_at` | `timestamp` | NOT NULL | — |
| `used_at` | `timestamp` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

**Note**: 1-hour TTL. Single-use. On reset: hash new password, revoke all sessions, mark token used.

---

### Planned Tables (Phase 5 — OAuth2/OIDC)

#### `oauth_clients`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `client_id` | `text` | UNIQUE |
| `client_secret_hash` | `text` | Hashed secret |
| `client_name` | `varchar(255)` | Display name |
| `redirect_uris` | `text[]` | Allowed redirects |
| `grant_types` | `text[]` | `authorization_code`, `client_credentials`, `refresh_token` |
| `response_types` | `text[]` | `code` |
| `scope` | `text` | Space-delimited scopes |
| `token_endpoint_auth_method` | `text` | `client_secret_basic`, `client_secret_post`, `private_key_jwt`, `none` |
| `jwks_uri` | `text` | NULLABLE — for `private_key_jwt` client auth |
| `jwks` | `jsonb` | NULLABLE — inline JWKS alternative to `jwks_uri` |
| `is_confidential` | `boolean` | Public vs confidential |
| `status` | `enum` | `active`, `suspended` |
| `created_at` | `timestamp` | — |
| `updated_at` | `timestamp` | — |
| `logo_uri` | `text` | NULLABLE — Client logo for consent screen |
| `tos_uri` | `text` | NULLABLE — Terms of service URL |
| `policy_uri` | `text` | NULLABLE — Privacy policy URL |
| `application_type` | `text` | `web` or `native` — affects redirect URI validation |

#### `authorization_codes`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `code` | `text` | UNIQUE, hashed |
| `client_id` | `uuid` | FK → `oauth_clients` |
| `user_id` | `uuid` | FK → `users` |
| `redirect_uri` | `text` | Must match registered |
| `scope` | `text` | Granted scopes |
| `code_challenge` | `text` | PKCE S256 |
| `code_challenge_method` | `text` | Always `S256` |
| `nonce` | `text` | OIDC nonce — returned in ID token |
| `state` | `text` | Client-provided state for additional validation |
| `expires_at` | `timestamp` | Short-lived (~10min) |
| `used_at` | `timestamp` | One-time use enforcement |

#### `refresh_tokens`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `token` | `text` | UNIQUE, hashed |
| `client_id` | `uuid` | FK → `oauth_clients` |
| `user_id` | `uuid` | FK → `users` |
| `scope` | `text` | — |
| `expires_at` | `timestamp` | — |
| `revoked_at` | `timestamp` | Nullable |
| `family_id` | `uuid` | Rotation detection |

#### `consent_grants`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | FK → `users` |
| `client_id` | `uuid` | FK → `oauth_clients` |
| `scope` | `text` | Granted scopes |
| `created_at` | `timestamp` | — |
| `revoked_at` | `timestamp` | Nullable |

---

### Planned Tables (Phase 6 — Admin & Governance)

#### `roles`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `name` | `varchar(100)` | UNIQUE (`super_admin`, `admin`, `user`) |
| `description` | `text` | — |
| `is_system` | `boolean` | Prevents deletion of built-in roles |
| `created_at` | `timestamp` | — |

#### `permissions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `resource` | `varchar(100)` | e.g., `users`, `clients` |
| `action` | `varchar(100)` | e.g., `read`, `write`, `delete` |
| UNIQUE | | `(resource, action)` |

#### `role_permissions`

| Column | Type | Notes |
|--------|------|-------|
| `role_id` | `uuid` | FK → `roles` |
| `permission_id` | `uuid` | FK → `permissions` |
| PK | | `(role_id, permission_id)` |

#### `user_roles`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `uuid` | FK → `users` |
| `role_id` | `uuid` | FK → `roles` |
| `assigned_at` | `timestamp` | — |
| `assigned_by` | `uuid` | FK → `users` |
| PK | | `(user_id, role_id)` |

#### `audit_logs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `actor_id` | `uuid` | FK → `users`, nullable (system actions) |
| `action` | `varchar(100)` | e.g., `user.created`, `session.revoked` |
| `resource_type` | `varchar(100)` | e.g., `user`, `session` |
| `resource_id` | `uuid` | Target entity |
| `details` | `jsonb` | Before/after snapshots |
| `ip_address` | `varchar(45)` | — |
| `created_at` | `timestamp` | Append-only, no UPDATE/DELETE |

---

## API Endpoints

### Health Check

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/health` | Health check | `{ status: 'ok' }` |

---

### User Module — `POST /api/users`

**Create a new user.**

Request body (validated via `createUserSchema`):

```json
{
  "email": "user@example.com",
  "displayName": "Jane Doe",
  "password": "...",         // optional — hashed server-side with Argon2
  "metadata": { ... }        // optional
}
```

| Status | Condition | Response |
|--------|-----------|----------|
| `201` | Created | `{ id, email, emailVerified, displayName, status, metadata, createdAt, updatedAt }` |
| `400` | Invalid/missing email or displayName | `{ error, code: 'VALIDATION_ERROR', details }` |
| `409` | Duplicate email | `{ error, code: 'CONFLICT' }` |

**Note**: `password` is hashed server-side before storage. `passwordHash` is never included in responses.

---

### User Module — `GET /api/users/:id`

**Retrieve a user by ID.**

Path params (validated via `userIdParamSchema`):
- `id` — UUID

| Status | Condition | Response |
|--------|-----------|----------|
| `200` | Found | `{ id, email, emailVerified, displayName, status, metadata, createdAt, updatedAt }` |
| `400` | Invalid UUID | `{ error, code: 'VALIDATION_ERROR' }` |
| `404` | Not found | `{ error, code: 'NOT_FOUND' }` |

---

### Planned: Auth Module (Phase 2)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/register` | Public | Register with email + password (rate limited) |
| `POST` | `/api/auth/login` | Public | Login with email + password (rate limited, lockout) |
| `POST` | `/api/auth/logout` | Session | Destroy session |
| `POST` | `/api/auth/change-password` | Session | Change password (verify current first) |
| `POST` | `/api/auth/verify-email` | Public | Verify email with token |
| `POST` | `/api/auth/resend-verification` | Public | Resend verification email (rate limited) |

**Password policy** (NIST 800-63B): min 8 chars, no complexity rules, check against breached password lists.
**Rate limiting**: per-IP on public endpoints. Progressive delay after 5 failed logins per account.

---

### Planned: Passkey Module (Phase 3)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/passkeys/register/options` | Session | Generate WebAuthn registration options |
| `POST` | `/api/auth/passkeys/register/verify` | Session | Verify & store passkey registration |
| `POST` | `/api/auth/passkeys/login/options` | Public | Generate WebAuthn authentication options |
| `POST` | `/api/auth/passkeys/login/verify` | Public | Verify passkey authentication, return session |

---

### Planned: Account Module (Phase 4)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/account/profile` | Session | Get own profile |
| `PATCH` | `/api/account/profile` | Session | Update display name / metadata |
| `GET` | `/api/account/sessions` | Session | List own active sessions |
| `DELETE` | `/api/account/sessions/:id` | Session | Revoke own session |
| `GET` | `/api/account/passkeys` | Session | List own passkeys |
| `PATCH` | `/api/account/passkeys/:id` | Session | Rename own passkey |
| `DELETE` | `/api/account/passkeys/:id` | Session | Delete own passkey |

---

### Planned: OAuth2/OIDC Module (Phase 5)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/oauth/authorize` | Authorization endpoint |
| `POST` | `/oauth/authorize` | PAR (Pushed Authorization Request) |
| `POST` | `/oauth/token` | Token endpoint (supports DPoP proof) |
| `POST` | `/oauth/revoke` | Token revocation |
| `GET` | `/oauth/userinfo` | OIDC UserInfo (standard claims: `sub`, `email`, `email_verified`, `name`) |
| `GET` | `/.well-known/openid-configuration` | OIDC Discovery |
| `GET` | `/.well-known/jwks.json` | JSON Web Key Set |
| `POST` | `/oauth/introspect` | Token introspection (RFC 7662) |
| `POST` | `/oauth/par` | Pushed Authorization Request (RFC 9126) |
| `GET` | `/oauth/end-session` | RP-Initiated Logout (OIDC) |

**OAuth 2.1 alignment**: PKCE required for all clients (no implicit/ROPC grants), refresh token rotation, DPoP support.
**Key rotation**: Signing keys rotated via JWKS. Previous key retained for grace period to validate in-flight tokens.

---

### Planned: Admin Module (Phase 6)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | List users (paginated) |
| `GET` | `/api/admin/users/:id` | Get user detail |
| `PATCH` | `/api/admin/users/:id/status` | Suspend / activate user |
| `POST` | `/api/admin/roles` | Create role |
| `GET` | `/api/admin/roles` | List roles |
| `PUT` | `/api/admin/roles/:id/permissions` | Set role permissions |
| `POST` | `/api/admin/users/:id/roles` | Assign role to user |
| `DELETE` | `/api/admin/users/:id/roles/:roleId` | Remove role from user |
| `GET` | `/api/admin/sessions` | List active sessions |
| `DELETE` | `/api/admin/sessions/:id` | Revoke session |
| `GET` | `/api/admin/audit-logs` | Query audit logs (filtered, paginated) |

---

## Core Functions & Services

### DB Package (`packages/db`)

| Export | Signature | Description |
|--------|-----------|-------------|
| `createDb` | `(url: string) => Database` | Creates Drizzle ORM instance connected to PostgreSQL |

### Core Package (`packages/core`)

| Export | Description |
|--------|-------------|
| `ok(value)` | Wraps value in success Result |
| `err(error)` | Wraps error in failure Result |
| `unwrap(result)` | Extracts value or throws |
| `DomainError` | Base error class |
| `NotFoundError` | → HTTP 404 |
| `ConflictError` | → HTTP 409 |
| `ValidationError` | → HTTP 400 |
| `Brand<T, B>` | Nominal type branding |

### Redis Package (`packages/redis`)

| Export | Signature | Description |
|--------|-----------|-------------|
| `createRedisClient` | `(config) => Redis` | Creates ioredis client |
| `healthCheck` | `(client) => Promise<boolean>` | Pings Redis |

### Server Core (`apps/server/src/core`)

| Export | Signature | Description |
|--------|-----------|-------------|
| `createContainer` | `() => Container` | Creates singleton DI container with `{ db }` |
| `getContainer` | `() => Container` | Retrieves existing container or throws |
| `registerModules` | `(app) => void` | Registers all module route plugins |
| `errorHandlerPlugin` | Fastify plugin | Maps errors to HTTP responses |
| `validate` | `({ body?, params?, querystring? }) => preHandler` | Zod schema validation |
| `loggerConfig` | Pino config object | Logger config (pino-pretty in dev) |

### User Service (`apps/server/src/modules/user`)

| Function | Signature | Description |
|----------|-----------|-------------|
| `createUser` | `(db, eventBus, input: CreateUserInput) => Promise<User>` | Create user, check email uniqueness, emit `user.created` |
| `findUserById` | `(db, id: string) => Promise<User>` | Find by ID or throw `NotFoundError` |
| `findUserByEmail` | `(db, email: string) => Promise<User>` | Find by email or throw `NotFoundError` |
| `findUserByEmailWithPassword` | `(db, email: string) => Promise<UserWithPassword>` | Find by email with `passwordHash` or throw `NotFoundError` |

### Planned: Session Service (`apps/server/src/modules/session`)

| Function | Signature | Description |
|----------|-----------|-------------|
| `createSession` | `(db, eventBus, input) => Promise<Session>` | Insert session with TTL, emit `session.created` |
| `validateSession` | `(db, token) => Promise<Session \| null>` | Query by token where not expired, update `last_active_at` |
| `revokeSession` | `(db, eventBus, id) => Promise<void>` | Hard-delete session, emit `session.revoked` |
| `revokeAllUserSessions` | `(db, eventBus, userId) => Promise<void>` | Bulk delete all user sessions |
| `deleteExpiredSessions` | `(db) => Promise<void>` | Cleanup: delete expired rows |

### Planned: Auth Service (`apps/server/src/modules/auth`)

| Function | Signature | Description |
|----------|-----------|-------------|
| `register` | `(db, eventBus, input) => Promise<{ user, token }>` | Create user + session, hash password with Argon2 |
| `login` | `(db, eventBus, input, meta) => Promise<{ user, token }>` | Verify password, check status, create session |
| `logout` | `(db, eventBus, sessionId) => Promise<void>` | Revoke session |
| `changePassword` | `(db, eventBus, userId, input) => Promise<void>` | Verify current, hash new, update |

### Infrastructure (`apps/server/src/infra`)

| Export | Description |
|--------|-------------|
| `createDomainEvent<T>(eventName, payload)` | Factory for domain events (UUID v7 id, timestamp) |
| `InMemoryEventBus` | mitt-based typed event emitter implementing `EventBus` |

### Test Helpers (`apps/server/src/test`)

| Export | Description |
|--------|-------------|
| `buildTestApp(options)` | Creates Fastify app for testing (no logger) |
| `createTestDb()` | Creates isolated PostgreSQL DB from template for each test |

---

## Event System

Events follow the `DomainEvent<T>` interface:

```ts
interface DomainEvent<T = unknown> {
  id: string;           // UUID v7
  eventName: string;
  occurredOn: Date;
  payload: T;
}
```

### Current Events

| Event | Constant | Payload | Emitted By |
|-------|----------|---------|------------|
| `user.created` | `USER_EVENTS.CREATED` | `{ user: User }` | `createUser()` |

### Planned Events (Phase 2-3)

| Event | Emitted By |
|-------|------------|
| `session.created` | Session service |
| `session.revoked` | Session service |
| `auth.login.success` | Auth service |
| `auth.login.failed` | Auth service |
| `passkey.registered` | Passkey service |
| `passkey.removed` | Passkey service |
| `account.password.changed` | Account service |
| `account.deactivated` | Account service |

### Planned Events (Phase 5)

| Event | Emitted By |
|-------|------------|
| `oauth.code.issued` | OAuth service |
| `oauth.token.issued` | Token service |
| `oauth.token.revoked` | Token service |
| `oauth.consent.granted` | OAuth service |

### Planned Events (Phase 4)

| Event | Emitted By |
|-------|------------|
| `mfa.totp.enrolled` | MFA service |
| `mfa.totp.verified` | MFA service |
| `mfa.recovery_codes.generated` | MFA service |
| `mfa.recovery_code.used` | MFA service |
| `account.password_reset.requested` | Account service |
| `account.password_reset.completed` | Account service |

---

## Environment Variables

Validated via Zod in `apps/server/src/core/env.ts`:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NODE_ENV` | `development \| production \| test` | — | Environment |
| `PORT` | `number` | `3000` | Server port |
| `HOST` | `string` | `0.0.0.0` | Server host |
| `DATABASE_URL` | `string` | — | PostgreSQL connection URL (required) |
| `REDIS_URL` | `string` | — | Redis connection URL (optional) |
| `LOG_LEVEL` | `string` | `info` | Pino log level |
| `WEBAUTHN_RP_NAME` | `string` | `Identity Starter` | WebAuthn relying party name |
| `WEBAUTHN_RP_ID` | `string` | `localhost` | WebAuthn relying party ID |
| `WEBAUTHN_ORIGIN` | `string` | `http://localhost:3000` | WebAuthn expected origin |
| `SESSION_TTL_SECONDS` | `number` | `604800` (7 days) | Session time-to-live |

---

## Security Measures

### Phase 2 — Authentication Security

| Concern | Approach |
|---------|----------|
| **Password hashing** | Argon2id via `@node-rs/argon2` (OWASP recommended) |
| **Password policy** | NIST 800-63B: min 8 chars, no complexity rules, breached password check |
| **Rate limiting** | Per-IP on login/register. Fastify `@fastify/rate-limit` or custom middleware |
| **Account lockout** | Progressive delay after 5 failed logins per email (via `login_attempts` table). No hard lockout (prevents DoS) |
| **Session tokens** | `crypto.randomBytes(32).toString('base64url')` — 256-bit entropy |
| **Session expiry** | Absolute timeout (7 days default) + idle timeout via `last_active_at` |
| **CSRF** | API-first with `Authorization: Bearer` header — SameSite cookies not used, so CSRF is mitigated by design |
| **Email verification** | Required before `status` transitions to `active`. Token-based with 24h TTL |
| **Timing attacks** | Constant-time comparison for tokens and password verification |

### Phase 5 — OAuth2/OIDC Security

| Concern | Approach |
|---------|----------|
| **PKCE** | Required for all clients (S256 only) — OAuth 2.1 mandate |
| **DPoP** | RFC 9449 — Phase 5 feature: sender-constrained access tokens (proof-of-possession at token endpoint) |
| **PAR** | RFC 9126 — Phase 5 feature: pushed authorization requests via `POST /oauth/par` to prevent authorization request tampering |
| **Token storage** | Refresh tokens hashed in DB. Access tokens are short-lived JWTs (5–15 min) |
| **Refresh rotation** | Single-use with `family_id` for replay detection |
| **Key rotation** | JWK rotation with grace period for in-flight token validation |

### Phase 4 — Account Security & MFA

| Concern | Approach |
|---------|----------|
| **MFA (TOTP)** | RFC 6238 TOTP via `otpauth` library. Required for AAL2 assurance level |
| **Recovery codes** | 8 single-use codes generated at MFA enrollment. Stored hashed (Argon2) |
| **Step-up authentication** | Sensitive operations (password change, passkey management, consent) require re-authentication |
| **Breached password check** | Required per NIST 800-63B — check against HaveIBeenPwned k-anonymity API on registration and password change |
| **Password reset** | Token-based reset flow with 1-hour TTL. Requires email delivery integration |
| **Account recovery** | Recovery codes as last-resort factor. Admin-initiated recovery for enterprise deployments |
| **`acr` / `amr` claims** | OIDC claims indicating authentication strength (AAL1/AAL2) and methods used (`pwd`, `hwk`, `otp`) |

---

## Phase Roadmap

| Phase | Status | Focus |
|-------|--------|-------|
| **Phase 1** | Done | Foundation — monorepo, DB, Redis, User module |
| **Phase 2** | In Progress (Layer 0 done) | Auth Core — sessions, password auth (register/login/logout/change-password), Bearer middleware |
| **Phase 3** | Not Started | Passkeys — WebAuthn registration + authentication, challenge storage |
| **Phase 4** | Not Started | Account & Security — self-service (profile/sessions/passkeys), email verification, MFA (TOTP + recovery codes), rate limiting, password reset |
| **Phase 5** | Not Started | OAuth2/OIDC — authorization server, PKCE, DPoP, PAR, client management, tokens, JWKS, consent, RP-Initiated Logout |
| **Phase 6** | Not Started | Admin & Governance — RBAC, audit logs, admin user/session/role management |
| **Phase 7** | Not Started | Frontend — Next.js 15 + shadcn/ui (login, account, consent, admin dashboard) |
