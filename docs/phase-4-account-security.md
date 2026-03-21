# Identity Starter — Phase 4: Account Self-Service & Security Hardening

**Status: NOT STARTED**

## Overview

Add end-user account management (profile, sessions, passkeys) and security hardening features (email verification, login attempt tracking, rate limiting). All account routes require an authenticated session.

---

## Scope

### New Modules
- **Account module** — End-user self-service for profile, sessions, and passkeys

### New DB Tables
- `email_verification_tokens` — One-time email verification tokens
- `login_attempts` — Failed/successful login tracking for rate limiting
- `totp_secrets` — TOTP MFA secrets (one per user)
- `recovery_codes` — Hashed single-use recovery codes
- `password_reset_tokens` — Password reset tokens with TTL

### Security Features
- Email verification flow (required before status → `active`)
- MFA via TOTP (RFC 6238) + recovery codes
- Password reset / forgot password flow
- Login attempt tracking + progressive delay
- Rate limiting on public auth endpoints
- Breached password checking (NIST 800-63B mandate)

### Explicitly Deferred
- SMTP/transactional email delivery — tokens returned in API response for now
- Frontend UI → Phase 7

---

## Features

### Account Self-Service
- View own profile
- Update own displayName and metadata
- List own active sessions (with current session indicator)
- Revoke own sessions (except current, or including current for "logout everywhere")
- List own passkeys
- Rename own passkey
- Delete own passkey
- All operations verify resource ownership (userId match)

### Email Verification
- On registration: generate verification token, set status to `pending_verification`
- `POST /api/auth/verify-email` — verify token, set `email_verified = true`, status → `active`
- `POST /api/auth/resend-verification` — generate new token, invalidate old one
- Token TTL: 24 hours, single-use
- **Note**: Actual email delivery is out of scope — tokens are returned in API response for now (plug in SMTP/transactional email later)

### Login Attempt Tracking
- Record every login attempt (success/failure) with email + IP
- Progressive delay after 5 failed attempts per email (not hard lockout — prevents DoS)
- Prune records older than 24 hours
- Query: `SELECT COUNT(*) FROM login_attempts WHERE email = $1 AND success = false AND created_at > NOW() - INTERVAL '24 hours'`

### Rate Limiting
- Per-IP rate limiting on public auth endpoints (`/api/auth/register`, `/api/auth/login`)
- Use `@fastify/rate-limit` or custom middleware
- Configurable limits via env vars

### MFA — TOTP (RFC 6238)
- Enroll: generate TOTP secret → return `otpauth://` URI (for QR code) → verify first OTP to confirm
- Verify: validate 6-digit OTP with 30-second window (±1 step for clock drift)
- On enrollment: generate 8 recovery codes, return to user once (never shown again)
- MFA required for: step-up operations (password change, passkey management, consent grant)
- MFA optional but recommended: can be enforced per-role via admin policy

### Recovery Codes
- 8 codes generated at MFA enrollment (format: `XXXX-XXXX`, alphanumeric)
- Each code is single-use — marked `used_at` on consumption
- Stored hashed (Argon2) — plaintext never persisted
- Regeneration: invalidates all previous codes, generates new set
- Acts as AAL2 fallback when TOTP device is unavailable

### Password Reset / Forgot Password
- `POST /api/auth/forgot-password` — generate reset token, return in response (plug in email delivery later)
- `POST /api/auth/reset-password` — verify token + set new password
- On successful reset: hash new password, revoke ALL user sessions, mark token used
- Token TTL: 1 hour, single-use
- Rate limited: max 3 reset requests per email per hour

### Breached Password Checking
- Required per NIST 800-63B — not optional
- Check against HaveIBeenPwned k-anonymity API (SHA-1 prefix, no full hash sent)
- Enforced on: registration, password change, password reset
- If API is unavailable: allow the password (fail open) but log a warning

### Account Recovery
- Primary: recovery codes (generated at MFA enrollment)
- If user has no recovery codes and no MFA: password reset flow
- If user has lost all factors: admin-initiated recovery (Phase 6 admin API)
- Design principle: at least one recovery path must always exist

---

## DB Schema

### email_verification_tokens

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `user_id` | `uuid` | FK → `users.id` (CASCADE DELETE), NOT NULL | — |
| `token` | `text` | UNIQUE, INDEXED, NOT NULL | — |
| `expires_at` | `timestamp` | NOT NULL | — |
| `used_at` | `timestamp` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

### login_attempts

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `email` | `varchar(255)` | INDEXED, NOT NULL | — |
| `ip_address` | `varchar(45)` | INDEXED, NOT NULL | — |
| `success` | `boolean` | NOT NULL | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

---

### totp_secrets

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `user_id` | `uuid` | FK → `users.id` (CASCADE DELETE), UNIQUE, NOT NULL | — |
| `secret` | `text` | NOT NULL | — |
| `verified` | `boolean` | NOT NULL | `false` |
| `created_at` | `timestamp` | NOT NULL | `now()` |

One TOTP secret per user. Encrypted at rest. `verified` = true after first successful OTP.

### recovery_codes

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `user_id` | `uuid` | FK → `users.id` (CASCADE DELETE), NOT NULL | — |
| `code_hash` | `text` | NOT NULL | — |
| `used_at` | `timestamp` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

8 codes per user. Single-use. Hashed with Argon2. Regeneration invalidates all previous codes.

### password_reset_tokens

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `user_id` | `uuid` | FK → `users.id` (CASCADE DELETE), NOT NULL | — |
| `token` | `text` | UNIQUE, INDEXED, NOT NULL | — |
| `expires_at` | `timestamp` | NOT NULL | — |
| `used_at` | `timestamp` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

1-hour TTL. Single-use. On reset: hash new password, revoke all user sessions, mark token used.

---

## API Routes

### Account Routes (`/api/account/*`) — All Require Session

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/account/profile` | Session | Get own profile |
| PATCH | `/api/account/profile` | Session | Update displayName / metadata |
| GET | `/api/account/sessions` | Session | List own active sessions |
| DELETE | `/api/account/sessions/:id` | Session | Revoke one of own sessions |
| GET | `/api/account/passkeys` | Session | List own passkeys |
| PATCH | `/api/account/passkeys/:id` | Session | Rename a passkey |
| DELETE | `/api/account/passkeys/:id` | Session | Delete a passkey |

### Auth Routes (additions)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/verify-email` | Public | Verify email with token |
| POST | `/api/auth/resend-verification` | Public | Resend verification email (rate limited) |
| POST | `/api/auth/forgot-password` | Public | Request password reset token (rate limited) |
| POST | `/api/auth/reset-password` | Public | Reset password with token |
| POST | `/api/account/mfa/totp/enroll` | Session | Start TOTP enrollment (returns otpauth URI + recovery codes) |
| POST | `/api/account/mfa/totp/verify` | Session | Verify first OTP to confirm enrollment |
| DELETE | `/api/account/mfa/totp` | Session + Step-up | Disable TOTP |
| POST | `/api/account/mfa/recovery-codes/regenerate` | Session + Step-up | Regenerate recovery codes |
| POST | `/api/auth/mfa/verify` | Public (mid-auth) | Verify TOTP/recovery code during login |

---

## Events

### Account Events
- `account.profile_updated` — payload: `{ userId }`
- `account.session_revoked` — payload: `{ sessionId, userId }`
- `account.passkey_renamed` — payload: `{ passkeyId, userId }`
- `account.passkey_deleted` — payload: `{ passkeyId, userId }`

### Auth Events (additions)
- `auth.email_verified` — payload: `{ userId }`

### MFA Events
- `mfa.totp.enrolled` — payload: `{ userId }`
- `mfa.totp.disabled` — payload: `{ userId }`
- `mfa.totp.verified` — payload: `{ userId }` (during login)
- `mfa.recovery_codes.generated` — payload: `{ userId }`
- `mfa.recovery_code.used` — payload: `{ userId, remaining: number }`
- `auth.password_reset.requested` — payload: `{ userId, email }`
- `auth.password_reset.completed` — payload: `{ userId }`

---

## Cross-Module Dependencies

- **Account module** → `@identity-starter/db` (users, sessions, passkeys tables), Session middleware (from Phase 2)
- **Email verification** → `@identity-starter/db` (email_verification_tokens, users tables)
- **Login attempts** → `@identity-starter/db` (login_attempts table), Auth module (hook into login flow)

---

## Testing Strategy

### Unit Tests
- **Account service**: profile CRUD, session list/revoke, passkey management (mocked DB)
- **Email verification**: token generation, validation, expiry (mocked DB)
- **Login attempts**: counting, threshold detection (mocked DB)
- **Schemas**: all Zod validation paths
- **Routes**: mocked service, all status codes + ownership checks

### Integration Tests
- Account self-service flows with real DB (create user → update profile → list sessions → revoke)
- Email verification lifecycle (register → verify token → status = active)
- Expired / used token rejection
- Login attempt progressive delay (5+ failures → delay)
- Ownership enforcement (can't revoke another user's session)
- Rate limiting behavior
- MFA enrollment: enroll TOTP → verify OTP → recovery codes returned
- MFA login flow: login with password → MFA challenge → verify OTP → session created
- Recovery code flow: use recovery code instead of OTP → verify works, code consumed
- Password reset: request token → reset password → old sessions revoked → login with new password
- Breached password rejection on registration and password change

---

## Prerequisites

- Phase 2 complete (session module + auth module + Bearer middleware)
- Phase 3 complete (passkey module — needed for passkey management routes)
