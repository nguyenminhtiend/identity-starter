# Identity Starter — Phase 2: Authentication

**Status: NOT STARTED**

## Overview

Build the authentication layer on top of Phase 1's User module. This phase adds password authentication, passkey/WebAuthn support, session management, and a login UI.

---

## Scope

### New Modules
- **Auth module** — Password verification, session creation/validation, login/logout flows
- **Session module** — Session storage, validation middleware, revocation
- **Passkey module** — WebAuthn registration + authentication

### New App
- **Web UI** (`apps/web/`) — Next.js 15 with shadcn/ui + Tailwind CSS v4

### New DB Tables
- `sessions` — Session storage
- `passkeys` — WebAuthn credential storage

### Key Libraries
- `@node-rs/argon2` — Password hashing (already a dependency)
- `jose` — JWT/JWKS for session tokens (already a dependency)
- `@simplewebauthn/server` — WebAuthn server-side operations (already a dependency)

---

## Architecture Decisions

### Session Strategy: DB + Redis Cache
- Sessions are persisted in PostgreSQL (`sessions` table) — source of truth
- Active sessions are cached in Redis for fast validation (key: `session:{token}`)
- On login: write to DB, cache in Redis with TTL matching session expiry
- On validation: check Redis first, fall back to DB, re-cache on miss
- On logout: delete from both Redis and DB
- Configurable session TTL (default: 7 days)

### Auth Module Responsibility Split
- **Auth module** owns the authentication *flows* (login, register, logout, password change)
- **Session module** owns session *lifecycle* (create, validate, revoke, cleanup)
- Auth module depends on User module (via service interface) and Session module
- This split keeps session validation middleware reusable by other phases (OAuth, Admin)

### Password Reset — Deferred
- Password reset requires an email delivery service (SMTP or transactional email provider)
- Deferred to a later phase or added as an enhancement after Phase 2 core is complete
- The auth module API surface is designed to accommodate it later

---

## Features

### Password Authentication
- Registration with email + password (hash via Argon2)
- Login with email + password (verify hash, create session)
- Password change (authenticated, requires current password)

### Passkey/WebAuthn
- Passkey registration (authenticated user adds passkey)
- Passkey authentication (passwordless login)
- Multiple passkeys per user
- Passkey management (list, rename, delete)

### Session Management
- Session creation on successful auth (password or passkey)
- Session validation middleware (Fastify `onRequest` hook)
- Session revocation (single session logout)
- List active sessions for a user
- Redis-backed session cache for fast validation lookups
- Configurable session expiry (default: 7 days)

### Login UI (Next.js)
- Login page (email + password)
- Registration page
- Passkey prompt/challenge
- Session-protected dashboard page (proof that auth works)
- Basic layout with shadcn/ui components

---

## DB Schema

### sessions
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | nanoid |
| token | text | unique, indexed — opaque session token |
| userId | text FK | → users.id |
| expiresAt | timestamp | session expiry |
| ipAddress | text | nullable |
| userAgent | text | nullable |
| createdAt | timestamp | |

### passkeys
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | nanoid |
| userId | text FK | → users.id |
| credentialId | text | unique, indexed — WebAuthn credential ID (base64url) |
| publicKey | bytea | COSE public key |
| counter | integer | signature counter for clone detection |
| deviceType | text | 'singleDevice' / 'multiDevice' |
| backedUp | boolean | whether credential is backed up |
| transports | text[] | e.g., ['usb', 'ble', 'nfc', 'internal'] |
| name | text | user-assigned name for the passkey |
| createdAt | timestamp | |

---

## API Routes

### Auth Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | Public | Register with email + password |
| POST | `/api/auth/login` | Public | Login with email + password |
| POST | `/api/auth/logout` | Authenticated | Logout (revoke current session) |
| POST | `/api/auth/change-password` | Authenticated | Change password |

### Session Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/sessions` | Authenticated | List current user's active sessions |
| DELETE | `/api/sessions/:id` | Authenticated | Revoke a specific session |

### Passkey Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/passkeys/register/options` | Authenticated | Get WebAuthn registration options |
| POST | `/api/passkeys/register/verify` | Authenticated | Verify WebAuthn registration |
| POST | `/api/passkeys/authenticate/options` | Public | Get WebAuthn auth options |
| POST | `/api/passkeys/authenticate/verify` | Public | Verify WebAuthn authentication |
| GET | `/api/passkeys` | Authenticated | List user's passkeys |
| DELETE | `/api/passkeys/:id` | Authenticated | Delete a passkey |

---

## Events

### Auth Events
- `auth.registered`, `auth.login`, `auth.logout`
- `auth.password_changed`, `auth.failed_login`

### Session Events
- `session.created`, `session.revoked`

### Passkey Events
- `passkey.registered`, `passkey.deleted`

---

## Cross-Module Dependencies

- **Auth module** → User module (findByEmail, updatePassword), Session module (create, revoke)
- **Session module** → packages/db (sessions table), packages/redis (session cache)
- **Passkey module** → User module (findById), Session module (create — for passkey login)

---

## Testing Strategy

### Unit Tests
- **Auth service**: Mock user service + session service, test login/register/logout/changePassword flows
- **Session service**: Mock repository + Redis cache, test create/validate/revoke logic
- **Passkey service**: Mock repository + user service, test WebAuthn flows with @simplewebauthn/server test helpers

### Route Tests
- Spin up Fastify with in-memory fakes for each module
- Test full request/response cycle including auth middleware
- Test error cases (invalid credentials, expired sessions, suspended accounts)

### Integration Tests
- Real PostgreSQL with transaction isolation
- Real Redis for session cache tests
- End-to-end auth flows (register → login → access protected route → logout)

---

## Prerequisites

- Phase 1 complete ✅
- Running PostgreSQL instance
- Running Redis instance
- Drizzle migrations generated and applied
