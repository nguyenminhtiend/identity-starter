# Phase 5: OAuth2 / OpenID Connect — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Prerequisite:** Phases 2–4 complete

---

## Summary

Implement an OAuth 2.0 Authorization Server with OpenID Connect (OIDC) support. Three new modules: **Client** (OAuth client CRUD), **Token** (JWT/JWKS/refresh), **OAuth** (authorization flows, consent). Four new DB tables plus a `signing_keys` table for JWKS key management.

Phase is split into **5a** (core OIDC provider) and **5b** (advanced RFCs). This spec covers both; the implementation plan covers 5a only.

---

## Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | JWKS key storage | DB table (`signing_keys`) + in-memory cache | Survives restarts, supports multi-instance, enables rotation tracking |
| 2 | Auth code / PAR storage | Postgres only | Consistent with webauthn_challenges pattern; Redis optimization deferred |
| 3 | Refresh token replay detection | Family revoke + 10s grace period | Handles concurrent tab refreshes like production IdPs (Auth0 pattern) |
| 4 | Token module location | `apps/server/src/modules/token/` | Extract to package when a resource server exists; YAGNI until then |
| 5 | Signing algorithm | RS256 | OIDC default, universal client support; ES256 addable later |
| 6 | Admin auth bridge | `is_admin` boolean on users + `requireAdmin` middleware | Disposable; Phase 6 RBAC replaces it |
| 7 | CORS for OAuth | Per-route: discovery/JWKS → `*`, token/introspect/revoke → registered redirect URI origins | Spec-correct security posture |
| 8 | Build order | Client → Token → OAuth | Zero-dep CRUD first, then JWT machinery, then orchestration |
| 9 | Phasing | 5a (core) → 5b (advanced) | Ship working OIDC before layering DPoP/PAR/introspection/logout |

---

## Phase 5a Scope (Core OIDC Provider)

### Included
- Client CRUD (admin-only) + secret rotation
- JWKS key generation, rotation, `/.well-known/jwks.json`
- Authorization Code flow with mandatory PKCE (S256)
- Token exchange (code → access + ID + refresh tokens)
- Refresh token rotation with family-based replay detection + grace period
- Token revocation (`POST /oauth/revoke`)
- Consent management (grant, skip on repeat)
- UserInfo endpoint
- Discovery endpoint (`/.well-known/openid-configuration`)
- `iss` parameter in authorization response (RFC 9207)
- `acr`/`amr` claims in ID tokens
- Per-route CORS for OAuth endpoints
- Admin bridge auth (`is_admin` + `requireAdmin`)

### Deferred to Phase 5b
- Client Credentials flow
- DPoP (RFC 9449)
- PAR (RFC 9126)
- Token introspection (RFC 7662)
- RP-Initiated Logout
- Consent revocation endpoint

---

## Module Architecture

```
Client module (standalone)
  ├── oauth_clients table
  ├── CRUD + secret rotation
  └── Admin-only routes under /api/admin/clients

Token module (depends on: db, jose)
  ├── signing_keys table
  ├── refresh_tokens table
  ├── JWKS key management (generate, rotate, list active)
  ├── JWT issuance (access tokens, ID tokens)
  └── Refresh token create/rotate/revoke

OAuth module (depends on: Client, Token, Session, User)
  ├── authorization_codes table
  ├── consent_grants table
  ├── Authorization endpoint (GET /oauth/authorize)
  ├── Token endpoint (POST /oauth/token)
  ├── Consent endpoint (POST /oauth/consent)
  ├── Revocation endpoint (POST /oauth/revoke)
  ├── UserInfo endpoint (GET /oauth/userinfo)
  └── Discovery endpoint (GET /.well-known/openid-configuration)
```

---

## New DB Tables

### signing_keys (new — not in original phase doc)

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `kid` | `text` | UNIQUE, NOT NULL | — |
| `algorithm` | `text` | NOT NULL | `'RS256'` |
| `public_key_jwk` | `jsonb` | NOT NULL | — |
| `private_key_jwk` | `jsonb` | NOT NULL | — |
| `status` | `text` | NOT NULL | `'active'` |
| `expires_at` | `timestamp` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |

### oauth_clients, authorization_codes, refresh_tokens, consent_grants

As specified in `docs/phase-5-oauth2-oidc.md` with no changes.

---

## New Environment Variables

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `JWT_ISSUER` | `string` | `http://localhost:3000` | OIDC `iss` claim, discovery `issuer` |
| `ACCESS_TOKEN_TTL_SECONDS` | `number` | `3600` (1hr) | Access token expiry |
| `REFRESH_TOKEN_TTL_SECONDS` | `number` | `2592000` (30d) | Refresh token expiry |
| `AUTH_CODE_TTL_SECONDS` | `number` | `600` (10min) | Authorization code expiry |
| `REFRESH_GRACE_PERIOD_SECONDS` | `number` | `10` | Grace window for concurrent refresh |

---

## Infrastructure Changes

1. **Install `jose`** in `apps/server`
2. **Add `ForbiddenError`** to `@identity-starter/core` (error handler already maps `FORBIDDEN` → 403)
3. **Add `is_admin` column** to `users` table (boolean, default false)
4. **Add `requireAdmin` Fastify decorator** — calls `requireSession` first, then checks `is_admin` on user row
5. **Per-route CORS plugin** — overrides global CORS for OAuth routes

---

## OIDC Claims Mapping

### Access Token (JWT)
`iss`, `sub`, `aud` (client_id), `exp`, `iat`, `jti`, `scope`, `client_id`

### ID Token (JWT)
`iss`, `sub`, `aud`, `exp`, `iat`, `nonce`, `auth_time`, `acr`, `amr`, `at_hash`, `sid`

### UserInfo Response
Based on granted scopes:
- `openid` → `sub`
- `profile` → `displayName`
- `email` → `email`, `emailVerified`

---

## Security Model

- Client secrets hashed with Argon2 (same `hashPassword` util)
- Authorization codes: 10min TTL, single-use (`used_at` on exchange)
- PKCE mandatory for all authorization code grants (S256 only)
- Redirect URI: exact string match, no wildcards
- Refresh token rotation: old token revoked, `family_id` for replay detection, 10s grace period
- JWKS: multiple active keys supported, phased rollover with grace period
- `iss` in authorization response (RFC 9207) prevents mix-up attacks
- Token endpoint rate limited per-client
