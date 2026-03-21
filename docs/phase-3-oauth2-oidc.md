# Identity Starter — Phase 3: OAuth2/OIDC

**Status: NOT STARTED**

## Overview

Implement an OAuth 2.0 Authorization Server with OpenID Connect support. This is the core IdP functionality — client registration, authorization flows, token issuance, and a consent UI.

---

## Scope

### New Modules
- **Client module** (`apps/server/src/modules/client/`) — OAuth2 client registration and management (admin-created only)
- **OAuth module** (`apps/server/src/modules/oauth/`) — Authorization server: authorization endpoint, token endpoint, authorization code flow
- **Token module** (`apps/server/src/modules/token/`) — JWT issuance, refresh tokens, JWKS key management

### New DB Tables
- `oauth_clients` — Client registration (id, clientId, clientSecret, name, redirectUris, grantTypes, scopes, tokenEndpointAuthMethod, createdAt, updatedAt)
- `authorization_codes` — Short-lived auth codes (code, clientId, userId, redirectUri, scopes, codeChallenge, codeChallengeMethod, expiresAt, createdAt)
- `refresh_tokens` — Refresh token storage (id, token, clientId, userId, scopes, expiresAt, revokedAt, createdAt)
- `consent_grants` — User consent records (id, userId, clientId, scopes, grantedAt, revokedAt)

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
The token module is split from OAuth because:
1. Token validation will be used by resource servers (not just the auth server)
2. JWKS key management is a standalone concern (key rotation, multiple keys)
3. Other phases (Admin API) need token introspection without pulling in OAuth flow logic

### Client Authentication Methods
Supported:
- `client_secret_basic` — HTTP Basic auth with clientId:clientSecret
- `client_secret_post` — clientId and clientSecret in request body

Not supported (keep scope manageable):
- `private_key_jwt`
- `client_secret_jwt`
- `none` (public clients use PKCE instead)

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

## Module File Structure

### Client Module
```
apps/server/src/modules/client/
├── client.schemas.ts       # Zod: createClient, updateClient, clientIdParam
├── client.types.ts         # OAuthClient type, ClientAuthentication
├── client.repository.ts    # DB CRUD for oauth_clients
├── client.service.ts       # create(), findById(), findByClientId(), update(), delete(), rotateSecret(), validateRedirectUri()
├── client.routes.ts        # CRUD routes (admin-only)
├── client.events.ts        # ClientEvents type
├── index.ts                # Public API barrel
└── __tests__/
    ├── client.service.test.ts
    └── client.routes.test.ts
```

### OAuth Module
```
apps/server/src/modules/oauth/
├── oauth.schemas.ts        # Zod: authorizeQuery, tokenRequest, consentInput
├── oauth.types.ts          # AuthorizationRequest, TokenResponse, ConsentGrant
├── oauth.repository.ts     # DB: authorization_codes, consent_grants
├── oauth.service.ts        # authorize(), token(), consent(), revokeConsent()
├── oauth.routes.ts         # GET /authorize, POST /token, POST /consent, GET /userinfo
├── oauth.events.ts         # OAuthEvents type
├── oauth.errors.ts         # OAuthError with error codes (invalid_request, unauthorized_client, etc.)
├── index.ts                # Public API barrel
└── __tests__/
    ├── oauth.service.test.ts
    ├── oauth.routes.test.ts
    └── oauth.flows.test.ts  # End-to-end flow tests
```

### Token Module
```
apps/server/src/modules/token/
├── token.schemas.ts        # Zod: tokenRequest, introspectRequest
├── token.types.ts          # AccessToken, IdToken, RefreshToken types
├── token.repository.ts     # DB: refresh_tokens CRUD
├── token.service.ts        # issueAccessToken(), issueIdToken(), issueRefreshToken(), verify(), revoke()
├── token.jwks.ts           # JWKS key pair management (generate, rotate, serve)
├── token.routes.ts         # /.well-known/jwks.json, /.well-known/openid-configuration
├── token.events.ts         # TokenEvents type
├── index.ts                # Public API barrel
└── __tests__/
    ├── token.service.test.ts
    └── token.jwks.test.ts
```

### DB Schema Additions
```
packages/db/src/schema/
├── user.ts                 # (existing)
├── session.ts              # (Phase 2)
├── passkey.ts              # (Phase 2)
├── oauth-client.ts         # oauth_clients table
├── authorization-code.ts   # authorization_codes table
├── refresh-token.ts        # refresh_tokens table
├── consent-grant.ts        # consent_grants table
└── index.ts                # Updated barrel export
```

---

## API Routes

### Client Routes (Admin-Only)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/clients` | Admin | Create OAuth client |
| GET | `/api/clients` | Admin | List OAuth clients |
| GET | `/api/clients/:id` | Admin | Get client details |
| PATCH | `/api/clients/:id` | Admin | Update client |
| DELETE | `/api/clients/:id` | Admin | Delete client |
| POST | `/api/clients/:id/rotate-secret` | Admin | Rotate client secret |

### OAuth Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/oauth/authorize` | Session | Authorization endpoint — initiates auth code flow |
| POST | `/api/oauth/token` | Client auth | Token endpoint — exchanges code/refresh for tokens |
| POST | `/api/oauth/revoke` | Client auth | Revoke a refresh token |
| GET | `/api/oauth/userinfo` | Bearer token | OpenID Connect UserInfo endpoint |
| POST | `/api/oauth/consent` | Session | Submit consent decision |
| DELETE | `/api/oauth/consent/:clientId` | Session | Revoke consent for a client |

### Discovery Routes (Public)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/.well-known/openid-configuration` | Public | OIDC discovery metadata |
| GET | `/.well-known/jwks.json` | Public | JSON Web Key Set |

---

## Events

```typescript
type ClientEvents = {
  'client.created': { clientId: string }
  'client.updated': { clientId: string }
  'client.deleted': { clientId: string }
  'client.secret_rotated': { clientId: string }
}

type OAuthEvents = {
  'oauth.authorization_code_issued': { clientId: string; userId: string; scopes: string[] }
  'oauth.token_exchanged': { clientId: string; userId: string; grantType: string }
  'oauth.consent_granted': { clientId: string; userId: string; scopes: string[] }
  'oauth.consent_revoked': { clientId: string; userId: string }
}

type TokenEvents = {
  'token.access_issued': { clientId: string; userId: string }
  'token.refresh_issued': { clientId: string; userId: string }
  'token.refresh_revoked': { clientId: string; tokenId: string }
}
```

---

## DB Schema Design

### oauth_clients
```typescript
{
  id: string                    // nanoid (internal)
  clientId: string              // unique, indexed — public client identifier
  clientSecretHash: string      // hashed client secret (never store plaintext)
  name: string                  // display name for consent screen
  description: string | null    // client description
  redirectUris: string[]        // allowed redirect URIs (exact match)
  grantTypes: string[]          // ['authorization_code', 'client_credentials', 'refresh_token']
  scopes: string[]              // allowed scopes for this client
  tokenEndpointAuthMethod: string // 'client_secret_basic' | 'client_secret_post'
  createdAt: Date
  updatedAt: Date
}
```

### authorization_codes
```typescript
{
  id: string                    // nanoid
  code: string                  // unique, indexed — the authorization code
  clientId: string              // FK → oauth_clients.clientId
  userId: string                // FK → users.id
  redirectUri: string           // must match on token exchange
  scopes: string[]              // granted scopes
  codeChallenge: string         // PKCE code challenge
  codeChallengeMethod: string   // 'S256'
  nonce: string | null          // OIDC nonce
  expiresAt: Date               // short TTL (10 minutes)
  usedAt: Date | null           // mark as used to prevent replay
  createdAt: Date
}
```

### refresh_tokens
```typescript
{
  id: string                    // nanoid
  token: string                 // unique, indexed — opaque token
  clientId: string              // FK → oauth_clients.clientId
  userId: string                // FK → users.id
  scopes: string[]              // granted scopes
  expiresAt: Date               // long TTL (30 days)
  revokedAt: Date | null        // soft revoke
  createdAt: Date
}
```

### consent_grants
```typescript
{
  id: string                    // nanoid
  userId: string                // FK → users.id
  clientId: string              // FK → oauth_clients.clientId
  scopes: string[]              // consented scopes
  grantedAt: Date
  revokedAt: Date | null        // soft revoke
}
```

---

## OpenID Connect Scopes

| Scope | Claims Returned |
|-------|----------------|
| `openid` | sub |
| `profile` | displayName |
| `email` | email, emailVerified |

---

## Cross-Module Dependencies

```
Client module
  └── standalone (no module dependencies)

OAuth module
  ├── depends on: Client module (validate client, redirect URIs)
  ├── depends on: Token module (issue tokens)
  ├── depends on: User module (get user for ID token claims)
  └── depends on: Session module (validate user session during authorize)

Token module
  ├── depends on: packages/db (refresh_tokens table)
  └── depends on: jose (JWT signing/verification)
```

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
