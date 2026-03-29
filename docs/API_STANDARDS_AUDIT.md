# API Standards Audit — OAuth 2.1 / OIDC Compliance

> Generated: 2026-03-28

This audit evaluates the Identity Starter API surface against **OAuth 2.1 (draft-ietf-oauth-v2-1)**, **OIDC Core 1.0**, and **2026 industry best practices** for three user bases:

1. **Web app users** — custom UI or unified IdP login page
2. **Mobile native app users** — custom mobile app or WebView
3. **Admin dashboard users** — client and user pool management

---

## Table of Contents

- [1. Current API Surface (44 Endpoints)](#1-current-api-surface-44-endpoints)
- [2. Coverage Per User Base](#2-coverage-per-user-base)
- [3. First-Party vs Third-Party: Why the Flows Differ](#3-first-party-vs-third-party-why-the-flows-differ)
- [4. Recommended Flow Combinations](#4-recommended-flow-combinations)
- [5. Gaps and Missing APIs](#5-gaps-and-missing-apis)
- [6. Redundant APIs](#6-redundant-apis)
- [7. Summary Verdict](#7-summary-verdict)

---

## 1. Current API Surface (44 Endpoints)

### Health & Discovery (3)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | None | Server health check |
| GET | `/.well-known/openid-configuration` | None | OIDC metadata discovery |
| GET | `/.well-known/jwks.json` | None | Public signing keys |

### Authentication (8)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/register` | None (5/15m) | Create user account |
| POST | `/api/auth/login` | None (10/15m) | Login, may return `mfaRequired` |
| POST | `/api/auth/verify-email` | None (10/15m) | Activate account via token |
| POST | `/api/auth/resend-verification` | None (3/15m) | Resend verification email |
| POST | `/api/auth/logout` | Session | Revoke session, clear cookie |
| POST | `/api/auth/change-password` | Session | Update password |
| POST | `/api/auth/forgot-password` | None (3/15m) | Initiate password reset |
| POST | `/api/auth/reset-password` | None (5/15m) | Complete password reset |

### Passkey Authentication (4)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/passkeys/register/options` | Session (10/15m) | WebAuthn registration challenge |
| POST | `/api/auth/passkeys/register/verify` | Session (10/15m) | Complete passkey registration |
| POST | `/api/auth/passkeys/login/options` | None (10/15m) | WebAuthn login challenge |
| POST | `/api/auth/passkeys/login/verify` | None (10/15m) | Authenticate via passkey |

### MFA (5)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/mfa/verify` | None (10/15m) | Complete MFA challenge after login |
| POST | `/api/account/mfa/totp/enroll` | Session | Generate TOTP secret + QR |
| POST | `/api/account/mfa/totp/verify` | Session | Confirm TOTP enrollment |
| DELETE | `/api/account/mfa/totp` | Session | Disable TOTP (requires password) |
| POST | `/api/account/mfa/recovery-codes/regenerate` | Session | New recovery codes (requires password) |

### OAuth 2.0 / OIDC (9)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/oauth/authorize` | Session | Authorization endpoint (PKCE required) |
| POST | `/oauth/par` | Client auth | Pushed Authorization Request (RFC 9126) |
| POST | `/oauth/consent` | Session | Approve/deny consent |
| DELETE | `/oauth/consent/:clientId` | Session | Revoke previously granted consent |
| POST | `/oauth/token` | Client auth (60/1m) | Token exchange (auth_code, refresh, client_credentials) |
| GET | `/oauth/userinfo` | Bearer/DPoP | OIDC userinfo claims |
| POST | `/oauth/introspect` | Client auth | Token introspection (RFC 7662) |
| POST | `/oauth/revoke` | Optional client auth | Token revocation (RFC 7009) |
| GET | `/oauth/end-session` | Optional Bearer | RP-Initiated Logout |

### Account Self-Service (7)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/account/profile` | Session | Get own profile |
| PATCH | `/api/account/profile` | Session | Update display name / metadata |
| GET | `/api/account/sessions` | Session | List own active sessions |
| DELETE | `/api/account/sessions/:id` | Session | Revoke own session (not current) |
| GET | `/api/account/passkeys` | Session | List enrolled passkeys |
| PATCH | `/api/account/passkeys/:id` | Session | Rename passkey |
| DELETE | `/api/account/passkeys/:id` | Session | Remove passkey |

### User (1)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/users/:id` | Session | Get any user's profile (see [Redundancy R-1](#r-1-get-apiusersid--unnecessary-and-insecure)) |

### Admin — Client Management (6)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/admin/clients` | Admin | Register OAuth client |
| GET | `/api/admin/clients` | Admin | List all clients |
| GET | `/api/admin/clients/:id` | Admin | Get client details |
| PATCH | `/api/admin/clients/:id` | Admin | Update client config |
| DELETE | `/api/admin/clients/:id` | Admin | Delete client |
| POST | `/api/admin/clients/:id/rotate-secret` | Admin | Rotate client secret |

### Admin — User & Role Management (7)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/admin/users` | users:read | List users (paginated) |
| GET | `/api/admin/users/:id` | users:read | Get user details |
| PATCH | `/api/admin/users/:id/status` | users:write | Suspend/activate user |
| POST | `/api/admin/roles` | roles:write | Create RBAC role |
| GET | `/api/admin/roles` | roles:read | List roles + permissions |
| PUT | `/api/admin/roles/:id/permissions` | roles:write | Set role permissions |
| POST | `/api/admin/users/:id/roles` | roles:write | Assign role to user |
| DELETE | `/api/admin/users/:id/roles/:roleId` | roles:write | Remove role from user |

### Admin — Session Management (3)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/admin/sessions` | sessions:read | List all sessions |
| DELETE | `/api/admin/sessions/:id` | sessions:write | Force-revoke any session |
| DELETE | `/api/admin/users/:id/sessions` | sessions:write | Bulk revoke user sessions |

### Admin — Audit (3)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/admin/audit-logs` | audit:read | Query logs with filters |
| GET | `/api/admin/audit-logs/verify` | audit:read | Verify hash chain integrity |
| GET | `/api/admin/audit-logs/export` | audit:export | Export NDJSON |

---

## 2. Coverage Per User Base

### 2.1 Web App User (Third-Party OAuth / OIDC)

Full authorization code flow with PKCE, consent management, token lifecycle, and OIDC logout.

| Capability | Endpoint(s) | Status |
|-----------|-------------|--------|
| OIDC Discovery | `GET /.well-known/openid-configuration` | Implemented |
| JWKS | `GET /.well-known/jwks.json` | Implemented |
| Authorization (PKCE) | `GET /oauth/authorize` | Implemented (S256 mandatory) |
| PAR | `POST /oauth/par` | Implemented (RFC 9126) |
| Consent | `POST /oauth/consent` | Implemented |
| Token Exchange | `POST /oauth/token` | Implemented (auth_code, refresh, client_credentials) |
| ID Token | via `/oauth/token` | Implemented (signed JWT) |
| Userinfo | `GET /oauth/userinfo` | Implemented (scope-filtered) |
| Token Revocation | `POST /oauth/revoke` | Implemented (RFC 7009) |
| Token Introspection | `POST /oauth/introspect` | Implemented (RFC 7662) |
| RP-Initiated Logout | `GET /oauth/end-session` | Implemented |
| DPoP | via token + userinfo | Implemented (ES256, RS256) |
| Refresh Token Rotation | via `/oauth/token` | Implemented (with grace period) |

**Coverage: 95% — Production-ready.**

### 2.2 Web App User (First-Party Custom UI)

Full session-based auth with MFA, passkeys, email verification, password management, and account self-service.

| Capability | Endpoint(s) | Status |
|-----------|-------------|--------|
| Register | `POST /api/auth/register` | Implemented |
| Email Verification | `POST /api/auth/verify-email` + resend | Implemented |
| Login | `POST /api/auth/login` | Implemented |
| MFA Step-Up | `POST /api/auth/mfa/verify` | Implemented (TOTP + recovery) |
| Passkey Login | `POST /api/auth/passkeys/login/*` | Implemented (WebAuthn) |
| Logout | `POST /api/auth/logout` | Implemented |
| Password Reset | `POST /api/auth/forgot-password` + reset | Implemented |
| Password Change | `POST /api/auth/change-password` | Implemented |
| Profile Management | `GET/PATCH /api/account/profile` | Implemented |
| Session Management | `GET/DELETE /api/account/sessions` | Implemented |
| Passkey Management | `GET/PATCH/DELETE /api/account/passkeys` | Implemented |
| MFA Enrollment | TOTP enroll/verify/disable + recovery | Implemented |

**Coverage: 100% — Fully covered.**

### 2.3 Mobile Native App

Uses OAuth 2.1 Authorization Code + PKCE via system browser, with PAR and DPoP for enhanced security.

| Capability | Endpoint(s) | Status |
|-----------|-------------|--------|
| PAR (avoid URL leakage) | `POST /oauth/par` | Implemented |
| Auth Code + PKCE | `GET /oauth/authorize` | Implemented |
| DPoP Binding | `POST /oauth/token` + DPoP header | Implemented |
| Token Refresh | `POST /oauth/token` (refresh grant) | Implemented |
| Userinfo | `GET /oauth/userinfo` | Implemented |
| Token Revocation | `POST /oauth/revoke` | Implemented |
| Silent Auth (`prompt=none`) | `GET /oauth/authorize` | **NOT IMPLEMENTED** |
| Login Hint | `GET /oauth/authorize` | **NOT IMPLEMENTED** |

**Coverage: 90% — Strong, but missing `prompt` parameter for silent session checks.**

### 2.4 Admin Dashboard

Full client, user, role, session, and audit management with RBAC permissions.

| Capability | Endpoint(s) | Status |
|-----------|-------------|--------|
| Admin Login | `POST /api/auth/login` (admin_session cookie) | Implemented |
| Client CRUD | `/api/admin/clients/*` | Implemented (6 endpoints) |
| Secret Rotation | `POST /api/admin/clients/:id/rotate-secret` | Implemented |
| User Management | `/api/admin/users/*` | Implemented |
| Role/Permission RBAC | `/api/admin/roles/*` | Implemented |
| Session Oversight | `/api/admin/sessions/*` | Implemented |
| Audit Logs | `/api/admin/audit-logs/*` | Implemented (query, verify, export) |

**Coverage: 100% — Fully covered.**

---

## 3. First-Party vs Third-Party: Why Flows A, B, D, F Exist

### The core question: "Who is asking for the user's password?"

Every flow in this IdP exists because of one variable: **trust**. Who wrote the code that handles the user's credentials?

| | First-Party | Third-Party |
|--|-------------|-------------|
| **Who owns it?** | You — same org that runs the IdP | External developers or partner orgs |
| **Trust level** | Full trust — your code, your servers | Zero trust — unknown code, unknown servers |
| **Can it see the password?** | Yes — your login form posts directly to your API | **Never** — OAuth exists specifically to prevent this |
| **Auth model** | Direct session (cookie-based) | OAuth 2.1 (token-based, delegated) |

### Why 4 different flows? Real-world examples

#### Flow A — Third-Party Web App (OAuth 2.1)

**Real example:** You are building an IdP like Auth0. A company called "Acme Corp" builds a project management tool at `acme.com`. They want "Login with YourIdP" on their site.

```
What the user sees:
1. User clicks "Login with YourIdP" on acme.com
2. Browser redirects to YOUR login page (idp.example.com/login)
3. User types password into YOUR page (never acme.com's page)
4. YOUR page shows: "Acme Corp wants access to your email and profile. Allow?"
5. User clicks "Allow"
6. Browser redirects back to acme.com — user is logged in

What happens behind the scenes:
- Acme's server never sees the password
- Acme gets a scoped access_token (can only read email + profile, not change password)
- You can revoke Acme's access anytime
- You can see in audit logs: "User X granted Acme access to [email, profile]"
```

**Why OAuth is required here:** Acme is untrusted code. If you gave Acme the user's password, they could do anything — change the password, delete the account, read private data. OAuth solves this by giving them a limited, revocable token instead.

**Who uses this flow?**
- "Login with Google" on any website
- "Login with GitHub" on Vercel, Netlify, etc.
- Any external app integrating with your IdP

---

#### Flow B — First-Party Web App (Direct Session)

**Real example:** You are building the IdP itself. `apps/web` is YOUR login/register/account page at `idp.example.com`. This is the page that users see when they type their password.

```
What the user sees:
1. User goes to idp.example.com/login
2. Types email + password into YOUR form
3. Sees their account dashboard

What happens behind the scenes:
- Your Next.js app (apps/web) sends POST /api/auth/login to your Fastify server
- Server validates, returns session cookie
- All subsequent requests use that cookie
- No OAuth, no tokens, no consent screen
```

**Why no OAuth here:** This IS the IdP's own UI. The user is typing their password directly into the IdP. There's no third-party to protect against. Adding OAuth here would be like locking a door and then climbing through the window — pointless indirection.

**Real-world comparison:**
- When you go to `accounts.google.com` and log in — that's Google's first-party login (Flow B)
- When you click "Login with Google" on Spotify — that's third-party OAuth (Flow A)
- Google uses direct session auth on `accounts.google.com`, not OAuth to itself

**Who uses this flow?**
- `apps/web` — your IdP's user-facing auth pages
- `apps/admin` — your admin dashboard (Flow E)
- Auth0's own dashboard at `manage.auth0.com`
- Keycloak's own account console

---

#### Flow D — SPA Without Backend (OAuth + BFF)

**Real example:** A startup builds a React SPA at `app.startup.com` with no server — just static files on a CDN. They want users to log in via your IdP.

```
The problem:
- SPA runs entirely in the browser (JavaScript)
- Browser JavaScript is inherently insecure (XSS can steal any JS variable)
- If the SPA stores access_token in localStorage/memory, any XSS attack steals it
- OAuth 2.1 says: browsers SHOULD NOT handle tokens directly

The solution (BFF pattern):
- Add a thin backend proxy ("Backend-for-Frontend")
- BFF does the OAuth dance server-side
- BFF stores tokens in server memory, gives browser an httpOnly cookie
- Browser never sees or touches the access_token

What the user sees:
  Same as Flow A — redirect to IdP, login, consent, redirect back

What's different from Flow A:
  Flow A: third-party SERVER exchanges code for token (server-to-server)
  Flow D: BFF proxy exchanges code for token (proxy-to-server)
  The browser is never trusted with tokens in either case
```

**Why a separate flow?** It's actually Flow A underneath, but the architectural pattern is different. In Flow A, a traditional web server (Rails, Django, Express) handles tokens. In Flow D, a purpose-built BFF proxy handles tokens because the app itself has no server.

**Who uses this flow?**
- React/Vue/Angular SPAs hosted on Vercel/Netlify/CDN with no backend
- Figma, Notion (web versions), Linear — all use BFF-like patterns
- Any "serverless" frontend that needs secure auth

---

#### Flow F — Service-to-Service (Client Credentials)

**Real example:** You have a cron job that runs every night to clean up expired accounts. Or a microservice that needs to validate tokens. No human user is involved.

```
What happens:
1. Backend service sends its own client_id + client_secret to /oauth/token
2. Gets back an access_token
3. Uses that token to call your APIs
4. No browser, no redirect, no login page, no user

There is NO user in this flow. The "user" is the service itself.
```

**Why this exists:** Sometimes machines need to talk to machines. A payment service needs to look up user data. A reporting service needs to query audit logs. They authenticate as themselves, not on behalf of a user.

**Who uses this flow?**
- Cron jobs (nightly cleanup, report generation)
- Microservices calling each other
- CI/CD pipelines deploying or checking status
- Monitoring services checking health

---

### When to use which flow — decision tree

```
Is there a human user involved?
├── NO → Flow F (Client Credentials)
│
└── YES → Who built the app the user is using?
    │
    ├── YOU (first-party) → Does the app have a server/backend?
    │   ├── YES (Next.js SSR, Express, etc.) → Flow B (Direct Session)
    │   └── NO (pure SPA on CDN) → Flow D (OAuth + BFF)
    │
    └── SOMEONE ELSE (third-party) → Is it a web app or native app?
        ├── Web app → Flow A (OAuth 2.1)
        └── Native mobile/desktop → Flow C (OAuth + PAR + DPoP)
```

### Why apps/web uses Flow B but handles Flow A's login page

This is the subtle part. Your `apps/web` has **two roles**:

```
Role 1: First-party app (Flow B)
  - User goes to idp.example.com/login directly
  - POST /api/auth/login → session cookie
  - User manages their own account

Role 2: IdP login page for third-party OAuth (Flow A)
  - Acme.com redirects user to idp.example.com/oauth/authorize
  - apps/web middleware detects no session → redirects to /login?callbackUrl=...
  - User logs in (same POST /api/auth/login → session cookie)
  - Redirects back to /oauth/authorize → consent screen → redirect to acme.com

The LOGIN STEP is identical. The difference is what happens AFTER:
  Flow B: user stays on idp.example.com (account dashboard)
  Flow A: user is redirected back to acme.com with an auth code
```

---

## 3.1. The Login Page Architecture Question

### Current architecture (what you have now)

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  apps/server (Fastify)          apps/web (Next.js)           │
│  ┌──────────────────┐          ┌──────────────────────┐      │
│  │  Pure JSON API    │  ◄────  │  Login page (React)  │      │
│  │  POST /api/auth/* │  fetch  │  Consent page        │      │
│  │  GET /oauth/*     │         │  Account dashboard   │      │
│  │                   │         │  SSR via Next.js      │      │
│  │  No HTML rendering│         │  Port 3100            │      │
│  │  Port 3000        │         │                      │      │
│  └──────────────────┘          └──────────────────────┘      │
│                                                              │
│  The server has NO login page. apps/web IS the login page.   │
└──────────────────────────────────────────────────────────────┘
```

### Should the login page be SSR on the IdP server itself?

**Short answer:** Your current architecture (separate Next.js app as IdP UI) is the modern, correct approach. You do NOT need to add SSR to the Fastify server.

**Why?** Let's compare the two approaches:

| Approach | How it works | Who does this |
|----------|-------------|---------------|
| **A. Login page in Next.js app (current)** | Separate app renders login UI. Calls Fastify API. | Auth0, Clerk, WorkOS, Stytch |
| **B. Login page SSR in Fastify** | Fastify renders HTML with template engine (EJS/Pug). | Keycloak (Java + FreeMarker), ORY Hydra (Go + custom UI) |

Both are valid. Here's the trade-off:

| Factor | Next.js app (current) | Fastify SSR |
|--------|----------------------|-------------|
| **Developer experience** | React components, hot reload, modern DX | Template strings, manual DOM |
| **Customizability** | Full React ecosystem | Limited to template engine |
| **Deployment** | Two services to deploy | One service |
| **Performance** | Next.js SSR is fast, can use RSC | Template rendering is faster (simpler) |
| **OAuth redirect flow** | Works — middleware redirects to /login | Works — server redirects to /login |
| **Industry trend (2026)** | Dominant pattern | Legacy pattern (Keycloak is moving to React) |

### What matters: the login page must be on the IdP's domain

Regardless of whether you use Next.js or Fastify SSR, the critical security requirement is:

```
The login page MUST be served from YOUR domain (idp.example.com).
Third-party apps MUST redirect to YOUR login page.
The user MUST type their password into YOUR page, never the third-party's page.
```

Your current setup satisfies this. `apps/web` runs on your domain and serves the login page. The OAuth `/authorize` endpoint redirects unauthenticated users to this login page. After login, the user is redirected back to the OAuth flow.

### How the redirect chain works today

```
Third-party (acme.com)                Your IdP
─────────────────────                 ────────

1. User clicks "Login"
2. ──► GET idp.example.com/oauth/authorize?client_id=acme&...
                                      3. apps/web middleware: no session cookie?
                                      4. ◄── 302 to /login?callbackUrl=/oauth/authorize?...
                                      5. User sees YOUR login page (apps/web)
                                      6. Types password → POST /api/auth/login
                                      7. Server validates → sets session cookie
                                      8. ◄── 302 back to /oauth/authorize?...
                                      9. Now has session → shows consent screen
                                      10. User approves → POST /oauth/consent
11. ◄── 302 to acme.com/callback?code=...&state=...
12. Acme exchanges code for token
```

### Recommendation: keep current architecture

Your `apps/web` (Next.js) as the IdP login UI is the right call for 2026:
- React Server Components give you SSR without sacrificing interactivity
- WebAuthn/passkey flows need JavaScript (can't do pure SSR)
- MFA TOTP enrollment needs QR code rendering
- Modern IdPs (Auth0, Clerk, WorkOS) all use this pattern
- Keycloak (the biggest open-source IdP) is actively migrating from FreeMarker templates to React

The only reason to add SSR to Fastify would be if you wanted an ultra-minimal fallback login page for environments without JavaScript. That's a niche requirement.

---

## 4. Recommended Flow Combinations

### Flow A: Third-Party Web App (OAuth 2.1 / OIDC)

**When:** External app wants "Login with YourIdP". App never sees user's password.

```
Third-Party Web App                         Identity Provider
───────────────────                         ─────────────────

  ┌─ SETUP (one-time) ──────────────────────────────────────────┐
  │ Admin registers client via /api/admin/clients               │
  │ → receives client_id + client_secret                        │
  └─────────────────────────────────────────────────────────────┘

  ┌─ LOGIN ─────────────────────────────────────────────────────┐
  │                                                             │
  │ 1. Generate code_verifier + S256 hash                       │
  │ 2. ──► GET /oauth/authorize                                 │
  │        ?response_type=code                                  │
  │        &client_id=...                                       │
  │        &redirect_uri=https://thirdparty.com/callback        │
  │        &scope=openid profile email                          │
  │        &code_challenge=...&code_challenge_method=S256        │
  │        &state=...&nonce=...                                 │
  │                                                             │
  │                          3. IdP shows login page             │
  │                             User authenticates:              │
  │                             POST /api/auth/login             │
  │                             POST /api/auth/mfa/verify        │
  │                             (or passkey login)               │
  │                                                             │
  │                          4. IdP shows consent screen          │
  │                             "ThirdPartyApp wants access to   │
  │                              your email and profile"         │
  │                             POST /oauth/consent (approve)    │
  │                                                             │
  │ 5. ◄── 302 redirect_uri?code=...&state=...                 │
  │ 6. ──► POST /oauth/token                                    │
  │        (code + code_verifier + client_secret)               │
  │ 7. ◄── {access_token, id_token, refresh_token, scope}       │
  └─────────────────────────────────────────────────────────────┘

  ┌─ USE TOKEN ─────────────────────────────────────────────────┐
  │ 8. ──► GET /oauth/userinfo                                  │
  │        Authorization: Bearer <access_token>                 │
  │ 9. ◄── {sub, email, email_verified, name}                   │
  │                                                             │
  │ 10. ──► POST /oauth/introspect (validate token server-side) │
  └─────────────────────────────────────────────────────────────┘

  ┌─ REFRESH ───────────────────────────────────────────────────┐
  │ 11. ──► POST /oauth/token                                   │
  │         (grant_type=refresh_token + client_secret)          │
  │ 12. ◄── {access_token, refresh_token} (rotated)             │
  └─────────────────────────────────────────────────────────────┘

  ┌─ LOGOUT ────────────────────────────────────────────────────┐
  │ 13. ──► POST /oauth/revoke (refresh_token)                  │
  │ 14. ──► GET /oauth/end-session                              │
  │         ?id_token_hint=...                                  │
  │         &post_logout_redirect_uri=https://thirdparty.com    │
  │ 15. ◄── 302 redirect to post_logout_redirect_uri           │
  └─────────────────────────────────────────────────────────────┘
```

### Flow B: First-Party Web App (Direct Session Auth)

**When:** Your own web app (apps/web). Same organization, same trust boundary. User types password directly into your UI.

```
Your Web App (apps/web)                     Identity Provider
───────────────────────                     ─────────────────

  ┌─ REGISTRATION ──────────────────────────────────────────────┐
  │ 1. ──► POST /api/auth/register                              │
  │        {email, password, displayName}                       │
  │ 2. ◄── 201 {token, user}  (+ session cookie set)           │
  │ 3. User receives verification email                         │
  │ 4. ──► POST /api/auth/verify-email {token}                  │
  │ 5. ◄── 200 {message: "Email verified"}                     │
  └─────────────────────────────────────────────────────────────┘

  ┌─ LOGIN ─────────────────────────────────────────────────────┐
  │ 6. ──► POST /api/auth/login {email, password}               │
  │ 7. ◄── EITHER:                                              │
  │        200 {token, user}  (+ session cookie set)            │
  │        OR                                                    │
  │        200 {mfaRequired: true, mfaToken: "..."}             │
  │                                                             │
  │    └─ if MFA required:                                      │
  │       8. ──► POST /api/auth/mfa/verify {otp, mfaToken}     │
  │       9. ◄── 200 {token, user}  (+ session cookie set)     │
  │                                                             │
  │    └─ or passkey login (passwordless):                      │
  │       8. ──► POST /api/auth/passkeys/login/options          │
  │       9. ◄── WebAuthn challenge                              │
  │       10. ──► POST /api/auth/passkeys/login/verify          │
  │       11. ◄── 200 {token, user}  (+ session cookie set)    │
  └─────────────────────────────────────────────────────────────┘

  ┌─ AUTHENTICATED USAGE ───────────────────────────────────────┐
  │ All requests include session cookie automatically           │
  │                                                             │
  │ 12. ──► GET /api/account/profile                            │
  │ 13. ──► PATCH /api/account/profile {displayName}            │
  │ 14. ──► GET /api/account/sessions                           │
  │ 15. ──► DELETE /api/account/sessions/:id                    │
  │ 16. ──► GET /api/account/passkeys                           │
  │ 17. ──► POST /api/account/mfa/totp/enroll                  │
  │ 18. ──► POST /api/account/mfa/totp/verify {otp}            │
  └─────────────────────────────────────────────────────────────┘

  ┌─ PASSWORD MANAGEMENT ───────────────────────────────────────┐
  │ Authenticated:                                              │
  │ 19. ──► POST /api/auth/change-password                      │
  │         {currentPassword, newPassword}                      │
  │                                                             │
  │ Unauthenticated (forgot):                                   │
  │ 20. ──► POST /api/auth/forgot-password {email}              │
  │ 21. User receives reset email                               │
  │ 22. ──► POST /api/auth/reset-password {token, newPassword}  │
  └─────────────────────────────────────────────────────────────┘

  ┌─ LOGOUT ────────────────────────────────────────────────────┐
  │ 23. ──► POST /api/auth/logout                               │
  │ 24. ◄── 204 (session cookie cleared)                       │
  └─────────────────────────────────────────────────────────────┘
```

**Why no OAuth here?** Your web app IS the IdP's own UI. The user types their password directly into your form on your domain. There's no third-party to delegate to, no consent to ask for, and no scoping needed. Session cookies (httpOnly, Secure, SameSite) are the simplest and most secure approach for same-origin apps.

### Flow C: Mobile Native App (OAuth 2.1 + PAR + DPoP)

**When:** Mobile app (iOS/Android). Must use OAuth because the app binary is a public client — it cannot securely store a client_secret, and the system browser must handle authentication.

**2026 best practice:** PAR + PKCE + DPoP. This is the strongest mobile auth flow available.

```
Mobile App                                  Identity Provider
──────────                                  ─────────────────

  ┌─ LOGIN ─────────────────────────────────────────────────────┐
  │                                                             │
  │ 1. Generate:                                                │
  │    - code_verifier + code_challenge (S256)                  │
  │    - DPoP key pair (ES256)                                  │
  │    - state + nonce                                          │
  │                                                             │
  │ 2. ──► POST /oauth/par  (push params server-side)           │
  │        Authorization: Basic <client_id:>                    │
  │        {response_type, client_id, redirect_uri,             │
  │         scope, code_challenge, code_challenge_method,       │
  │         state, nonce}                                       │
  │ 3. ◄── 201 {request_uri, expires_in}                       │
  │                                                             │
  │ 4. Open SYSTEM BROWSER (not WebView):                       │
  │    ──► GET /oauth/authorize                                 │
  │        ?request_uri=urn:ietf:params:...                     │
  │        &client_id=...                                       │
  │                                                             │
  │                          5. User authenticates in browser    │
  │                             (login, MFA, passkey)            │
  │                          6. User consents (if first time)    │
  │                                                             │
  │ 7. ◄── App Link / Universal Link / Custom Scheme            │
  │        ?code=...&state=...                                  │
  │                                                             │
  │ 8. Verify state matches                                     │
  │ 9. ──► POST /oauth/token                                    │
  │        DPoP: <proof JWT>                                    │
  │        {grant_type=authorization_code,                      │
  │         code, code_verifier, client_id, redirect_uri}       │
  │ 10. ◄── {access_token, token_type:"DPoP",                  │
  │          id_token, refresh_token, scope}                    │
  └─────────────────────────────────────────────────────────────┘

  ┌─ API CALLS (with DPoP proof) ───────────────────────────────┐
  │ 11. ──► GET /oauth/userinfo                                 │
  │         Authorization: DPoP <access_token>                  │
  │         DPoP: <proof for GET /oauth/userinfo>               │
  │ 12. ◄── {sub, email, name}                                 │
  └─────────────────────────────────────────────────────────────┘

  ┌─ TOKEN REFRESH ─────────────────────────────────────────────┐
  │ 13. ──► POST /oauth/token                                   │
  │         DPoP: <proof>                                       │
  │         {grant_type=refresh_token, refresh_token, client_id}│
  │ 14. ◄── {access_token, refresh_token} (rotated)            │
  │                                                             │
  │ Note: 30-second grace period on old refresh token           │
  │ handles network race conditions on mobile                   │
  └─────────────────────────────────────────────────────────────┘

  ┌─ LOGOUT ────────────────────────────────────────────────────┐
  │ 15. ──► POST /oauth/revoke {token: refresh_token}           │
  │ 16. Clear local token storage                               │
  └─────────────────────────────────────────────────────────────┘
```

**Why PAR?** Without PAR, all auth parameters go in the browser URL — visible in logs, referrer headers, and browser history. PAR pushes them server-side first, then the browser only carries an opaque `request_uri`. This is the 2026 recommendation for mobile (RFC 9126).

**Why DPoP?** Bearer tokens can be stolen and replayed. DPoP binds each token to a cryptographic key pair on the device — even if the token leaks, it's useless without the private key. Especially important on mobile where tokens persist in app storage.

**Why system browser (not WebView)?** WebViews allow the app to intercept the password. System browsers isolate credentials from the app, and enable SSO across apps via shared browser cookies. Required by OAuth 2.0 for Native Apps (RFC 8252).

### Flow D: First-Party SPA Without Backend (OAuth 2.1 + BFF)

**When:** Single-page app with no server-side component. Cannot use direct session auth because there's no backend to hold the cookie securely.

**2026 best practice:** Use the BFF (Backend-for-Frontend) pattern — a thin proxy that holds tokens server-side.

```
Browser SPA          BFF Proxy (thin server)        Identity Provider
───────────          ──────────────────────         ─────────────────

  ┌─ LOGIN ─────────────────────────────────────────────────────┐
  │ 1. ──► GET /bff/login                                       │
  │                          2. Generate PKCE + state            │
  │                          3. ──► GET /oauth/authorize         │
  │ 4. ◄── 302 to IdP login page                               │
  │                                                             │
  │                                    5. User authenticates     │
  │                                    6. 302 → BFF callback     │
  │                                                             │
  │                          7. ──► POST /oauth/token            │
  │                                 (code + code_verifier +     │
  │                                  client_secret)             │
  │                          8. ◄── {access_token, id_token,    │
  │                                  refresh_token}             │
  │                          9. Store tokens server-side         │
  │                             Set httpOnly session cookie      │
  │ 10. ◄── 302 to app (with session cookie)                   │
  └─────────────────────────────────────────────────────────────┘

  ┌─ API CALLS ─────────────────────────────────────────────────┐
  │ 11. ──► GET /bff/api/profile                                │
  │         (session cookie, no token in browser)               │
  │                          12. ──► GET /oauth/userinfo         │
  │                                  Authorization: Bearer ...  │
  │                          13. ◄── {sub, email, name}         │
  │ 14. ◄── {sub, email, name}                                 │
  └─────────────────────────────────────────────────────────────┘
```

**Why BFF?** Tokens in browser JavaScript are vulnerable to XSS. The BFF keeps tokens server-side behind httpOnly cookies — the browser never sees or stores access/refresh tokens. This is the OAuth 2.0 for Browser-Based Applications recommendation (draft-ietf-oauth-browser-based-apps, 2024-2026).

**Note:** This IdP does not include a BFF proxy — that's the responsibility of the SPA's own infrastructure. The IdP provides all the OAuth endpoints the BFF needs.

### Flow E: Admin Dashboard

**When:** Your admin panel (apps/admin). First-party, same trust boundary as the IdP.

```
Admin Dashboard (apps/admin)                Identity Provider
────────────────────────────                ─────────────────

  ┌─ LOGIN ─────────────────────────────────────────────────────┐
  │ 1. ──► POST /api/auth/login {email, password}               │
  │ 2. ◄── 200 {token, user} (+ admin_session cookie)          │
  │    └─ if mfaRequired:                                       │
  │       3. ──► POST /api/auth/mfa/verify {otp, mfaToken}     │
  │       4. ◄── 200 {token, user} (+ admin_session cookie)    │
  └─────────────────────────────────────────────────────────────┘

  ┌─ CLIENT MANAGEMENT ────────────────────────────────────────┐
  │ 5.  ──► POST /api/admin/clients                             │
  │         {clientName, redirectUris, grantTypes, scope, ...}  │
  │ 6.  ──► GET /api/admin/clients                              │
  │ 7.  ──► GET /api/admin/clients/:id                          │
  │ 8.  ──► PATCH /api/admin/clients/:id                        │
  │ 9.  ──► DELETE /api/admin/clients/:id                       │
  │ 10. ──► POST /api/admin/clients/:id/rotate-secret           │
  └─────────────────────────────────────────────────────────────┘

  ┌─ USER POOL MANAGEMENT ─────────────────────────────────────┐
  │ 11. ──► GET /api/admin/users (?skip, ?take)                 │
  │ 12. ──► GET /api/admin/users/:id                            │
  │ 13. ──► PATCH /api/admin/users/:id/status                   │
  │         {status: "active" | "suspended"}                    │
  └─────────────────────────────────────────────────────────────┘

  ┌─ RBAC ──────────────────────────────────────────────────────┐
  │ 14. ──► POST /api/admin/roles {name}                        │
  │ 15. ──► GET /api/admin/roles                                │
  │ 16. ──► PUT /api/admin/roles/:id/permissions {permissionIds}│
  │ 17. ──► POST /api/admin/users/:id/roles {roleId}           │
  │ 18. ──► DELETE /api/admin/users/:id/roles/:roleId          │
  └─────────────────────────────────────────────────────────────┘

  ┌─ SESSION OVERSIGHT ────────────────────────────────────────┐
  │ 19. ──► GET /api/admin/sessions (?skip, ?take)              │
  │ 20. ──► DELETE /api/admin/sessions/:id                      │
  │ 21. ──► DELETE /api/admin/users/:id/sessions (bulk revoke)  │
  └─────────────────────────────────────────────────────────────┘

  ┌─ AUDIT & COMPLIANCE ───────────────────────────────────────┐
  │ 22. ──► GET /api/admin/audit-logs                           │
  │         (?action, ?userId, ?resourceType, ?skip, ?take)     │
  │ 23. ──► GET /api/admin/audit-logs/verify                    │
  │ 24. ──► GET /api/admin/audit-logs/export (?from, ?to)       │
  └─────────────────────────────────────────────────────────────┘

  ┌─ LOGOUT ────────────────────────────────────────────────────┐
  │ 25. ──► POST /api/auth/logout                               │
  │ 26. ◄── 204 (admin_session cookie cleared)                 │
  └─────────────────────────────────────────────────────────────┘
```

### Flow F: Service-to-Service (Client Credentials)

**When:** Backend services that need to call your API without a user context (e.g., cron jobs, microservices, data pipelines).

```
Backend Service                             Identity Provider
───────────────                             ─────────────────

  1. ──► POST /oauth/token
         Authorization: Basic <client_id:client_secret>
         {grant_type=client_credentials, scope=...}
  2. ◄── {access_token, token_type:"Bearer", expires_in, scope}

  3. ──► Call protected APIs with:
         Authorization: Bearer <access_token>

  4. Token expired? → repeat from step 1
     (no refresh tokens issued for client_credentials)
```

---

## 5. Gaps and Missing APIs

### High Priority (Standard Requirements)

| # | Feature | Spec | Impact | Effort |
|---|---------|------|--------|--------|
| 1 | **`prompt` parameter on `/oauth/authorize`** | OIDC Core §3.1.2.1 | Mobile/SPA apps cannot do silent auth check (`prompt=none`) or force re-login (`prompt=login`). Critical for session management in native apps. | Medium |
| 2 | **`max_age` parameter on `/oauth/authorize`** | OIDC Core §3.1.2.1 | Cannot request re-authentication if session exceeds age threshold. Required for high-security flows. | Low |
| 3 | **`auth_time` claim in ID token** | OIDC Core §2 | Required when `max_age` is requested or `auth_time` is an essential claim. Must reflect actual authentication timestamp. | Low |

### Medium Priority (2026 Best Practice)

| # | Feature | Spec | Impact | Effort |
|---|---------|------|--------|--------|
| 4 | **`/.well-known/oauth-authorization-server`** | RFC 8414 | OAuth 2.0 AS metadata endpoint. Some OAuth-only clients look here instead of OIDC discovery. Can be an alias of openid-configuration. | Low |
| 5 | **`login_hint` parameter** | OIDC Core §3.1.2.1 | Pre-fill email on authorize page. UX improvement for mobile and returning users. | Low |
| 6 | **`acr_values` parameter** | OIDC Core §3.1.2.1 | Request specific authentication assurance levels (e.g., require MFA). Useful for step-up auth. | Medium |
| 7 | **OIDC Back-Channel Logout** | OIDC Back-Channel Logout 1.0 | Notify relying parties server-to-server when user logs out. Current `end-session` only handles RP-initiated direction. | Medium |
| 8 | **Token Exchange** | RFC 8693 | Service-to-service token exchange, impersonation, delegation. Needed for microservices or act-as flows. | High |

### Low Priority (Nice-to-Have)

| # | Feature | Spec | Notes |
|---|---------|------|-------|
| 9 | Device Authorization Grant | RFC 8628 | For CLI tools, smart TVs, IoT. Only if these are in ecosystem. |
| 10 | OIDC Front-Channel Logout | OIDC Front-Channel Logout 1.0 | Alternative to back-channel. Less reliable. |
| 11 | `claims` request parameter | OIDC Core §5.5 | Request specific claims. Rarely used by RPs. |
| 12 | Pairwise subject identifiers | OIDC Core §8 | Privacy feature — different `sub` per client. |
| 13 | Dynamic Client Registration | RFC 7591 / 7592 | Only needed for open IdPs. Admin API covers closed ecosystem. |

---

## 6. Redundant APIs

### R-1: `GET /api/users/:id` — Unnecessary and Insecure

**Severity: HIGH**

| Aspect | Detail |
|--------|--------|
| Endpoint | `GET /api/users/:id` |
| Problem | Any authenticated user can query any other user's profile by ID |
| Overlaps with | `GET /api/account/profile` (own profile) and `GET /api/admin/users/:id` (admin) |
| Security risk | Information disclosure — exposes user data (email, displayName, status) to any logged-in user |
| Standard practice | IdPs do not expose arbitrary user lookup to regular users |

**Recommendation:** **Remove entirely.** Self-service profile is handled by `/api/account/profile`. Admin user lookup is handled by `/api/admin/users/:id` with proper RBAC. There is no standard use case for "any user can look up any other user by ID" in an IdP.

---

### R-2: `POST /api/auth/logout` vs `GET /oauth/end-session` — Partial Overlap

**Severity: LOW (both should be kept)**

| Aspect | `/api/auth/logout` | `/oauth/end-session` |
|--------|-------------------|---------------------|
| Auth model | Session cookie | Bearer/session token |
| Behavior | Revokes session, clears cookie, emits event | Revokes session, redirects to RP |
| Response | 204 No Content | 302 Redirect |
| Use case | First-party web app (cookie-based) | OAuth/OIDC relying parties |
| Standard | Custom (first-party) | OIDC RP-Initiated Logout 1.0 |

**Recommendation:** **Keep both.** They serve different protocols. First-party apps use session cookies and expect 204. OAuth RPs expect redirect-based logout per OIDC spec. Consider having `/api/auth/logout` delegate to the same session-revocation logic internally (DRY).

---

### R-3: `GET /api/account/profile` vs `GET /oauth/userinfo` — Complementary, Not Redundant

**Severity: NONE (both required)**

| Aspect | `/api/account/profile` | `/oauth/userinfo` |
|--------|----------------------|-------------------|
| Auth model | Session cookie | OAuth access token (Bearer/DPoP) |
| Fields returned | All profile fields | Scope-filtered (sub, email, name) |
| DPoP support | No | Yes |
| Use case | First-party web/mobile backend | Third-party OAuth clients |
| Standard | Custom (first-party) | OIDC Core §5.3 (mandatory) |

**Recommendation:** **Keep both.** `/oauth/userinfo` is mandatory per OIDC Core. `/api/account/profile` serves first-party apps that use session auth and need full profile data (metadata, timestamps) not exposed via OAuth scopes.

---

### R-4: `POST /oauth/revoke` vs `DELETE /api/account/sessions/:id` — Different Targets

**Severity: NONE (both required)**

| Aspect | `/oauth/revoke` | `DELETE /api/account/sessions/:id` |
|--------|----------------|-----------------------------------|
| Target | OAuth refresh tokens | Session records |
| Auth | Client credentials | User session |
| Use case | OAuth token lifecycle | User session management |
| Standard | RFC 7009 (mandatory) | Custom (first-party) |

**Recommendation:** **Keep both.** Sessions and OAuth refresh tokens are separate constructs. Revoking a refresh token does not end a session, and vice versa.

---

### Redundancy Summary

| ID | Endpoint | Verdict | Action |
|----|----------|---------|--------|
| R-1 | `GET /api/users/:id` | **Redundant + insecure** | **Remove** |
| R-2 | `POST /api/auth/logout` vs `GET /oauth/end-session` | Partial overlap, both needed | Keep both, share internal logic |
| R-3 | `GET /api/account/profile` vs `GET /oauth/userinfo` | Complementary | Keep both |
| R-4 | `POST /oauth/revoke` vs `DELETE /api/account/sessions/:id` | Different targets | Keep both |

---

## 7. Summary Verdict

| User Base | Coverage | Verdict |
|-----------|----------|---------|
| Web App (third-party OAuth) | **95%** | Production-ready. Add `prompt` parameter for completeness. |
| Web App (first-party UI) | **100%** | Fully covered: auth, MFA, passkeys, password reset, account self-service. |
| Mobile Native App | **90%** | Strong with PAR + PKCE + DPoP. Add `prompt=none` for silent auth check. |
| Admin Dashboard | **100%** | Complete client, user, role, session, and audit management. |
| OAuth 2.1 Compliance | **95%** | PKCE mandatory, no implicit grant, refresh rotation, DPoP. |
| OIDC Core Compliance | **85%** | Discovery, ID tokens, userinfo present. Missing `prompt`, `max_age`, `auth_time`. |

### Top Actions (Priority Order)

1. **Remove** `GET /api/users/:id` — redundant and insecure (R-1)
2. **Add** `prompt` parameter to `/oauth/authorize` — `none`, `login`, `consent` (OIDC Core)
3. **Add** `max_age` parameter + `auth_time` claim in ID tokens (OIDC Core)
4. **Add** `/.well-known/oauth-authorization-server` metadata endpoint (RFC 8414)
5. **Add** `login_hint` parameter for UX improvement on authorize
