# Phase 5b: OAuth2 / OIDC Advanced RFCs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Phase 5a OIDC provider with Client Credentials flow, DPoP sender-constrained tokens, Pushed Authorization Requests (PAR), token introspection, RP-Initiated Logout, and consent revocation.

**Architecture:** All features extend the existing client/token/oauth modules from Phase 5a. One new DB table (`par_requests`), new columns on `refresh_tokens` for DPoP binding. No new modules — only service/route/schema additions.

**Tech Stack:** Fastify, Drizzle ORM, jose (JWT/JWKS), Zod 4, Vitest

**Prerequisite:** Phase 5a fully implemented and passing all tests.
**Spec:** `docs/superpowers/specs/2026-03-22-oauth2-oidc-design.md`
**Phase doc:** `docs/phase-5-oauth2-oidc.md`

---

## File Map

### DB Schema Changes
- Create: `packages/db/src/schema/par-request.ts` — PAR request storage
- Modify: `packages/db/src/schema/refresh-token.ts` — add `dpopJkt` column for DPoP binding
- Modify: `packages/db/src/schema/index.ts` — export `parRequests`
- Modify: `packages/db/src/index.ts` — export `parRequests`

### Token Module Extensions
- Modify: `apps/server/src/modules/token/jwt.service.ts` — DPoP proof validation, `cnf.jkt` claim
- Create: `apps/server/src/modules/token/dpop.service.ts` — DPoP proof parsing, thumbprint, nonce management
- Modify: `apps/server/src/modules/token/refresh-token.service.ts` — DPoP `jkt` binding on create/rotate
- Modify: `apps/server/src/modules/token/token.schemas.ts` — introspection schemas, DPoP schemas
- Modify: `apps/server/src/modules/token/token.events.ts` — introspection events
- Modify: `apps/server/src/modules/token/index.ts` — export new services

### OAuth Module Extensions
- Create: `apps/server/src/modules/oauth/par.service.ts` — PAR request storage and retrieval
- Modify: `apps/server/src/modules/oauth/oauth.service.ts` — client credentials flow, consent revocation, PAR-based authorize
- Modify: `apps/server/src/modules/oauth/oauth.routes.ts` — introspect, par, end-session, consent revocation routes
- Modify: `apps/server/src/modules/oauth/oauth.schemas.ts` — new endpoint schemas
- Modify: `apps/server/src/modules/oauth/oauth.events.ts` — new events
- Modify: `apps/server/src/modules/oauth/discovery.routes.ts` — update metadata for new endpoints/features

### Tests
- Create: `apps/server/src/modules/token/__tests__/dpop.service.test.ts`
- Create: `apps/server/src/modules/oauth/__tests__/par.service.test.ts`
- Create: `apps/server/src/modules/oauth/__tests__/par.service.integration.test.ts`
- Modify: `apps/server/src/modules/token/__tests__/jwt.service.test.ts` — DPoP cases
- Modify: `apps/server/src/modules/token/__tests__/refresh-token.service.test.ts` — DPoP binding cases
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.service.test.ts` — client credentials, consent revocation
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.routes.test.ts` — new endpoint tests
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.routes.integration.test.ts` — new flow tests

### Environment
- Modify: `apps/server/src/core/env.ts` — add `PAR_TTL_SECONDS`, `DPOP_NONCE_TTL_SECONDS`

---

## Task 1: Environment Variables + DB Schema (PAR + DPoP)

**Files:**
- Modify: `apps/server/src/core/env.ts`
- Create: `packages/db/src/schema/par-request.ts`
- Modify: `packages/db/src/schema/refresh-token.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add env vars**

In `apps/server/src/core/env.ts`, add:

```typescript
PAR_TTL_SECONDS: z.coerce.number().default(60),
DPOP_NONCE_TTL_SECONDS: z.coerce.number().default(300),
```

- [ ] **Step 2: Create par_requests schema**

Create `packages/db/src/schema/par-request.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { oauthClients } from './oauth-client.js';

export const parRequests = pgTable('par_requests', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  requestUri: text('request_uri').notNull().unique(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => oauthClients.id, { onDelete: 'cascade' }),
  parameters: text('parameters').notNull(), // JSON-encoded authorization params
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`parameters` stores the full authorization request as JSON (response_type, redirect_uri, scope, code_challenge, code_challenge_method, state, nonce). Parsed on retrieval.

- [ ] **Step 3: Add dpopJkt to refresh_tokens**

In `packages/db/src/schema/refresh-token.ts`, add column:

```typescript
dpopJkt: text('dpop_jkt'),
```

Nullable — only set when the refresh token was issued with a DPoP proof. On rotation, the new token inherits the same `dpopJkt`.

- [ ] **Step 4: Export from index files**

Add to `packages/db/src/schema/index.ts`:

```typescript
export { parRequests } from './par-request.js';
```

Mirror in `packages/db/src/index.ts`.

- [ ] **Step 5: Generate migration**

```bash
cd packages/db && pnpm drizzle-kit generate
```

Verify SQL creates `par_requests` table and adds `dpop_jkt` column to `refresh_tokens`.

- [ ] **Step 6: Build and verify**

```bash
cd packages/db && pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add PAR request table and DPoP binding column"
```

---

## Task 2: DPoP Service — Proof Validation + Thumbprint

**Files:**
- Create: `apps/server/src/modules/token/dpop.service.ts`
- Test: `apps/server/src/modules/token/__tests__/dpop.service.test.ts`

DPoP (RFC 9449) lets clients prove possession of a key pair. The client sends a DPoP proof JWT in the `DPoP` header. The server validates it and binds the access token to the client's public key via a JWK thumbprint (`jkt`).

- [ ] **Step 1: Write DPoP service unit tests**

Test cases:
1. `validateDpopProof(proofJwt, { htm, htu, accessToken? })` — valid proof returns `{ jkt, publicKey }`
2. Invalid signature → throws
3. Missing required claims (`htm`, `htu`, `iat`, `jti`) → throws
4. Wrong `htm` (e.g., proof says GET but request was POST) → throws
5. Wrong `htu` (proof URL doesn't match request URL) → throws
6. Expired proof (`iat` too old — beyond `DPOP_NONCE_TTL_SECONDS`) → throws
7. `ath` claim validation — when `accessToken` provided, `ath` must be SHA-256 base64url hash of access token
8. `calculateJkt(publicJwk)` — computes JWK SHA-256 thumbprint per RFC 7638

- [ ] **Step 2: Implement DPoP service**

```typescript
import * as jose from 'jose';
import { createHash } from 'node:crypto';
```

Key functions:

**`validateDpopProof(proofJwt, params)`:**
1. Decode the DPoP proof JWT header — must have `typ: 'dpop+jwt'` and a `jwk` in the header
2. Extract the public key from the header `jwk`
3. Verify the JWT signature using the embedded public key
4. Validate claims: `htm` matches request method, `htu` matches request URL, `iat` is recent, `jti` is present
5. If `accessToken` provided (resource server use), validate `ath` = base64url(SHA-256(accessToken))
6. Compute and return `jkt` = JWK thumbprint of the public key

**`calculateJkt(publicJwk)`:**
```typescript
const thumbprint = await jose.calculateJwkThumbprint(jwk, 'sha256');
return thumbprint;
```

**DPoP proof structure (for reference):**
```
Header: { typ: "dpop+jwt", alg: "ES256", jwk: { ... } }
Payload: { jti: "unique-id", htm: "POST", htu: "https://server.example.com/oauth/token", iat: 1234567890, ath: "base64url-hash" }
```

- [ ] **Step 3: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/token/__tests__/dpop.service.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(token): add DPoP proof validation service"
```

---

## Task 3: DPoP Integration into Token Issuance + Refresh

**Files:**
- Modify: `apps/server/src/modules/token/jwt.service.ts`
- Modify: `apps/server/src/modules/token/refresh-token.service.ts`
- Modify: `apps/server/src/modules/token/token.schemas.ts`
- Modify: `apps/server/src/modules/token/__tests__/jwt.service.test.ts`
- Modify: `apps/server/src/modules/token/__tests__/refresh-token.service.test.ts`

- [ ] **Step 1: Write tests for DPoP-bound token issuance**

Add test cases to `jwt.service.test.ts`:
1. `issueAccessToken` with `dpopJkt` → access token contains `cnf: { jkt: "..." }` claim
2. `issueAccessToken` without `dpopJkt` → no `cnf` claim (regular Bearer token)
3. Token response `token_type` is `'DPoP'` when DPoP-bound, `'Bearer'` otherwise

Add test cases to `refresh-token.service.test.ts`:
1. `createRefreshToken` with `dpopJkt` → stored in DB
2. `rotateRefreshToken` for DPoP-bound token → new token inherits `dpopJkt`
3. `rotateRefreshToken` with mismatched `dpopJkt` → throws (binding mismatch)

- [ ] **Step 2: Update JWT service for DPoP**

In `jwt.service.ts`, modify `issueAccessToken` to accept optional `dpopJkt`:

```typescript
interface AccessTokenParams {
  // ... existing params
  dpopJkt?: string;
}
```

When `dpopJkt` is provided, add `cnf: { jkt: dpopJkt }` to the JWT payload.

- [ ] **Step 3: Update refresh token service for DPoP binding**

In `refresh-token.service.ts`:
- `createRefreshToken` accepts optional `dpopJkt`, stores in DB
- `rotateRefreshToken` checks that if original token had `dpopJkt`, the new rotation request must present the same `dpopJkt` (verified via DPoP proof in the `DPoP` header on the refresh request)
- New token inherits `dpopJkt` from the original

- [ ] **Step 4: Update token schemas**

Add to `token.schemas.ts`:
- `dpopProofSchema` — validates DPoP header format
- Update `tokenResponseSchema` to include `token_type: z.enum(['Bearer', 'DPoP'])`

- [ ] **Step 5: Run all token tests**

```bash
cd apps/server && pnpm vitest run src/modules/token/
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(token): integrate DPoP binding into token issuance and refresh"
```

---

## Task 4: Client Credentials Flow

**Files:**
- Modify: `apps/server/src/modules/oauth/oauth.service.ts`
- Modify: `apps/server/src/modules/oauth/oauth.schemas.ts`
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.service.test.ts`

- [ ] **Step 1: Write unit tests for client credentials flow**

Test cases:
1. `exchangeToken(grant_type=client_credentials)` with valid client → issues access token (no ID token, no refresh token)
2. Scope is intersection of requested scope and client's allowed scopes
3. Client must have `client_credentials` in its `grant_types` → error if not
4. Public client (non-confidential) → error (client credentials requires confidential client)
5. Suspended client → error
6. Access token `sub` is the `client_id` (not a user ID — M2M has no user context)

- [ ] **Step 2: Update schemas**

In `oauth.schemas.ts`, extend the token request discriminated union to include:

```typescript
// grant_type=client_credentials
z.object({
  grant_type: z.literal('client_credentials'),
  scope: z.string().optional(),
})
```

- [ ] **Step 3: Implement client credentials in oauth service**

In `oauth.service.ts`, add a branch in `exchangeToken` for `grant_type === 'client_credentials'`:

1. Authenticate client (already done by route layer extracting credentials)
2. Verify client has `client_credentials` grant type
3. Verify client is confidential
4. Compute effective scope (intersection of requested and allowed)
5. Issue access token with `sub = client.clientId` (no user)
6. Return token response with no `refresh_token` and no `id_token`

- [ ] **Step 4: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(oauth): add client credentials flow"
```

---

## Task 5: Token Introspection (RFC 7662)

**Files:**
- Modify: `apps/server/src/modules/oauth/oauth.schemas.ts`
- Modify: `apps/server/src/modules/oauth/oauth.service.ts`
- Modify: `apps/server/src/modules/oauth/oauth.routes.ts`
- Modify: `apps/server/src/modules/token/token.events.ts`
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.service.test.ts`
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.routes.test.ts`

- [ ] **Step 1: Write unit tests for introspection**

Test cases:
1. Active access token (JWT) → returns `{ active: true, sub, client_id, scope, exp, iat, iss, token_type: 'access_token' }`
2. Expired access token → `{ active: false }`
3. Invalid access token (bad signature) → `{ active: false }`
4. Active refresh token → `{ active: true, sub, client_id, scope, exp, iat, token_type: 'refresh_token' }`
5. Revoked refresh token → `{ active: false }`
6. DPoP-bound token → response includes `cnf: { jkt }` and `token_type: 'DPoP'`
7. Unknown token → `{ active: false }`
8. `token_type_hint` optimizes lookup order but doesn't change result

- [ ] **Step 2: Add introspection schemas**

In `oauth.schemas.ts`:

```typescript
export const introspectRequestSchema = z.object({
  token: z.string().min(1),
  token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
});

export const introspectResponseSchema = z.object({
  active: z.boolean(),
  scope: z.string().optional(),
  client_id: z.string().optional(),
  sub: z.string().optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
  iss: z.string().optional(),
  token_type: z.string().optional(),
  cnf: z.object({ jkt: z.string() }).optional(),
});
```

- [ ] **Step 3: Implement introspection**

In `oauth.service.ts`, add `introspectToken(token, tokenTypeHint?)`:

1. If hint is `access_token` (or no hint), try JWT decode first:
   - Verify signature with JWKS
   - Check `exp` not passed
   - If valid: return active response with decoded claims
2. If hint is `refresh_token` (or JWT decode failed), try DB lookup:
   - Hash token, look up in `refresh_tokens`
   - If found, not expired, not revoked: return active response
3. If neither matched: return `{ active: false }`

- [ ] **Step 4: Add introspect route**

In `oauth.routes.ts`, add `POST /introspect`:
- Client authentication required (Basic or POST body)
- Accepts `application/x-www-form-urlencoded`
- Calls `introspectToken`

- [ ] **Step 5: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.service.test.ts
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.routes.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(oauth): add token introspection endpoint (RFC 7662)"
```

---

## Task 6: Pushed Authorization Requests — PAR (RFC 9126)

**Files:**
- Create: `apps/server/src/modules/oauth/par.service.ts`
- Modify: `apps/server/src/modules/oauth/oauth.schemas.ts`
- Modify: `apps/server/src/modules/oauth/oauth.service.ts`
- Modify: `apps/server/src/modules/oauth/oauth.routes.ts`
- Test: `apps/server/src/modules/oauth/__tests__/par.service.test.ts`
- Test: `apps/server/src/modules/oauth/__tests__/par.service.integration.test.ts`

- [ ] **Step 1: Write PAR service unit tests**

Test cases:
1. `createParRequest(clientId, params)` → stores params, returns `{ request_uri: 'urn:ietf:params:oauth:request_uri:...', expires_in: 60 }`
2. `consumeParRequest(requestUri, clientId)` → returns stored params, marks as used
3. Expired PAR request → throws
4. Already-used PAR request → throws
5. Wrong client_id trying to consume → throws
6. `request_uri` format is `urn:ietf:params:oauth:request_uri:<random>`

- [ ] **Step 2: Implement PAR service**

Create `apps/server/src/modules/oauth/par.service.ts`:

```typescript
import { createHash, randomBytes } from 'node:crypto';
```

Key functions:

**`createParRequest(db, clientInternalId, params)`:**
1. Generate `request_uri`: `urn:ietf:params:oauth:request_uri:${randomBytes(32).toString('base64url')}`
2. JSON-encode `params` (all authorization request parameters)
3. Insert into `par_requests` with `expiresAt = now() + PAR_TTL_SECONDS`
4. Return `{ request_uri, expires_in: PAR_TTL_SECONDS }`

**`consumeParRequest(db, requestUri, clientInternalId)`:**
1. Look up by `request_uri`
2. Verify not expired, not used, client matches
3. Mark `used_at = now()`
4. Parse and return the stored parameters

- [ ] **Step 3: Add PAR schemas**

In `oauth.schemas.ts`:

```typescript
export const parRequestSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.url(),
  scope: z.string().min(1),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256'),
  state: z.string().optional(),
  nonce: z.string().optional(),
});

export const parResponseSchema = z.object({
  request_uri: z.string(),
  expires_in: z.number(),
});
```

- [ ] **Step 4: Update authorize to accept request_uri**

In `oauth.service.ts`, modify `authorize`:

```typescript
// If request has request_uri parameter:
// 1. Consume PAR request (validates client, expiry, single-use)
// 2. Use stored params instead of query params
// 3. Proceed with normal authorization flow
```

Update `authorizeQuerySchema` to accept either inline params or `request_uri`:

```typescript
// Option A: inline params (existing)
// Option B: request_uri + client_id only
z.object({
  request_uri: z.string().startsWith('urn:ietf:params:oauth:request_uri:'),
  client_id: z.string().min(1),
})
```

- [ ] **Step 5: Add PAR route**

In `oauth.routes.ts`, add `POST /par`:
- Client authentication required
- Validates all authorization parameters up front (redirect_uri against client, scope against client, etc.)
- Returns `{ request_uri, expires_in }`

- [ ] **Step 6: Run unit tests**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/par.service.test.ts
```

- [ ] **Step 7: Write and run integration tests**

Test against real DB: create client → PAR → authorize with request_uri → exchange code → verify tokens.

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/par.service.integration.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(oauth): add Pushed Authorization Requests (RFC 9126)"
```

---

## Task 7: RP-Initiated Logout (OIDC RP-Initiated Logout 1.0)

**Files:**
- Modify: `apps/server/src/modules/oauth/oauth.schemas.ts`
- Modify: `apps/server/src/modules/oauth/oauth.service.ts`
- Modify: `apps/server/src/modules/oauth/oauth.routes.ts`
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.service.test.ts`
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.routes.test.ts`

- [ ] **Step 1: Write unit tests for end-session**

Test cases:
1. `endSession(idTokenHint, postLogoutRedirectUri, state)` with valid ID token → destroys session → returns redirect URL with `state`
2. Valid ID token + `post_logout_redirect_uri` not registered on client → error
3. Valid ID token + `post_logout_redirect_uri` registered → redirect to that URI
4. No `id_token_hint` → destroys current session (if any) → redirect to default
5. Invalid/expired `id_token_hint` → still destroys session → no redirect to client URI (security)
6. Session already destroyed → no-op, still returns redirect

- [ ] **Step 2: Add end-session schemas**

In `oauth.schemas.ts`:

```typescript
export const endSessionQuerySchema = z.object({
  id_token_hint: z.string().optional(),
  post_logout_redirect_uri: z.url().optional(),
  state: z.string().optional(),
});
```

- [ ] **Step 3: Implement end-session logic**

In `oauth.service.ts`, add `endSession(params, sessionId?)`:

1. If `id_token_hint` provided:
   - Decode JWT (verify signature with JWKS)
   - Extract `sub` (user ID) and `aud` (client_id)
   - Look up client, verify `post_logout_redirect_uri` is in client's `redirect_uris` (or a separate `post_logout_redirect_uris` list — for simplicity, reuse `redirect_uris`)
2. Destroy the user's session (call `revokeSession` from session module)
3. Build redirect URL:
   - If valid `post_logout_redirect_uri`: redirect there with `state` if provided
   - Otherwise: redirect to `JWT_ISSUER` root (or return a simple "logged out" response)

- [ ] **Step 4: Add end-session route**

In `oauth.routes.ts`, add `GET /end-session`:
- Public endpoint (no auth required — user may already be logged out)
- If session exists (Bearer token), destroy it
- Returns 302 redirect

- [ ] **Step 5: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.service.test.ts
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.routes.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(oauth): add RP-Initiated Logout endpoint"
```

---

## Task 8: Consent Revocation Endpoint

**Files:**
- Modify: `apps/server/src/modules/oauth/oauth.service.ts`
- Modify: `apps/server/src/modules/oauth/oauth.routes.ts`
- Modify: `apps/server/src/modules/oauth/oauth.schemas.ts`
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.service.test.ts`
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.routes.test.ts`

- [ ] **Step 1: Write unit tests for consent revocation**

Test cases:
1. `revokeConsent(userId, clientId)` — marks consent grant `revoked_at = now()`, revokes all refresh tokens for user+client
2. Non-existent consent → throws `NotFoundError`
3. Already-revoked consent → throws `NotFoundError`
4. Verify all refresh tokens for user+client are revoked after consent revocation

- [ ] **Step 2: Add consent revocation schema**

In `oauth.schemas.ts`:

```typescript
export const consentClientIdParamSchema = z.object({
  clientId: z.string().min(1),
});
```

- [ ] **Step 3: Implement consent revocation**

In `oauth.service.ts`, add `revokeConsent(userId, oauthClientId)`:

1. Find active consent grant for user+client (where `revoked_at IS NULL`)
2. If not found → throw `NotFoundError`
3. Set `revoked_at = now()` on the consent grant
4. Revoke all non-revoked refresh tokens for user+client (set `revoked_at = now()`)
5. Emit `OAUTH_EVENTS.CONSENT_REVOKED`

- [ ] **Step 4: Add route**

In `oauth.routes.ts`, add `DELETE /consent/:clientId`:
- Session required (`preHandler: fastify.requireSession`)
- Calls `revokeConsent(request.userId, params.clientId)`
- Returns 204

- [ ] **Step 5: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.service.test.ts
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.routes.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(oauth): add consent revocation endpoint"
```

---

## Task 9: Update Discovery Metadata

**Files:**
- Modify: `apps/server/src/modules/oauth/discovery.routes.ts`
- Modify: `apps/server/src/modules/oauth/__tests__/discovery.routes.test.ts`

- [ ] **Step 1: Update discovery tests**

Add assertions for new fields in `/.well-known/openid-configuration`:

```typescript
// New fields:
introspection_endpoint: `${issuer}/oauth/introspect`,
end_session_endpoint: `${issuer}/oauth/end-session`,
pushed_authorization_request_endpoint: `${issuer}/oauth/par`,
require_pushed_authorization_requests: false,
grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
dpop_signing_alg_values_supported: ['ES256', 'RS256'],
introspection_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
```

- [ ] **Step 2: Update discovery route**

In `discovery.routes.ts`, add the new fields to the OIDC configuration response.

- [ ] **Step 3: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/discovery.routes.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(oauth): update OIDC discovery with 5b endpoints"
```

---

## Task 10: DPoP Integration in OAuth Routes

**Files:**
- Modify: `apps/server/src/modules/oauth/oauth.routes.ts`
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.routes.test.ts`

This wires DPoP proof validation into the OAuth routes that were built in 5a.

- [ ] **Step 1: Write route-level DPoP tests**

Test cases:
1. `POST /token` with `DPoP` header → validates proof → issues DPoP-bound tokens (`token_type: 'DPoP'`)
2. `POST /token` without `DPoP` header → issues Bearer tokens (existing behavior)
3. `POST /token` with invalid DPoP proof → 400 error
4. `POST /token` (refresh) with DPoP → verifies `jkt` matches original token binding
5. `GET /userinfo` with `DPoP` header + `Authorization: DPoP <token>` → validates proof `ath` matches access token
6. `POST /introspect` for DPoP-bound token → response includes `cnf.jkt`

- [ ] **Step 2: Wire DPoP into token endpoint**

In `oauth.routes.ts`, in the `POST /token` handler:

```typescript
const dpopHeader = request.headers['dpop'] as string | undefined;
let dpopJkt: string | undefined;

if (dpopHeader) {
  const dpopResult = await validateDpopProof(dpopHeader, {
    htm: 'POST',
    htu: `${env.JWT_ISSUER}/oauth/token`,
  });
  dpopJkt = dpopResult.jkt;
}

// Pass dpopJkt to exchangeToken → flows through to JWT issuance + refresh token creation
```

- [ ] **Step 3: Wire DPoP into userinfo endpoint**

In the `GET /userinfo` handler:

```typescript
// If Authorization header starts with "DPoP " instead of "Bearer ":
// 1. Extract access token
// 2. Require DPoP header
// 3. Validate DPoP proof with ath = SHA-256(access_token)
// 4. Verify access token cnf.jkt matches DPoP proof jkt
```

- [ ] **Step 4: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.routes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(oauth): wire DPoP proof validation into OAuth routes"
```

---

## Task 11: Per-Client Rate Limiting on Token Endpoint

**Files:**
- Modify: `apps/server/src/modules/oauth/oauth.routes.ts`
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.routes.test.ts`

- [ ] **Step 1: Add per-client rate limit**

In `oauth.routes.ts`, add rate limiting config on `POST /token`:

```typescript
config: {
  rateLimit: {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      // Rate limit by client_id (extracted from Basic auth or body)
      // Fall back to IP if client auth fails
      return extractClientId(request) ?? request.ip;
    },
  },
},
```

- [ ] **Step 2: Write test for rate limiting**

Verify that after N requests from the same client, subsequent requests get 429.

- [ ] **Step 3: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.routes.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(oauth): add per-client rate limiting on token endpoint"
```

---

## Task 12: Integration Tests — Full 5b Flows

**Files:**
- Modify: `apps/server/src/modules/oauth/__tests__/oauth.routes.integration.test.ts`

- [ ] **Step 1: Write end-to-end integration tests**

Test flows against real DB and HTTP:

1. **Client credentials flow:** Create confidential client with `client_credentials` grant → `POST /token` with client_secret_basic → verify access token claims (`sub = client_id`, no ID token, no refresh token)
2. **DPoP flow:** Generate ES256 key pair → create DPoP proof → `POST /token` with DPoP header → verify `token_type: 'DPoP'` and `cnf.jkt` in access token → `POST /introspect` → verify `cnf.jkt` in response → `GET /userinfo` with DPoP auth → verify response
3. **PAR flow:** `POST /oauth/par` with all authorize params → receive `request_uri` → `GET /oauth/authorize?request_uri=...&client_id=...` → consent → exchange code → verify tokens
4. **Token introspection:** Exchange code → introspect access token → verify active + claims → introspect refresh token → verify active → revoke refresh token → introspect again → verify inactive
5. **RP-Initiated Logout:** Full auth code flow → `GET /oauth/end-session?id_token_hint=...&post_logout_redirect_uri=...` → verify 302 redirect → verify session destroyed
6. **Consent revocation:** Full auth code flow → `DELETE /oauth/consent/:clientId` → verify consent revoked → verify refresh tokens revoked → new authorize requires fresh consent

- [ ] **Step 2: Run full integration suite**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.routes.integration.test.ts
```

- [ ] **Step 3: Run complete test suite**

```bash
cd apps/server && pnpm vitest run
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(oauth): add Phase 5b end-to-end integration tests"
```

---

## Task Dependency Graph

```
Task 1 (DB + env) ──┬── Task 2 (DPoP service) ──── Task 3 (DPoP in token module)
                     │                                        │
                     ├── Task 4 (client credentials)          │
                     │                                        │
                     ├── Task 5 (introspection)               │
                     │                                        │
                     ├── Task 6 (PAR)                         ├── Task 10 (DPoP in routes)
                     │                                        │
                     ├── Task 7 (RP-Initiated Logout)         │
                     │                                        │
                     └── Task 8 (consent revocation)          │
                                                              │
                     Task 9 (discovery update) ←──────────────┘
                                                              │
                     Task 11 (rate limiting) ──── Task 12 (integration tests)
```

Tasks 2, 4, 5, 6, 7, 8 can run **in parallel** after Task 1.
Task 3 depends on Task 2.
Task 10 depends on Tasks 3 + 5 (DPoP in token + introspection).
Task 9 depends on Tasks 5-8 (needs all endpoints to exist).
Task 12 depends on all previous tasks.
