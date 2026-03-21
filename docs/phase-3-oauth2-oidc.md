# Identity Starter — Phase 3: OAuth2/OIDC

**Status: NOT STARTED**

## Overview

Implement an OAuth 2.0 Authorization Server with OpenID Connect support. This is the core IdP functionality — client registration, authorization flows, token issuance, and a consent UI.

---

## Scope

### New Modules
- **Client module** — OAuth2 client registration and management (admin-created only)
- **OAuth module** — Authorization server: authorization endpoint, token endpoint, authorization code flow
- **Token module** — JWT issuance, refresh tokens, JWKS key management

### New DB Tables
- `oauth_clients` — Client registration
- `authorization_codes` — Short-lived auth codes
- `refresh_tokens` — Refresh token storage
- `consent_grants` — User consent records

### UI Additions (in `apps/web/`)
- Consent page — shows requested scopes, allow/deny
- Authorization page — client info display during auth flow

### Key Libraries
- `jose` — JWT signing/verification, JWKS generation (already a dependency)
- `nanoid` — Client ID and secret generation (already a dependency)

---

## Architecture Decisions

### Module Responsibility Split
- **Client module** — CRUD for OAuth clients. Clients are admin-created only (no RFC 7591 dynamic registration). Owns the `oauth_clients` table.
- **OAuth module** — Orchestrates the authorization flows. Owns `authorization_codes` and `consent_grants` tables. Depends on Client, Token, User, and Session modules.
- **Token module** — Stateless JWT issuance (access tokens, ID tokens) and stateful refresh token management. Owns `refresh_tokens` table and JWKS key pair rotation.

### Why Separate Token Module?
1. Token validation will be used by resource servers (not just the auth server)
2. JWKS key management is a standalone concern (key rotation, multiple keys)
3. Other phases (Admin API) need token introspection without pulling in OAuth flow logic

### Client Authentication Methods
Supported:
- `client_secret_basic` — HTTP Basic auth with clientId:clientSecret
- `client_secret_post` — clientId and clientSecret in request body

Not supported (keep scope manageable):
- `private_key_jwt`, `client_secret_jwt`, `none` (public clients use PKCE instead)

### PKCE Required for Authorization Code Flow
- All authorization code grants require PKCE (RFC 7636)
- Supports `S256` challenge method only (plain is insecure)
- This simplifies security model — no need for client_secret for public clients

---

## Features

### OAuth2 Flows
- **Authorization Code flow with PKCE** — Full flow: authorize → consent → code → token exchange
- **Client Credentials flow** — Machine-to-machine authentication
- **Refresh Token flow** — Exchange refresh token for new access + refresh tokens
- **Token revocation** — Revoke refresh tokens (RFC 7009)

### OpenID Connect
- **ID Token issuance** — JWT with standard claims (sub, iss, aud, exp, iat, nonce)
- **UserInfo endpoint** — Returns user profile claims based on granted scopes
- **Discovery endpoint** — `/.well-known/openid-configuration` — auto-discovery metadata
- **JWKS endpoint** — `/.well-known/jwks.json` — public keys for token verification

### Client Management
- Client CRUD (admin-only, no public registration)
- Client secret generation and rotation
- Redirect URI validation (exact match, no wildcards)
- Scope management per client (allowed scopes whitelist)
- Grant type restrictions per client

### Consent
- Consent page showing client name, requested scopes with descriptions
- Remember consent option (skip consent on repeat authorizations)
- Consent revocation (user can revoke previously granted consent)

---

## DB Schema

### oauth_clients
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | nanoid (internal) |
| clientId | text | unique, indexed — public client identifier |
| clientSecretHash | text | hashed (never store plaintext) |
| name | text | display name for consent screen |
| description | text | nullable |
| redirectUris | text[] | allowed redirect URIs (exact match) |
| grantTypes | text[] | e.g., authorization_code, client_credentials, refresh_token |
| scopes | text[] | allowed scopes for this client |
| tokenEndpointAuthMethod | text | 'client_secret_basic' / 'client_secret_post' |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### authorization_codes
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | nanoid |
| code | text | unique, indexed |
| clientId | text FK | → oauth_clients.clientId |
| userId | text FK | → users.id |
| redirectUri | text | must match on token exchange |
| scopes | text[] | granted scopes |
| codeChallenge | text | PKCE code challenge |
| codeChallengeMethod | text | 'S256' |
| nonce | text | nullable — OIDC nonce |
| expiresAt | timestamp | short TTL (10 minutes) |
| usedAt | timestamp | nullable — mark as used to prevent replay |
| createdAt | timestamp | |

### refresh_tokens
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | nanoid |
| token | text | unique, indexed — opaque token |
| clientId | text FK | → oauth_clients.clientId |
| userId | text FK | → users.id |
| scopes | text[] | granted scopes |
| expiresAt | timestamp | long TTL (30 days) |
| revokedAt | timestamp | nullable — soft revoke |
| createdAt | timestamp | |

### consent_grants
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | nanoid |
| userId | text FK | → users.id |
| clientId | text FK | → oauth_clients.clientId |
| scopes | text[] | consented scopes |
| grantedAt | timestamp | |
| revokedAt | timestamp | nullable — soft revoke |

---

## OpenID Connect Scopes

| Scope | Claims Returned |
|-------|----------------|
| `openid` | sub |
| `profile` | displayName |
| `email` | email, emailVerified |

---

## API Routes

### Client Routes (`/api/admin/clients/*` — Admin-Only)

> **Bridge auth**: Until Phase 4 adds proper RBAC, client routes are protected with a session + admin flag check.

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
| POST | `/oauth/token` | Client auth | Token endpoint — exchanges code/refresh for tokens |
| POST | `/oauth/revoke` | Client auth | Revoke a refresh token |
| GET | `/oauth/userinfo` | Bearer token | OpenID Connect UserInfo endpoint |
| POST | `/oauth/consent` | Session | Submit consent decision |
| DELETE | `/oauth/consent/:clientId` | Session | Revoke consent for a client |

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

## Cross-Module Dependencies

- **Client module** → standalone (no module dependencies)
- **OAuth module** → Client module, Token module, User module, Session module
- **Token module** → packages/db (refresh_tokens table), jose (JWT signing/verification)

---

## Security Considerations

- **Client secrets** are hashed (Argon2) before storage — never stored in plaintext
- **Authorization codes** have a 10-minute TTL and are single-use (marked as `usedAt` on exchange)
- **PKCE is mandatory** for authorization code flow — prevents code interception attacks
- **Redirect URI validation** uses exact string matching — no wildcards or pattern matching
- **Refresh token rotation** — on each refresh, old token is revoked and new one is issued
- **JWKS key rotation** — support for multiple active keys, phased rollover

---

## Testing Strategy

### Unit Tests
- **Client service**: Mock repository, test CRUD + secret rotation + redirect URI validation
- **OAuth service**: Mock client/token/user services, test authorization flow logic, consent management
- **Token service**: Mock repository, test JWT issuance/verification, refresh token rotation

### Route Tests
- Full Fastify request/response for all endpoints
- Test OAuth error responses (RFC 6749 error format)
- Test PKCE validation, redirect URI matching

### Integration Tests
- End-to-end authorization code flow (authorize → consent → code → token exchange → userinfo)
- Refresh token rotation flow
- Client credentials flow
- Token revocation

---

## Prerequisites

- Phase 1 complete ✅
- Phase 2 complete (authentication + sessions required for authorization flows)
- Running PostgreSQL instance
- Running Redis instance
