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
| `ip_address` | `varchar(45)` | NULLABLE | — |
| `user_agent` | `text` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

**Safe columns** (`sessionColumns`): all columns exposed.

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

### Planned Tables (Phase 3 — OAuth2/OIDC)

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
| `token_endpoint_auth_method` | `text` | `client_secret_basic`, `client_secret_post`, `none` |
| `is_confidential` | `boolean` | Public vs confidential |
| `status` | `enum` | `active`, `suspended` |
| `created_at` | `timestamp` | — |
| `updated_at` | `timestamp` | — |

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

### Planned Tables (Phase 4 — Admin & Governance)

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
  "passwordHash": "...",    // optional, nullable
  "metadata": { ... }       // optional
}
```

| Status | Condition | Response |
|--------|-----------|----------|
| `201` | Created | `{ id, email, emailVerified, displayName, status, metadata, createdAt, updatedAt }` |
| `400` | Invalid/missing email or displayName | `{ error, code: 'VALIDATION_ERROR', details }` |
| `409` | Duplicate email | `{ error, code: 'CONFLICT' }` |

**Note**: `passwordHash` is never included in responses.

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

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Register with email + password |
| `POST` | `/api/auth/login` | Login with email + password |
| `POST` | `/api/auth/logout` | Destroy session |
| `GET` | `/api/auth/me` | Get current user (requires session) |

---

### Planned: Passkey Module (Phase 2)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/passkeys/register/options` | Generate WebAuthn registration options |
| `POST` | `/api/passkeys/register/verify` | Verify & store passkey registration |
| `POST` | `/api/passkeys/login/options` | Generate WebAuthn authentication options |
| `POST` | `/api/passkeys/login/verify` | Verify passkey authentication |
| `GET` | `/api/passkeys` | List user's passkeys (requires session) |
| `DELETE` | `/api/passkeys/:id` | Remove a passkey (requires session) |

---

### Planned: Account Module (Phase 2)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/account/profile` | Get own profile |
| `PATCH` | `/api/account/profile` | Update display name |
| `POST` | `/api/account/change-password` | Change password |
| `DELETE` | `/api/account` | Deactivate/delete account |

---

### Planned: OAuth2/OIDC Module (Phase 3)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/oauth/authorize` | Authorization endpoint |
| `POST` | `/oauth/token` | Token endpoint |
| `POST` | `/oauth/revoke` | Token revocation |
| `GET` | `/oauth/userinfo` | OIDC UserInfo |
| `GET` | `/.well-known/openid-configuration` | OIDC Discovery |
| `GET` | `/.well-known/jwks.json` | JSON Web Key Set |

---

### Planned: Admin Module (Phase 4)

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

### Planned Events (Phase 2)

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

### Planned Events (Phase 3)

| Event | Emitted By |
|-------|------------|
| `oauth.code.issued` | OAuth service |
| `oauth.token.issued` | Token service |
| `oauth.token.revoked` | Token service |
| `oauth.consent.granted` | OAuth service |

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

## Phase Roadmap

| Phase | Status | Focus |
|-------|--------|-------|
| **Phase 1** | Done | Foundation — monorepo, DB, Redis, User module |
| **Phase 2** | In Progress (schemas created) | Authentication — password, passkey, sessions, account self-service |
| **Phase 3** | Not Started | OAuth2/OIDC — authorization server, client management, tokens |
| **Phase 4** | Not Started | Admin & Governance — RBAC, audit logs, admin dashboard |
