# Identity Starter — Phase 2: Authentication

**Status: NOT STARTED**

## Overview

Build the authentication layer on top of Phase 1's User module. This phase adds password authentication, passkey/WebAuthn support, session management, and a login UI.

---

## Scope

### New Modules
- **Auth module** (`apps/server/src/modules/auth/`) — Password verification, session creation/validation, login/logout flows
- **Session module** (`apps/server/src/modules/session/`) — Session storage, validation middleware, revocation
- **Passkey module** (`apps/server/src/modules/passkey/`) — WebAuthn registration + authentication

### New App
- **Web UI** (`apps/web/`) — Next.js 15 with shadcn/ui + Tailwind CSS v4

### New DB Tables
- `sessions` — Session storage (id, token, userId, expiresAt, ipAddress, userAgent, createdAt)
- `passkeys` — WebAuthn credential storage (id, userId, credentialId, publicKey, counter, deviceType, backedUp, transports, name, createdAt)

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
- The auth module API surface is designed to accommodate it later (`POST /api/auth/reset-password/request`, `POST /api/auth/reset-password/confirm`)

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

## Module File Structure

### Auth Module
```
apps/server/src/modules/auth/
├── auth.schemas.ts         # Zod: registerInput, loginInput, changePasswordInput
├── auth.types.ts           # TypeScript types derived from schemas
├── auth.service.ts         # register(), login(), logout(), changePassword()
├── auth.routes.ts          # POST /register, /login, /logout, /change-password
├── auth.events.ts          # AuthEvents type
├── auth.errors.ts          # InvalidCredentialsError, AccountSuspendedError
├── index.ts                # Public API barrel
└── __tests__/
    ├── auth.service.test.ts
    └── auth.routes.test.ts
```

### Session Module
```
apps/server/src/modules/session/
├── session.schemas.ts      # Zod: sessionId param
├── session.types.ts        # Session type, SessionWithUser
├── session.repository.ts   # DB CRUD for sessions table
├── session.service.ts      # create(), validate(), revoke(), listByUser()
├── session.cache.ts        # Redis get/set/delete for session cache
├── session.middleware.ts   # Fastify onRequest hook for session validation
├── session.routes.ts       # GET /sessions, DELETE /sessions/:id
├── session.events.ts       # SessionEvents type
├── index.ts                # Public API barrel
└── __tests__/
    ├── session.service.test.ts
    └── session.middleware.test.ts
```

### Passkey Module
```
apps/server/src/modules/passkey/
├── passkey.schemas.ts      # Zod: registration/auth options and verification
├── passkey.types.ts        # Passkey type
├── passkey.repository.ts   # DB CRUD for passkeys table
├── passkey.service.ts      # registerOptions(), registerVerify(), authOptions(), authVerify()
├── passkey.routes.ts       # POST register/options, register/verify, auth/options, auth/verify; GET list; DELETE :id
├── passkey.events.ts       # PasskeyEvents type
├── index.ts                # Public API barrel
└── __tests__/
    ├── passkey.service.test.ts
    └── passkey.routes.test.ts
```

### DB Schema Additions
```
packages/db/src/schema/
├── user.ts                 # (existing)
├── session.ts              # sessions table
├── passkey.ts              # passkeys table
└── index.ts                # Updated barrel export
```

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

```typescript
type AuthEvents = {
  'auth.registered': { userId: string }
  'auth.login': { userId: string; method: 'password' | 'passkey'; sessionId: string }
  'auth.logout': { userId: string; sessionId: string }
  'auth.password_changed': { userId: string }
  'auth.failed_login': { email: string; reason: string }
}

type SessionEvents = {
  'session.created': { sessionId: string; userId: string }
  'session.revoked': { sessionId: string; userId: string }
}

type PasskeyEvents = {
  'passkey.registered': { userId: string; credentialId: string }
  'passkey.deleted': { userId: string; credentialId: string }
}
```

---

## DB Schema Design

### sessions
```typescript
{
  id: string              // nanoid
  token: string           // unique, indexed — opaque session token
  userId: string          // FK → users.id
  expiresAt: Date         // session expiry
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
}
```

### passkeys
```typescript
{
  id: string              // nanoid
  userId: string          // FK → users.id
  credentialId: string    // unique, indexed — WebAuthn credential ID (base64url)
  publicKey: Buffer       // COSE public key
  counter: number         // signature counter for clone detection
  deviceType: string      // 'singleDevice' | 'multiDevice'
  backedUp: boolean       // whether credential is backed up
  transports: string[]    // e.g., ['usb', 'ble', 'nfc', 'internal']
  name: string            // user-assigned name for the passkey
  createdAt: Date
}
```

---

## Cross-Module Dependencies

```
Auth module
  ├── depends on: User module (findByEmail, updatePassword)
  └── depends on: Session module (create, revoke)

Session module
  ├── depends on: packages/db (sessions table)
  └── depends on: packages/redis (session cache)

Passkey module
  ├── depends on: User module (findById)
  └── depends on: Session module (create — for passkey login)
```

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
