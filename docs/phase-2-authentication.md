# Identity Starter — Phase 2: Authentication

**Status: NOT STARTED**

## Overview

Build the authentication layer on top of Phase 1's User module. This phase adds password authentication, passkey/WebAuthn support, session management, and a login UI.

---

## Scope

### New Modules
- **Auth module** (`apps/server/src/modules/auth/`) — Password verification, session creation, login/logout flows
- **Passkey module** (`apps/server/src/modules/passkey/`) — WebAuthn registration + authentication

### New Packages
- **UI app** (`apps/web/`) — Next.js 15 with shadcn/ui + Tailwind CSS v4

### New DB Tables
- `sessions` — Session storage (token, userId, expiresAt, metadata)
- `passkeys` — WebAuthn credential storage (credentialId, publicKey, userId, counter)

### Key Libraries
- `@node-rs/argon2` — Password hashing
- `jose` — JWT/JWKS for session tokens
- `@simplewebauthn/server` — WebAuthn server-side operations

---

## Features

### Password Authentication
- Registration with password (hash via Argon2)
- Login with email + password
- Password change (authenticated)
- Password reset flow (token-based)

### Passkey/WebAuthn
- Passkey registration (authenticated user adds passkey)
- Passkey authentication (passwordless login)
- Multiple passkeys per user
- Passkey management (list, delete)

### Session Management
- Session creation on successful auth
- Session validation middleware
- Session revocation (logout)
- Redis-backed session cache for fast lookups
- Configurable session expiry

### Login UI (Next.js)
- Login page (email + password)
- Registration page
- Passkey prompt/challenge
- Basic layout with shadcn/ui components

---

## API Routes (Planned)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register with email + password |
| POST | `/api/auth/login` | Login with email + password |
| POST | `/api/auth/logout` | Logout (revoke session) |
| POST | `/api/auth/change-password` | Change password (authenticated) |
| POST | `/api/passkeys/register/options` | Get WebAuthn registration options |
| POST | `/api/passkeys/register/verify` | Verify WebAuthn registration |
| POST | `/api/passkeys/authenticate/options` | Get WebAuthn auth options |
| POST | `/api/passkeys/authenticate/verify` | Verify WebAuthn authentication |
| GET | `/api/passkeys` | List user's passkeys |
| DELETE | `/api/passkeys/:id` | Delete a passkey |

---

## Events (Planned)

```typescript
type AuthEvents = {
  'auth.login': { userId: string; method: 'password' | 'passkey' }
  'auth.logout': { userId: string; sessionId: string }
  'auth.password_changed': { userId: string }
  'auth.failed_login': { email: string; reason: string }
}

type PasskeyEvents = {
  'passkey.registered': { userId: string; credentialId: string }
  'passkey.deleted': { userId: string; credentialId: string }
}
```

---

## Prerequisites

- Phase 1 complete ✅
- Running PostgreSQL instance
- Running Redis instance
- Drizzle migrations generated and applied
