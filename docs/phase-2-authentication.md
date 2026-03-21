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
- **Account module** — End-user self-service (profile, sessions, passkeys)

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
- Redis-backed session cache for fast validation lookups
- Configurable session expiry (default: 7 days)

### Account Self-Service (`/api/account/*`)
- View and update own profile (displayName, metadata)
- List and revoke own active sessions
- List, rename, and delete own passkeys

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

### Auth Routes (`/api/auth/*`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | Public | Sign up (email + password + displayName) |
| POST | `/api/auth/login` | Public | Sign in → session token |
| POST | `/api/auth/logout` | Session | Sign out (revoke current session) |
| POST | `/api/auth/change-password` | Session | Change own password (requires current password) |
| POST | `/api/auth/passkeys/register/options` | Session | Get WebAuthn registration challenge |
| POST | `/api/auth/passkeys/register/verify` | Session | Complete passkey registration |
| POST | `/api/auth/passkeys/login/options` | Public | Get WebAuthn login challenge |
| POST | `/api/auth/passkeys/login/verify` | Public | Complete passkey login → session |

### Account Routes (`/api/account/*`) — End-User Self-Service
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/account/profile` | Session | Get own profile |
| PATCH | `/api/account/profile` | Session | Update own displayName/metadata |
| GET | `/api/account/sessions` | Session | List own active sessions |
| DELETE | `/api/account/sessions/:id` | Session | Revoke one of own sessions |
| GET | `/api/account/passkeys` | Session | List own passkeys |
| PATCH | `/api/account/passkeys/:id` | Session | Rename a passkey |
| DELETE | `/api/account/passkeys/:id` | Session | Delete a passkey |

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

- **Auth module** → User module (create, findByEmail, updatePassword), Session module (create, revoke)
- **Session module** → packages/db (sessions table), packages/redis (session cache)
- **Passkey module** → User module (findById), Session module (create — for passkey login)
- **Account module** → User module (findById, update), Session module (list, revoke), Passkey module (list, rename, delete)

---

## Testing Strategy

### Unit Tests
- **Auth service**: Mock user service + session service, test login/register/logout/changePassword flows
- **Session service**: Mock repository + Redis cache, test create/validate/revoke logic
- **Passkey service**: Mock repository + user service, test WebAuthn flows with @simplewebauthn/server test helpers
- **Account service**: Mock user/session/passkey services, test self-service profile/session/passkey management

### Route Tests
- Spin up Fastify with in-memory fakes for each module
- Test full request/response cycle including session middleware
- Test auth routes (register, login, logout, change-password, passkey flows)
- Test account routes (profile CRUD, session list/revoke, passkey management)
- Test error cases (invalid credentials, expired sessions, suspended accounts)

### Integration Tests
- Real PostgreSQL with transaction isolation
- Real Redis for session cache tests
- End-to-end auth flows (register → login → access protected route → logout)
- Account self-service flows (update profile → list sessions → revoke session)

---

## Prerequisites

- Phase 1 complete ✅
- Running PostgreSQL instance
- Running Redis instance
- Drizzle migrations generated and applied
