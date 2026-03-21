# Identity Starter — Phase 3: OAuth2/OIDC

**Status: NOT STARTED**

## Overview

Implement an OAuth 2.0 Authorization Server with OpenID Connect support. This is the core IdP functionality — client registration, authorization flows, token issuance, and a consent UI.

---

## Scope

### New Modules
- **Client module** (`apps/server/src/modules/client/`) — OAuth2 client registration and management
- **OAuth module** (`apps/server/src/modules/oauth/`) — Authorization server, token endpoint, authorization endpoint
- **Token module** (`apps/server/src/modules/token/`) — JWT issuance, refresh tokens, JWKS

### New DB Tables
- `oauth_clients` — Client registration (clientId, clientSecret, redirectUris, grantTypes, scopes)
- `authorization_codes` — Short-lived auth codes for authorization code flow
- `refresh_tokens` — Refresh token storage
- `consent_grants` — User consent records (userId, clientId, scopes, grantedAt)

### Key Libraries
- `jose` — JWT signing/verification, JWKS generation
- `nanoid` — Client ID and secret generation

---

## Features (Planned)

### OAuth2 Flows
- Authorization Code flow (with PKCE)
- Client Credentials flow
- Refresh Token flow
- Token revocation

### OpenID Connect
- ID Token issuance
- UserInfo endpoint
- Discovery endpoint (`.well-known/openid-configuration`)
- JWKS endpoint (`.well-known/jwks.json`)

### Client Management
- Client registration (CRUD)
- Client authentication (client_secret_basic, client_secret_post)
- Redirect URI validation
- Scope management

### Consent UI
- Consent page showing requested scopes
- Remember consent option
- Consent revocation

---

## Prerequisites

- Phase 1 complete ✅
- Phase 2 complete (authentication + sessions required for authorization flows)
