# Identity Starter — Phase 7: Frontend

**Status: NOT STARTED**

## Overview

Build the web UI for end-user and admin interactions. Next.js 15 app with shadcn/ui + Tailwind CSS v4. Consumes the API built in Phases 2-6.

---

## Scope

### New App
- `apps/web/` — Next.js 15 (App Router)

### Key Libraries
- Next.js 15
- shadcn/ui + Tailwind CSS v4
- `@simplewebauthn/browser` — WebAuthn browser-side operations

### Pages

#### Authentication (Phases 2-3 APIs)
- Login page — email + password with passkey conditional UI (`mediation: 'conditional'`) for autofill
- Registration page (email + password + displayName)
- Passkey login prompt / challenge (fallback for non-conditional-UI browsers)
- MFA verification page (TOTP input + recovery code fallback)
- Email verification page
- Password reset page (request + set new password)

#### Account Self-Service (Phase 4 API)
- Profile page (view/edit displayName, metadata)
- Sessions page (list active sessions, revoke)
- Passkeys page (list, rename, delete, register new)
- MFA settings page (enable/disable TOTP, view/regenerate recovery codes)
- Password change + password reset flow

#### OAuth2 Consent (Phase 5 API)
- Authorization page (client info, requested scopes)
- Consent page (allow/deny with scope descriptions)

#### Admin Dashboard (Phase 6 API)
- User management (list, detail, suspend/activate)
- Role management (create, assign, permissions)
- Session management (list, revoke)
- Audit log viewer (filterable, paginated)

---

## Architecture Decisions

### API-First Integration
- All data fetched via the REST API (no direct DB access from frontend)
- Session token stored in `httpOnly` + `SameSite=Strict` + `Secure` cookie — set by server on login/register responses
- API server reads token from cookie on same-origin requests, also accepts `Authorization: Bearer <token>` header for cross-origin / API clients
- No `localStorage` for tokens — XSS-vulnerable and inappropriate for an IdP reference implementation

### Component Strategy
- shadcn/ui for base components (Button, Input, Card, Table, Dialog, etc.)
- Tailwind CSS v4 for styling
- Server Components where possible, Client Components for interactive forms

### Security Headers
- `Content-Security-Policy` with nonce-based script policy — no `unsafe-inline`
- `X-Frame-Options: DENY` — prevent clickjacking on consent/auth pages
- `Referrer-Policy: strict-origin` — prevent token leakage in referrer headers
- All auth-related pages set `Cache-Control: no-store` to prevent back-button caching of sensitive forms

### CORS Configuration
- API server allows the web app origin (`CORS_ORIGIN` env var)
- OAuth endpoints allow registered redirect URI origins
- Discovery / JWKS endpoints allow `*`

### Route Structure
```
/login
/register
/verify-email
/account
/account/sessions
/account/passkeys
/oauth/authorize    (consent flow)
/admin
/admin/users
/admin/users/:id
/admin/roles
/admin/sessions
/admin/audit-logs
```

---

## Explicitly Deferred
- Mobile app
- i18n / localization
- Theming beyond default shadcn theme
- Separate admin app (`apps/admin/`) — admin pages are part of `apps/web/` behind role-based route guards for simplicity. Can be extracted later if different security posture needed

---

## Prerequisites

- Phases 2-6 complete (all API endpoints available)
- Can be built incrementally: auth pages after Phase 2, account pages after Phase 4, etc.
