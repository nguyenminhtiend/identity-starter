# Identity Starter — Phase 3: Passkeys / WebAuthn

**Status: NOT STARTED**

## Overview

Add passwordless authentication via WebAuthn/passkeys. Authenticated users can register passkeys, and anyone can use a passkey to log in without a password. Builds on Phase 2's session infrastructure.

---

## Scope

### New Modules
- **Passkey module** — WebAuthn registration + authentication ceremonies

### New DB Tables
- `webauthn_challenges` — Short-lived challenge storage for WebAuthn ceremonies

### Existing DB Tables (created in Phase 2 Layer 0)
- `passkeys` — WebAuthn credential storage (schema + migration already done)

### Key Libraries
- `@simplewebauthn/server` v13 — WebAuthn server-side operations (already installed)

### Explicitly Deferred
- Passkey management (list, rename, delete) → Phase 4 (Account self-service)
- Frontend passkey UI → Phase 7

---

## Architecture Decisions

### Challenge Storage: DB with Short TTL
- Challenges stored in `webauthn_challenges` table with 5-minute TTL
- Consumed on verification, cleaned up lazily
- No Redis needed — challenge volume is low and short-lived

### Passkey Login Creates a Session
- Successful passkey authentication creates a session (same as password login)
- Reuses Phase 2's session module — no new auth token format

### Discoverable Credentials
- Authentication options support empty `allowCredentials` for discoverable credential flow
- Users can log in by just tapping their passkey without entering email first
- Frontend uses conditional UI (`mediation: 'conditional'`) for passkey autofill in login form — the standard 2025+ UX pattern

### Attestation Policy
- Attestation preference: `none` — we don't verify device attestation
- Rationale: attestation adds complexity without benefit for consumer IdPs. Enterprise deployments can override via config
- AAGUID is stored for informational purposes (admin can see which authenticator was used)

### Authenticator Selection Preferences
- `residentKey: 'preferred'` — prefer discoverable credentials but allow non-discoverable
- `userVerification: 'required'` — biometric/PIN always required (AAL2 assurance)
- `authenticatorAttachment`: not restricted — allow both platform and cross-platform authenticators

---

## Features

### Passkey Registration (authenticated)
- Generate registration options (challenge, RP info, user info, exclude existing credentials)
- Verify registration response (validate attestation, store credential)
- Multiple passkeys per user
- AAGUID stored for device identification (shown in admin/account UI)

### Passkey Authentication (public)
- Generate authentication options (challenge, optional allowCredentials)
- Verify authentication response (validate assertion, update counter, create session)
- Returns session token (same format as password login)

---

## DB Schema

### passkeys (created in Phase 2 Layer 0)

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
| `aaguid` | `varchar(36)` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

### webauthn_challenges (new)

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `user_id` | `uuid` | FK → `users.id` (CASCADE DELETE), NULLABLE | — |
| `challenge` | `text` | UNIQUE, NOT NULL | — |
| `type` | `enum('registration','authentication')` | NOT NULL | — |
| `expires_at` | `timestamp` | NOT NULL | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

`user_id` is nullable because authentication challenges (discoverable credentials) don't require a user upfront.

---

## API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/passkeys/register/options` | Session | Generate WebAuthn registration challenge |
| POST | `/api/auth/passkeys/register/verify` | Session | Complete passkey registration |
| POST | `/api/auth/passkeys/login/options` | Public | Generate WebAuthn authentication challenge |
| POST | `/api/auth/passkeys/login/verify` | Public | Complete passkey login → session token |

---

## Events

- `passkey.registered` — payload: `{ passkeyId, userId }`
- `passkey.deleted` — payload: `{ passkeyId, userId }`

---

## Cross-Module Dependencies

- **Passkey module** → `@identity-starter/db` (passkeys + webauthn_challenges + users tables), Session module (create session on passkey login)

---

## Testing Strategy

### Unit Tests
- **Passkey service**: registration/authentication flows with mocked `@simplewebauthn/server`
- **Schemas**: Zod validation for WebAuthn inputs
- **Routes**: mocked service, test all status codes

### Integration Tests
- Full passkey registration ceremony (real DB, mocked WebAuthn crypto)
- Full passkey authentication ceremony → session creation
- Challenge expiry behavior
- Counter validation (clone detection)
- Multiple passkeys per user

---

## Prerequisites

- Phase 2 complete (session module + auth module + Bearer middleware)
- `passkeys` table migration already applied (from Phase 2 Layer 0)
- `@simplewebauthn/server` already installed
- WebAuthn env vars already configured (`WEBAUTHN_RP_NAME`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`)
