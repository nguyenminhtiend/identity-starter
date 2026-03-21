# Identity Starter — Phase 2: Auth Core

**Status: IN PROGRESS** (Layer 0 complete)

## Overview

Build session management and password authentication on top of Phase 1's User module. This is the minimum viable auth layer — register, login, logout, change password — all protected by Bearer token session middleware.

---

## Scope

### New Modules
- **Session module** — Session creation, validation, revocation, cleanup
- **Auth module** — Password registration, login, logout, password change

### DB Tables
- `sessions` — Session storage (schema + migration done in Layer 0)

### Key Libraries
- `@node-rs/argon2` — Password hashing (installed in Layer 0)

### Explicitly Deferred
- Passkeys/WebAuthn → Phase 3
- Account self-service → Phase 4
- Email verification → Phase 4
- Rate limiting / login attempts → Phase 4
- Redis session cache → enhancement, not required for DB-only sessions
- Frontend UI → Phase 7

---

## Architecture Decisions

### Session Strategy: DB-Only
- Sessions stored in PostgreSQL (`sessions` table) — source of truth
- Token: `crypto.randomBytes(32).toString('base64url')` — 256-bit entropy
- Validation: query by token where `expires_at > NOW()`, update `last_active_at`
- Configurable TTL via `SESSION_TTL_SECONDS` env (default: 7 days)
- Redis caching can be layered on later without changing the session module API

### Auth Module Responsibility Split
- **Auth module** owns authentication *flows* (login, register, logout, password change)
- **Session module** owns session *lifecycle* (create, validate, revoke, cleanup)
- Auth module queries `users` and `sessions` tables directly via `@identity-starter/db`
- Session validation middleware is reusable by all future phases (passkeys, OAuth, admin)

### Password Reset — Deferred
- Requires email delivery (SMTP or transactional email provider)
- API surface designed to accommodate it later

---

## Features

### Session Management
- Session creation on successful auth
- Session validation middleware (Fastify `onRequest` hook)
- Session revocation (single session, all user sessions)
- Expired session cleanup
- `last_active_at` tracking for idle timeout detection (NIST 800-63B)

### Password Authentication
- Registration with email + password + displayName (hash via Argon2)
- Login with email + password (verify hash, check status, create session)
- Logout (revoke current session)
- Password change (requires current password verification)

### Session Security Hardening
- Session token rotation on privilege escalation (password change creates new session, revokes old)
- Concurrent session limit: configurable max active sessions per user (default: 10). Oldest session revoked when limit exceeded.
- Session binding: log IP + User-Agent at creation, flag mismatches on validation (warn, don't block — IPs change legitimately)

---

## DB Schema

### sessions (created in Layer 0)

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

---

## API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | Public | Register with email + password + displayName → session token |
| POST | `/api/auth/login` | Public | Login with email + password → session token |
| POST | `/api/auth/logout` | Session | Revoke current session |
| POST | `/api/auth/change-password` | Session | Change password (verify current first) |

Session token returned in response body (`{ token, user }`) — API-first, no cookies.

---

## Events

### Session Events
- `session.created` — payload: `{ session }`
- `session.revoked` — payload: `{ sessionId, userId }`

### Auth Events
- `auth.registered` — payload: `{ userId }`
- `auth.login` — payload: `{ userId }`
- `auth.logout` — payload: `{ userId, sessionId }`
- `auth.password_changed` — payload: `{ userId }`
- `auth.failed_login` — payload: `{ email, reason }`

---

## Cross-Module Dependencies

- **Session module** → `@identity-starter/db` (sessions table)
- **Auth module** → `@identity-starter/db` (users + sessions tables), `@node-rs/argon2`

---

## Testing Strategy

### Unit Tests
- **Session service**: create/validate/revoke logic, TTL behavior, token generation
- **Auth service**: register/login/logout/changePassword flows (mocked DB)
- **Schemas**: Zod validation for all inputs
- **Routes**: mocked service, test all status codes + error responses

### Integration Tests
- Session lifecycle: create → validate → revoke with real DB
- Expired session handling: validate returns null, cleanup deletes rows
- Auth flows: register → login → access protected route → logout
- Error cases: duplicate email, wrong password, suspended account, expired session
- Session middleware: Bearer token extraction, 401 on missing/invalid/expired

---

## Prerequisites

- Phase 1 complete ✅
- Layer 0 complete ✅ (sessions schema, env vars, `@node-rs/argon2` + `@simplewebauthn/server` installed)
- Running PostgreSQL instance
