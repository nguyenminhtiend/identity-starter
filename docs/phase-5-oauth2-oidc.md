# Identity Starter — Phase 5: OAuth2 / OpenID Connect

**Status: NOT STARTED**

## Overview

Implement an OAuth 2.0 Authorization Server with OpenID Connect support. This is the core IdP functionality — client registration, authorization flows, token issuance, and consent management.

---

## Scope

### New Modules
- **Client module** — OAuth2 client registration and management (admin-created only)
- **OAuth module** — Authorization server: authorization endpoint, token endpoint, consent
- **Token module** — JWT issuance, refresh tokens, JWKS key management

### New DB Tables
- `oauth_clients` — Client registration
- `authorization_codes` — Short-lived auth codes
- `refresh_tokens` — Refresh token storage
- `consent_grants` — User consent records

### Key Libraries
- `jose` — JWT signing/verification, JWKS generation (needs to be installed)

### Explicitly Deferred
- Dynamic client registration (RFC 7591) → out of scope
- CIBA (Client-Initiated Backchannel Authentication) → future enhancement
- Consent UI → Phase 7

---

## Architecture Decisions

### Module Responsibility Split
- **Client module** — CRUD for OAuth clients. Admin-created only. Owns `oauth_clients` table.
- **OAuth module** — Orchestrates authorization flows. Owns `authorization_codes` and `consent_grants`. Depends on Client, Token, User, and Session modules.
- **Token module** — Stateless JWT issuance (access + ID tokens) and stateful refresh token management. Owns `refresh_tokens` and JWKS key pair rotation.

### Why Separate Token Module?
1. Token validation used by resource servers (not just auth server)
2. JWKS key management is a standalone concern (rotation, multiple keys)
3. Other phases (Admin API) need token introspection without pulling in OAuth flow logic

### Client Authentication Methods
Supported:
- `client_secret_basic` — HTTP Basic auth with clientId:clientSecret
- `client_secret_post` — clientId and clientSecret in request body

Not supported (keep scope manageable):
- `private_key_jwt`, `client_secret_jwt`, `none` (public clients use PKCE instead)

### PKCE Required for Authorization Code Flow
- All authorization code grants require PKCE (RFC 7636)
- `S256` challenge method only (plain is insecure)
- Simplifies security model — no need for client_secret for public clients

---

## Features

### OAuth2 Flows
- **Authorization Code flow with PKCE** — authorize → consent → code → token exchange
- **Client Credentials flow** — Machine-to-machine authentication
- **Refresh Token flow** — Exchange refresh token for new access + refresh tokens
- **Token revocation** — Revoke refresh tokens (RFC 7009)
- **DPoP (RFC 9449)** — Sender-constrained access tokens via proof-of-possession. Clients include a DPoP proof JWT; tokens are bound to the client's key pair
- **PAR (RFC 9126)** — Pushed Authorization Requests. Clients POST authorization parameters to `/oauth/par` and receive a `request_uri` to use at the authorization endpoint. Prevents request tampering and reduces front-channel data leakage

### OpenID Connect
- **ID Token issuance** — JWT with standard claims (`sub`, `iss`, `aud`, `exp`, `iat`, `nonce`, `auth_time`, `acr`, `amr`, `at_hash`, `sid`)
- **UserInfo endpoint** — Returns user profile claims based on granted scopes
- **Discovery endpoint** — `/.well-known/openid-configuration`
- **JWKS endpoint** — `/.well-known/jwks.json`
- **Token introspection** — `POST /oauth/introspect` (RFC 7662) for resource server token validation
- **RP-Initiated Logout** — `GET /oauth/end-session` (OIDC RP-Initiated Logout 1.0) with `id_token_hint` and `post_logout_redirect_uri`
- **`acr` / `amr` claims** — Authentication Context Class (`urn:identity-starter:acr:aal1`, `urn:identity-starter:acr:aal2`) and Authentication Methods References (`pwd`, `hwk`, `otp`)
- **`iss` in authorization response** — RFC 9207 authorization response issuer parameter to prevent mix-up attacks

### Client Management
- Client CRUD (admin-only, no public registration)
- Client secret generation and rotation (secrets hashed with Argon2)
- Redirect URI validation (exact match, no wildcards)
- Scope management per client (allowed scopes whitelist)
- Grant type restrictions per client

### Consent Management
- Record user consent per client + scopes
- Skip consent on repeat authorizations (if previously granted)
- Consent revocation

### OIDC Scopes

| Scope | Claims Returned |
|-------|----------------|
| `openid` | sub |
| `profile` | displayName |
| `email` | email, emailVerified |

---

## DB Schema

### oauth_clients

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `client_id` | `text` | UNIQUE, INDEXED, NOT NULL | — |
| `client_secret_hash` | `text` | NOT NULL | — |
| `client_name` | `varchar(255)` | NOT NULL | — |
| `description` | `text` | NULLABLE | — |
| `redirect_uris` | `text[]` | NOT NULL | — |
| `grant_types` | `text[]` | NOT NULL | — |
| `response_types` | `text[]` | NOT NULL | — |
| `scope` | `text` | NOT NULL | — |
| `token_endpoint_auth_method` | `text` | NOT NULL | — |
| `is_confidential` | `boolean` | NOT NULL | — |
| `logo_uri` | `text` | NULLABLE | — |
| `tos_uri` | `text` | NULLABLE | — |
| `policy_uri` | `text` | NULLABLE | — |
| `application_type` | `text` | NOT NULL | `'web'` |
| `status` | `text` | NOT NULL | `'active'` |
| `created_at` | `timestamp` | NOT NULL | `now()` |
| `updated_at` | `timestamp` | NOT NULL | `now()` |

### authorization_codes

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `code` | `text` | UNIQUE, INDEXED, NOT NULL | — |
| `client_id` | `uuid` | FK → `oauth_clients.id`, NOT NULL | — |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL | — |
| `redirect_uri` | `text` | NOT NULL | — |
| `scope` | `text` | NOT NULL | — |
| `code_challenge` | `text` | NOT NULL | — |
| `code_challenge_method` | `text` | NOT NULL | `'S256'` |
| `nonce` | `text` | NULLABLE | — |
| `state` | `text` | NULLABLE | — |
| `expires_at` | `timestamp` | NOT NULL | — |
| `used_at` | `timestamp` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

### refresh_tokens

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `token` | `text` | UNIQUE, INDEXED, NOT NULL | — |
| `client_id` | `uuid` | FK → `oauth_clients.id`, NOT NULL | — |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL | — |
| `scope` | `text` | NOT NULL | — |
| `expires_at` | `timestamp` | NOT NULL | — |
| `revoked_at` | `timestamp` | NULLABLE | — |
| `family_id` | `uuid` | NOT NULL | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

### consent_grants

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL | — |
| `client_id` | `uuid` | FK → `oauth_clients.id`, NOT NULL | — |
| `scope` | `text` | NOT NULL | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |
| `revoked_at` | `timestamp` | NULLABLE | — |

---

## API Routes

### Client Routes (`/api/admin/clients/*` — Admin-Only)

> **Bridge auth**: Until Phase 6 adds proper RBAC, client routes are protected with session + admin flag check.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/clients` | Admin | Create OAuth client |
| GET | `/api/admin/clients` | Admin | List OAuth clients |
| GET | `/api/admin/clients/:id` | Admin | Get client details |
| PATCH | `/api/admin/clients/:id` | Admin | Update client |
| DELETE | `/api/admin/clients/:id` | Admin | Delete client |
| POST | `/api/admin/clients/:id/rotate-secret` | Admin | Rotate client secret |

### OAuth Routes (`/oauth/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/oauth/authorize` | Session | Authorization endpoint — initiates auth code flow |
| POST | `/oauth/token` | Client auth | Token endpoint — code/refresh → tokens |
| POST | `/oauth/revoke` | Client auth | Revoke a refresh token |
| GET | `/oauth/userinfo` | Bearer token | OIDC UserInfo endpoint |
| POST | `/oauth/consent` | Session | Submit consent decision |
| DELETE | `/oauth/consent/:clientId` | Session | Revoke consent for a client |
| POST | `/oauth/introspect` | Client auth | Token introspection (RFC 7662) |
| POST | `/oauth/par` | Client auth | Pushed Authorization Request (RFC 9126) |
| GET | `/oauth/end-session` | Public | RP-Initiated Logout |

### Discovery Routes (Public)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/.well-known/openid-configuration` | Public | OIDC discovery metadata |
| GET | `/.well-known/jwks.json` | Public | JSON Web Key Set |

---

## Events

### Client Events
- `client.created`, `client.updated`, `client.deleted`, `client.secret_rotated`

### OAuth Events
- `oauth.authorization_code_issued`, `oauth.token_exchanged`
- `oauth.consent_granted`, `oauth.consent_revoked`

### Token Events
- `token.access_issued`, `token.refresh_issued`, `token.refresh_revoked`

---

## Security Considerations

- **Client secrets** hashed with Argon2 — never stored plaintext
- **Authorization codes** have 10-minute TTL, single-use (`used_at` on exchange)
- **PKCE mandatory** — prevents code interception attacks (S256 only)
- **DPoP (RFC 9449)** — sender-constrained access tokens. DPoP proof validated on token endpoint and resource servers. Prevents token theft/replay
- **PAR (RFC 9126)** — authorization parameters sent via back-channel POST. Prevents front-channel tampering and leakage of sensitive parameters
- **Redirect URI validation** — exact string matching, no wildcards. `application_type: 'native'` allows `http://localhost:*` and custom schemes
- **Refresh token rotation** — old token revoked on each refresh, `family_id` for replay detection. Entire family revoked on reuse of a consumed token
- **JWKS key rotation** — multiple active keys, phased rollover. Previous key retained for grace period
- **`iss` parameter** — RFC 9207 issuer in authorization response prevents mix-up attacks
- **CORS policy** — `/oauth/token`, `/oauth/introspect`, `/oauth/revoke` allow cross-origin requests with `Access-Control-Allow-Origin` restricted to registered redirect URI origins. Discovery and JWKS endpoints allow `*`
- **Token endpoint rate limiting** — per-client rate limiting on token exchange to prevent brute-force

---

## Cross-Module Dependencies

- **Client module** → standalone (no module dependencies)
- **OAuth module** → Client, Token, User, Session modules
- **Token module** → `@identity-starter/db` (refresh_tokens table), `jose`

---

## Testing Strategy

### Unit Tests
- **Client service**: CRUD + secret rotation + redirect URI validation
- **OAuth service**: authorization flow logic, consent management, PKCE validation
- **Token service**: JWT issuance/verification, refresh token rotation

### Integration Tests
- End-to-end authorization code flow (authorize → consent → code → token → userinfo)
- Refresh token rotation flow
- Client credentials flow
- Token revocation
- PKCE validation (correct/incorrect verifier)
- Discovery endpoints return correct metadata
- DPoP flow: token request with DPoP proof → bound access token → introspection confirms binding
- PAR flow: push authorization request → receive request_uri → authorize with request_uri
- Token introspection: active token → introspect returns claims; revoked token → returns inactive
- RP-Initiated Logout: end-session with id_token_hint → session destroyed → redirect to post_logout_redirect_uri
- `acr`/`amr` claims in ID token reflect actual authentication method

---

## Prerequisites

- Phase 2 complete (session module + auth module)
- Phase 3 complete (passkey module — for WebAuthn-authenticated authorization)
- Phase 4 complete (account module + email verification)
- `jose` needs to be installed
