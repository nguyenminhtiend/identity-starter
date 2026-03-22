# Phase 5a: OAuth2 / OIDC Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working OIDC Authorization Server with authorization code flow (PKCE), JWT token issuance, refresh tokens, consent management, and discovery endpoints.

**Architecture:** Three new modules (client, token, oauth) following existing module conventions (routes + service + schemas + events + index.ts). Client module is standalone admin CRUD. Token module handles JWKS and JWT issuance. OAuth module orchestrates authorization flows, depending on Client, Token, Session, and User modules.

**Tech Stack:** Fastify, Drizzle ORM, jose (JWT/JWKS), Zod 4, Vitest, @node-rs/argon2

**Spec:** `docs/superpowers/specs/2026-03-22-oauth2-oidc-design.md`
**Phase doc:** `docs/phase-5-oauth2-oidc.md`

---

## File Map

### Infrastructure
- Modify: `packages/core/src/errors.ts` — add `ForbiddenError`
- Modify: `packages/core/src/index.ts` — export `ForbiddenError`
- Modify: `apps/server/src/core/env.ts` — add OAuth env vars
- Create: `apps/server/src/core/plugins/admin.ts` — `requireAdmin` decorator
- Modify: `apps/server/src/core/plugins/auth.ts` — augment Fastify types for `requireAdmin`
- Modify: `apps/server/src/app.ts` — register admin plugin, per-route CORS

### DB Schemas (packages/db)
- Modify: `packages/db/src/schema/user.ts` — add `isAdmin` column
- Create: `packages/db/src/schema/signing-key.ts`
- Create: `packages/db/src/schema/oauth-client.ts`
- Create: `packages/db/src/schema/authorization-code.ts`
- Create: `packages/db/src/schema/refresh-token.ts`
- Create: `packages/db/src/schema/consent-grant.ts`
- Modify: `packages/db/src/schema/index.ts` — export new tables
- Modify: `packages/db/src/index.ts` — export new tables

### Client Module (apps/server/src/modules/client/)
- Create: `client.schemas.ts`
- Create: `client.service.ts`
- Create: `client.routes.ts`
- Create: `client.events.ts`
- Create: `index.ts`
- Create: `__tests__/client.factory.ts`
- Create: `__tests__/client.schemas.test.ts`
- Create: `__tests__/client.service.test.ts`
- Create: `__tests__/client.routes.test.ts`
- Create: `__tests__/client.service.integration.test.ts`
- Create: `__tests__/client.routes.integration.test.ts`

### Token Module (apps/server/src/modules/token/)
- Create: `token.schemas.ts`
- Create: `signing-key.service.ts` — JWKS key management
- Create: `jwt.service.ts` — JWT issuance (access + ID tokens)
- Create: `refresh-token.service.ts` — refresh token CRUD + rotation
- Create: `token.events.ts`
- Create: `index.ts`
- Create: `__tests__/token.factory.ts`
- Create: `__tests__/signing-key.service.test.ts`
- Create: `__tests__/jwt.service.test.ts`
- Create: `__tests__/refresh-token.service.test.ts`
- Create: `__tests__/signing-key.service.integration.test.ts`
- Create: `__tests__/refresh-token.service.integration.test.ts`

### OAuth Module (apps/server/src/modules/oauth/)
- Create: `oauth.schemas.ts`
- Create: `oauth.service.ts` — authorization + consent orchestration
- Create: `oauth.routes.ts` — authorize, token, consent, revoke, userinfo
- Create: `discovery.routes.ts` — .well-known endpoints
- Create: `oauth.events.ts`
- Create: `index.ts`
- Create: `__tests__/oauth.factory.ts`
- Create: `__tests__/oauth.schemas.test.ts`
- Create: `__tests__/oauth.service.test.ts`
- Create: `__tests__/oauth.routes.test.ts`
- Create: `__tests__/oauth.service.integration.test.ts`
- Create: `__tests__/oauth.routes.integration.test.ts`
- Create: `__tests__/discovery.routes.test.ts`

### Module Registration
- Modify: `apps/server/src/core/module-loader.ts` — register client, oauth, discovery modules

---

## Task 1: Infrastructure — Install jose, ForbiddenError, Env Vars

**Files:**
- Modify: `apps/server/package.json` (via pnpm)
- Modify: `packages/core/src/errors.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/server/src/core/env.ts`

- [ ] **Step 1: Install jose**

```bash
cd apps/server && pnpm add jose
```

- [ ] **Step 2: Add ForbiddenError to core**

In `packages/core/src/errors.ts`, add after `UnauthorizedError`:

```typescript
export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}
```

Export from `packages/core/src/index.ts`:

```typescript
export {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from './errors.js';
```

- [ ] **Step 3: Add OAuth env vars**

In `apps/server/src/core/env.ts`, add to `EnvSchema`:

```typescript
JWT_ISSUER: z.url().default('http://localhost:3000'),
ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(3600),
REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().default(2592000),
AUTH_CODE_TTL_SECONDS: z.coerce.number().default(600),
REFRESH_GRACE_PERIOD_SECONDS: z.coerce.number().default(10),
```

- [ ] **Step 4: Verify build**

```bash
cd packages/core && pnpm build
cd ../../apps/server && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add jose, ForbiddenError, OAuth env vars"
```

---

## Task 2: Admin Bridge — is_admin Column + requireAdmin Middleware

**Files:**
- Modify: `packages/db/src/schema/user.ts`
- Create: `apps/server/src/core/plugins/admin.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/core/plugins/__tests__/admin.test.ts`

- [ ] **Step 1: Add is_admin to users table**

In `packages/db/src/schema/user.ts`, add column to `users`:

```typescript
isAdmin: boolean('is_admin').notNull().default(false),
```

- [ ] **Step 2: Generate migration**

```bash
cd packages/db && pnpm drizzle-kit generate
```

Verify the generated SQL adds `is_admin boolean NOT NULL DEFAULT false` to `users`.

- [ ] **Step 3: Write requireAdmin plugin test**

Create `apps/server/src/core/plugins/__tests__/admin.test.ts`:

```typescript
import { ForbiddenError } from '@identity-starter/core';
import { describe, expect, it, vi } from 'vitest';

// Test that requireAdmin throws ForbiddenError when user is not admin
// Test that requireAdmin passes when user is admin
// Test that requireAdmin calls requireSession first
```

Test cases:
1. Throws `ForbiddenError` when `is_admin` is false
2. Passes through when `is_admin` is true
3. Calls `requireSession` first (session validation happens before admin check)

- [ ] **Step 4: Implement requireAdmin plugin**

Create `apps/server/src/core/plugins/admin.ts`:

```typescript
import { ForbiddenError } from '@identity-starter/core';
import { users } from '@identity-starter/db';
import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    requireAdmin: (request: FastifyRequest) => Promise<void>;
  }
}

export const adminPlugin = fp(async (fastify) => {
  const { db } = fastify.container;

  fastify.decorate('requireAdmin', async (request: FastifyRequest) => {
    await fastify.requireSession(request);

    const [user] = await db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, request.userId))
      .limit(1);

    if (!user?.isAdmin) {
      throw new ForbiddenError('Admin access required');
    }
  });
});
```

- [ ] **Step 5: Register in app.ts**

In `apps/server/src/app.ts`, after `authPlugin` registration:

```typescript
import { adminPlugin } from './core/plugins/admin.js';
// ...
await app.register(adminPlugin);
```

- [ ] **Step 6: Run tests**

```bash
cd apps/server && pnpm vitest run src/core/plugins/__tests__/admin.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add is_admin column and requireAdmin middleware"
```

---

## Task 3: DB Schemas — signing_keys, oauth_clients, authorization_codes, refresh_tokens, consent_grants

**Files:**
- Create: `packages/db/src/schema/signing-key.ts`
- Create: `packages/db/src/schema/oauth-client.ts`
- Create: `packages/db/src/schema/authorization-code.ts`
- Create: `packages/db/src/schema/refresh-token.ts`
- Create: `packages/db/src/schema/consent-grant.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/index.ts`

Reference existing schemas like `packages/db/src/schema/session.ts` for pattern (FK references, `uuidv7()`, timestamps with timezone, `getTableColumns`).

- [ ] **Step 1: Create signing_keys schema**

Create `packages/db/src/schema/signing-key.ts`:

```typescript
import { getTableColumns, sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const signingKeys = pgTable('signing_keys', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  kid: text('kid').notNull().unique(),
  algorithm: text('algorithm').notNull().default('RS256'),
  publicKeyJwk: jsonb('public_key_jwk').notNull(),
  privateKeyJwk: jsonb('private_key_jwk').notNull(),
  status: text('status', { enum: ['active', 'rotated', 'revoked'] }).notNull().default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

const signingKeyColumns = getTableColumns(signingKeys);
export { signingKeyColumns };
```

- [ ] **Step 2: Create oauth_clients schema**

Create `packages/db/src/schema/oauth-client.ts`:

```typescript
import { getTableColumns, sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const oauthClients = pgTable('oauth_clients', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  clientId: text('client_id').notNull().unique(),
  clientSecretHash: text('client_secret_hash').notNull(),
  clientName: varchar('client_name', { length: 255 }).notNull(),
  description: text('description'),
  redirectUris: text('redirect_uris').array().notNull(),
  grantTypes: text('grant_types').array().notNull(),
  responseTypes: text('response_types').array().notNull(),
  scope: text('scope').notNull(),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull(),
  isConfidential: boolean('is_confidential').notNull(),
  logoUri: text('logo_uri'),
  tosUri: text('tos_uri'),
  policyUri: text('policy_uri'),
  applicationType: text('application_type', { enum: ['web', 'native'] }).notNull().default('web'),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

const { clientSecretHash: _, ...oauthClientColumns } = getTableColumns(oauthClients);
export { oauthClientColumns };
```

- [ ] **Step 3: Create authorization_codes schema**

Create `packages/db/src/schema/authorization-code.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { oauthClients } from './oauth-client.js';
import { users } from './user.js';

export const authorizationCodes = pgTable('authorization_codes', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  code: text('code').notNull().unique(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => oauthClients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  scope: text('scope').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
  nonce: text('nonce'),
  state: text('state'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Create refresh_tokens schema**

Create `packages/db/src/schema/refresh-token.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { oauthClients } from './oauth-client.js';
import { users } from './user.js';

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  token: text('token').notNull().unique(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => oauthClients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  familyId: uuid('family_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 5: Create consent_grants schema**

Create `packages/db/src/schema/consent-grant.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { oauthClients } from './oauth-client.js';
import { users } from './user.js';

export const consentGrants = pgTable('consent_grants', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => oauthClients.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
```

- [ ] **Step 6: Export all new tables from schema/index.ts and db/index.ts**

Add to `packages/db/src/schema/index.ts`:

```typescript
export { authorizationCodes } from './authorization-code.js';
export { consentGrants } from './consent-grant.js';
export { oauthClientColumns, oauthClients } from './oauth-client.js';
export { refreshTokens } from './refresh-token.js';
export { signingKeyColumns, signingKeys } from './signing-key.js';
```

Mirror these exports in `packages/db/src/index.ts`.

- [ ] **Step 7: Generate migration**

```bash
cd packages/db && pnpm drizzle-kit generate
```

Verify SQL creates all 5 new tables with correct columns, FKs, and indexes.

- [ ] **Step 8: Build and verify**

```bash
cd packages/db && pnpm build
```

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: add OAuth2/OIDC database schemas"
```

---

## Task 4: Client Module — Schemas + Events

**Files:**
- Create: `apps/server/src/modules/client/client.schemas.ts`
- Create: `apps/server/src/modules/client/client.events.ts`
- Test: `apps/server/src/modules/client/__tests__/client.schemas.test.ts`

Reference `apps/server/src/modules/auth/auth.schemas.ts` for Zod 4 patterns and `apps/server/src/modules/auth/auth.events.ts` for event patterns.

- [ ] **Step 1: Write schema tests**

Test all validation paths for:
- `createClientSchema`: validates `clientName` (1-255), `redirectUris` (non-empty array of URLs), `grantTypes` (subset of allowed), `scope` (non-empty string), `tokenEndpointAuthMethod` (enum), `isConfidential` boolean
- `updateClientSchema`: all fields optional, same validations
- `clientResponseSchema`: includes all safe fields (no secret hash)
- `clientIdParamSchema`: validates UUID param

- [ ] **Step 2: Implement schemas**

Create `apps/server/src/modules/client/client.schemas.ts` with Zod 4:

Key schemas:
- `createClientSchema` — body for POST /api/admin/clients
- `updateClientSchema` — body for PATCH /api/admin/clients/:id
- `clientResponseSchema` — response shape (excludes `clientSecretHash`)
- `clientListResponseSchema` — array response
- `clientWithSecretResponseSchema` — response for create/rotate (includes plaintext secret once)
- `clientIdParamSchema` — `{ id: z.uuid() }`

Important: `redirectUris` must validate as array of URL strings. `grantTypes` restricted to `['authorization_code', 'refresh_token', 'client_credentials']`. `tokenEndpointAuthMethod` restricted to `['client_secret_basic', 'client_secret_post', 'none']`. `responseTypes` restricted to `['code']`.

- [ ] **Step 3: Implement events**

Create `apps/server/src/modules/client/client.events.ts`:

```typescript
export const CLIENT_EVENTS = {
  CREATED: 'client.created',
  UPDATED: 'client.updated',
  DELETED: 'client.deleted',
  SECRET_ROTATED: 'client.secret_rotated',
} as const;
```

With corresponding payload interfaces.

- [ ] **Step 4: Run schema tests**

```bash
cd apps/server && pnpm vitest run src/modules/client/__tests__/client.schemas.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(client): add OAuth client schemas and events"
```

---

## Task 5: Client Module — Service + Tests

**Files:**
- Create: `apps/server/src/modules/client/client.service.ts`
- Create: `apps/server/src/modules/client/__tests__/client.factory.ts`
- Test: `apps/server/src/modules/client/__tests__/client.service.test.ts`
- Test: `apps/server/src/modules/client/__tests__/client.service.integration.test.ts`

Reference `apps/server/src/modules/auth/auth.service.ts` for service pattern (pure functions + `createXxxService` factory).

- [ ] **Step 1: Create test factory**

Create `apps/server/src/modules/client/__tests__/client.factory.ts` with `buildCreateClientInput()` returning valid defaults.

- [ ] **Step 2: Write unit tests for client service**

Test cases (mocked db):
1. `createClient` — generates `clientId` (random), hashes secret with Argon2, inserts row, returns client + plaintext secret
2. `listClients` — returns all clients without secret hash
3. `getClient` — returns client by id, throws `NotFoundError` if missing
4. `updateClient` — updates allowed fields, throws `NotFoundError` if missing
5. `deleteClient` — deletes client, throws `NotFoundError` if missing
6. `rotateSecret` — generates new secret, hashes it, updates row, returns new plaintext secret
7. `authenticateClient` — verifies `client_secret_basic` and `client_secret_post` methods
8. `getClientByClientId` — looks up by `client_id` field (not PK `id`)

- [ ] **Step 3: Implement client service**

Key implementation details:
- `clientId` generation: `crypto.randomBytes(16).toString('hex')` (32-char hex string)
- `clientSecret` generation: `crypto.randomBytes(32).toString('base64url')` (43-char base64url string)
- Secret hashing: reuse existing `hashPassword` / `verifyPassword` from `apps/server/src/core/password.ts`
- `authenticateClient(db, clientId, clientSecret)` — looks up by `clientId`, verifies secret hash, returns client row or null

- [ ] **Step 4: Run unit tests**

```bash
cd apps/server && pnpm vitest run src/modules/client/__tests__/client.service.test.ts
```

- [ ] **Step 5: Write integration tests**

Test against real DB:
1. Full CRUD lifecycle (create → get → update → list → delete)
2. Secret rotation (create → rotate → verify old secret fails → verify new secret works)
3. Duplicate `clientId` handling
4. `authenticateClient` with correct/incorrect secrets

- [ ] **Step 6: Run integration tests**

```bash
cd apps/server && pnpm vitest run src/modules/client/__tests__/client.service.integration.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(client): implement OAuth client service with tests"
```

---

## Task 6: Client Module — Routes + Tests

**Files:**
- Create: `apps/server/src/modules/client/client.routes.ts`
- Create: `apps/server/src/modules/client/index.ts`
- Modify: `apps/server/src/core/module-loader.ts`
- Test: `apps/server/src/modules/client/__tests__/client.routes.test.ts`
- Test: `apps/server/src/modules/client/__tests__/client.routes.integration.test.ts`

Reference `apps/server/src/modules/account/account.routes.ts` for route pattern. All routes use `preHandler: fastify.requireAdmin`.

- [ ] **Step 1: Write route unit tests**

Test (mocked service):
1. `POST /` — 201 + client with secret
2. `GET /` — 200 + array of clients
3. `GET /:id` — 200 + single client, 404 on missing
4. `PATCH /:id` — 200 + updated client
5. `DELETE /:id` — 204
6. `POST /:id/rotate-secret` — 200 + new secret
7. All routes return 401 without session
8. All routes return 403 without admin flag

- [ ] **Step 2: Implement routes**

Create `apps/server/src/modules/client/client.routes.ts`:

```typescript
export const clientRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db, eventBus } = fastify.container;

  // All routes require admin
  fastify.addHook('onRequest', fastify.requireAdmin);

  // POST / — create client
  // GET / — list clients
  // GET /:id — get client
  // PATCH /:id — update client
  // DELETE /:id — delete client
  // POST /:id/rotate-secret — rotate secret
};
```

- [ ] **Step 3: Create index.ts barrel**

Create `apps/server/src/modules/client/index.ts` exporting routes, service, schemas, events.

- [ ] **Step 4: Register in module-loader**

Add to `apps/server/src/core/module-loader.ts`:

```typescript
import { clientRoutes } from '../modules/client/index.js';
// ...
{ plugin: clientRoutes, prefix: '/api/admin/clients' },
```

- [ ] **Step 5: Run route unit tests**

```bash
cd apps/server && pnpm vitest run src/modules/client/__tests__/client.routes.test.ts
```

- [ ] **Step 6: Write route integration tests**

Full HTTP lifecycle against real DB: create admin user → create client → list → get → update → rotate → delete.

- [ ] **Step 7: Run integration tests**

```bash
cd apps/server && pnpm vitest run src/modules/client/__tests__/client.routes.integration.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(client): add admin client routes with tests"
```

---

## Task 7: Token Module — Signing Key Service

**Files:**
- Create: `apps/server/src/modules/token/signing-key.service.ts`
- Test: `apps/server/src/modules/token/__tests__/signing-key.service.test.ts`
- Test: `apps/server/src/modules/token/__tests__/signing-key.service.integration.test.ts`

- [ ] **Step 1: Write unit tests for signing key service**

Test cases:
1. `generateKeyPair` — generates RSA 2048-bit key pair, returns JWK with `kid`
2. `getActiveSigningKey` — returns the most recently created active key; generates one if none exist
3. `getJwks` — returns all active + recently-rotated keys as JWKS
4. `rotateKey` — marks current active key as `rotated`, generates new active key

- [ ] **Step 2: Implement signing key service**

Key details:
- Use `jose.generateKeyPair('RS256')` to create keys
- Use `jose.exportJWK()` to get JWK representation
- `kid` = `uuidv7()` (unique, sortable)
- In-memory cache: `Map<string, CryptoKey>` keyed by `kid`, refreshed when key not found
- `getActiveSigningKey()` — queries DB for latest active key, caches `CryptoKey` objects
- Store JWK as jsonb in DB (both public and private parts)

```typescript
import * as jose from 'jose';
```

- [ ] **Step 3: Run unit tests**

```bash
cd apps/server && pnpm vitest run src/modules/token/__tests__/signing-key.service.test.ts
```

- [ ] **Step 4: Write and run integration tests**

Test against real DB: generate → get active → rotate → JWKS contains both keys.

```bash
cd apps/server && pnpm vitest run src/modules/token/__tests__/signing-key.service.integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(token): add signing key service with JWKS management"
```

---

## Task 8: Token Module — JWT Service (Access + ID Tokens)

**Files:**
- Create: `apps/server/src/modules/token/jwt.service.ts`
- Create: `apps/server/src/modules/token/token.schemas.ts`
- Test: `apps/server/src/modules/token/__tests__/jwt.service.test.ts`

- [ ] **Step 1: Write unit tests for JWT service**

Test cases:
1. `issueAccessToken` — returns JWT with correct claims (`iss`, `sub`, `aud`, `exp`, `iat`, `jti`, `scope`, `client_id`)
2. `issueIdToken` — returns JWT with OIDC claims (`iss`, `sub`, `aud`, `exp`, `iat`, `nonce`, `auth_time`, `acr`, `amr`, `at_hash`, `sid`)
3. `verifyAccessToken` — validates JWT signature, expiry, issuer
4. `at_hash` calculation — SHA-256 left half of access token hash, base64url encoded
5. Token uses `kid` from active signing key in JWT header
6. Expired token verification returns null/error

- [ ] **Step 2: Create token schemas**

Create `apps/server/src/modules/token/token.schemas.ts` with Zod schemas for token request/response shapes.

- [ ] **Step 3: Implement JWT service**

```typescript
import * as jose from 'jose';
```

Key functions:
- `issueAccessToken(signingKey, params)` — `new jose.SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid }).setIssuedAt().setExpirationTime(exp).setIssuer(iss).setSubject(sub).setAudience(aud).sign(privateKey)`
- `issueIdToken(signingKey, params)` — same pattern with OIDC claims, computes `at_hash`
- `verifyAccessToken(jwks, token)` — `jose.jwtVerify(token, jwks, { issuer, algorithms: ['RS256'] })`
- `computeAtHash(accessToken)` — SHA-256 hash, take left half, base64url encode

- [ ] **Step 4: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/token/__tests__/jwt.service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(token): add JWT issuance and verification service"
```

---

## Task 9: Token Module — Refresh Token Service

**Files:**
- Create: `apps/server/src/modules/token/refresh-token.service.ts`
- Create: `apps/server/src/modules/token/token.events.ts`
- Create: `apps/server/src/modules/token/index.ts`
- Test: `apps/server/src/modules/token/__tests__/refresh-token.service.test.ts`
- Test: `apps/server/src/modules/token/__tests__/refresh-token.service.integration.test.ts`
- Create: `apps/server/src/modules/token/__tests__/token.factory.ts`

- [ ] **Step 1: Write unit tests for refresh token service**

Test cases:
1. `createRefreshToken` — generates opaque token, stores hash in DB, creates `familyId`, returns plaintext
2. `rotateRefreshToken` — finds existing token by hash, checks not revoked, not expired; creates new token in same family; revokes old token; returns new plaintext token
3. `rotateRefreshToken` with reused (already-revoked) token — revokes entire family (all tokens with same `familyId`)
4. `rotateRefreshToken` within grace period — returns same token without revoking (handles concurrent requests)
5. `revokeRefreshToken` — marks token as revoked
6. `revokeAllForClient` — revokes all tokens for a client+user pair

- [ ] **Step 2: Implement refresh token service**

Key details:
- Token format: `crypto.randomBytes(32).toString('base64url')`
- Store SHA-256 hash (same pattern as session tokens)
- `familyId`: set to `uuidv7()` on first issuance; carried forward on rotation
- Grace period: if old token was revoked within `REFRESH_GRACE_PERIOD_SECONDS` ago, and the new token from the same rotation exists, return the existing new token instead of revoking the family
- Replay detection: if token is already revoked AND outside grace period → revoke entire family → throw `UnauthorizedError`

- [ ] **Step 3: Create events and index**

Create `apps/server/src/modules/token/token.events.ts`:

```typescript
export const TOKEN_EVENTS = {
  ACCESS_ISSUED: 'token.access_issued',
  REFRESH_ISSUED: 'token.refresh_issued',
  REFRESH_REVOKED: 'token.refresh_revoked',
  REFRESH_FAMILY_REVOKED: 'token.refresh_family_revoked',
} as const;
```

Create `apps/server/src/modules/token/index.ts` barrel exporting all services, schemas, events.

- [ ] **Step 4: Run unit tests**

```bash
cd apps/server && pnpm vitest run src/modules/token/__tests__/refresh-token.service.test.ts
```

- [ ] **Step 5: Write and run integration tests**

Test against real DB: create → rotate → verify old revoked → replay detection.

```bash
cd apps/server && pnpm vitest run src/modules/token/__tests__/refresh-token.service.integration.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(token): add refresh token service with rotation and replay detection"
```

---

## Task 10: OAuth Module — Schemas + Events

**Files:**
- Create: `apps/server/src/modules/oauth/oauth.schemas.ts`
- Create: `apps/server/src/modules/oauth/oauth.events.ts`
- Test: `apps/server/src/modules/oauth/__tests__/oauth.schemas.test.ts`

- [ ] **Step 1: Write schema tests**

Test validation paths for:
- `authorizeQuerySchema` — `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256`, `nonce` (optional)
- `tokenRequestSchema` — discriminated by `grant_type`: `authorization_code` requires `code`, `redirect_uri`, `code_verifier`; `refresh_token` requires `refresh_token`
- `consentSchema` — `client_id`, `scope`, `decision` (approve/deny)
- `revokeSchema` — `token`, `token_type_hint` (optional)
- `tokenResponseSchema` — `access_token`, `token_type`, `expires_in`, `refresh_token` (optional), `id_token` (optional), `scope`
- `userinfoResponseSchema` — `sub`, plus optional `displayName`, `email`, `emailVerified`

- [ ] **Step 2: Implement schemas**

Create `apps/server/src/modules/oauth/oauth.schemas.ts` with all Zod 4 schemas.

Important: `authorizeQuerySchema` uses `z.object()` (GET querystring). Token endpoint uses `application/x-www-form-urlencoded` — Fastify parses this into an object automatically.

- [ ] **Step 3: Implement events**

Create `apps/server/src/modules/oauth/oauth.events.ts`:

```typescript
export const OAUTH_EVENTS = {
  AUTHORIZATION_CODE_ISSUED: 'oauth.authorization_code_issued',
  TOKEN_EXCHANGED: 'oauth.token_exchanged',
  CONSENT_GRANTED: 'oauth.consent_granted',
  CONSENT_REVOKED: 'oauth.consent_revoked',
} as const;
```

- [ ] **Step 4: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.schemas.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(oauth): add OAuth2/OIDC schemas and events"
```

---

## Task 11: OAuth Module — Service (Authorization + Consent + Token Exchange)

**Files:**
- Create: `apps/server/src/modules/oauth/oauth.service.ts`
- Create: `apps/server/src/modules/oauth/__tests__/oauth.factory.ts`
- Test: `apps/server/src/modules/oauth/__tests__/oauth.service.test.ts`
- Test: `apps/server/src/modules/oauth/__tests__/oauth.service.integration.test.ts`

This is the largest service. It orchestrates Client, Token, Session, and User modules.

- [ ] **Step 1: Write unit tests**

Test cases for `authorize`:
1. Valid request with existing consent → issues auth code → returns redirect URI with `code`, `state`, `iss`
2. Valid request without consent → returns `consent_required` with client info
3. Invalid `client_id` → throws error
4. Invalid `redirect_uri` (not in client's list) → throws error
5. Missing `code_challenge` → throws error
6. Client is suspended → throws error

Test cases for `submitConsent`:
1. Approve → stores consent grant → issues auth code → returns redirect
2. Deny → returns redirect with `error=access_denied`

Test cases for `exchangeToken` (grant_type=authorization_code):
1. Valid code + correct `code_verifier` → issues access token + ID token + refresh token
2. Invalid code → throws error
3. Expired code → throws error
4. Already-used code → throws error
5. Wrong `code_verifier` (PKCE failure) → throws error
6. Wrong `redirect_uri` → throws error
7. Wrong `client_id` → throws error

Test cases for `exchangeToken` (grant_type=refresh_token):
1. Valid refresh token → rotates token → issues new access + ID + refresh tokens
2. Revoked refresh token outside grace → revokes family → throws error
3. Revoked refresh token within grace → returns same new token

Test cases for `revokeToken`:
1. Valid refresh token → revoked
2. Invalid token → no-op (per RFC 7009)

Test cases for `getUserInfo`:
1. Returns `sub` for `openid` scope
2. Returns `displayName` for `profile` scope
3. Returns `email`, `emailVerified` for `email` scope

- [ ] **Step 2: Implement oauth service**

Key implementation details:

**PKCE verification:**
```typescript
import { createHash } from 'node:crypto';

function verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const hash = createHash('sha256').update(codeVerifier).digest('base64url');
  return hash === codeChallenge;
}
```

**Auth code generation:** `crypto.randomBytes(32).toString('base64url')`

**Consent check:** Query `consent_grants` for user+client where `revoked_at IS NULL` and stored scope covers requested scope.

**Token exchange flow:**
1. Look up auth code by hash
2. Verify not expired, not used, correct client, correct redirect_uri
3. Verify PKCE code_challenge matches
4. Mark code as used (`used_at = now()`)
5. Call token module: issue access token, ID token, refresh token
6. Return token response

**Service factory pattern:**
```typescript
export function createOAuthService(deps: OAuthServiceDeps) {
  return {
    authorize: (...) => authorize(deps, ...),
    submitConsent: (...) => submitConsent(deps, ...),
    exchangeToken: (...) => exchangeToken(deps, ...),
    revokeToken: (...) => revokeToken(deps, ...),
    getUserInfo: (...) => getUserInfo(deps, ...),
  };
}
```

Dependencies: `{ db, eventBus, clientService (or inline client lookups), signingKeyService, jwtService, refreshTokenService }`

- [ ] **Step 3: Run unit tests**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.service.test.ts
```

- [ ] **Step 4: Write and run integration tests**

Full lifecycle: create client → create user → authorize → consent → exchange code → refresh → userinfo.

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.service.integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(oauth): implement OAuth service with auth code flow and consent"
```

---

## Task 12: OAuth Module — Routes

**Files:**
- Create: `apps/server/src/modules/oauth/oauth.routes.ts`
- Create: `apps/server/src/modules/oauth/discovery.routes.ts`
- Create: `apps/server/src/modules/oauth/index.ts`
- Modify: `apps/server/src/core/module-loader.ts`
- Test: `apps/server/src/modules/oauth/__tests__/oauth.routes.test.ts`
- Test: `apps/server/src/modules/oauth/__tests__/discovery.routes.test.ts`

- [ ] **Step 1: Write route unit tests**

Test cases for `oauth.routes.ts`:
1. `GET /authorize` — 302 redirect with code (has consent) or consent_required response
2. `POST /token` (auth code) — 200 + token response
3. `POST /token` (refresh) — 200 + token response
4. `POST /consent` — 302 redirect
5. `POST /revoke` — 200
6. `GET /userinfo` — 200 + user claims (requires Bearer token)
7. Client authentication: `client_secret_basic` (Authorization header) and `client_secret_post` (body params)

Test cases for `discovery.routes.ts`:
1. `GET /.well-known/openid-configuration` — 200 + correct metadata
2. `GET /.well-known/jwks.json` — 200 + JWKS

- [ ] **Step 2: Implement oauth routes**

`oauth.routes.ts` handles:
- `GET /authorize` — session required (user must be logged in), validates query, calls `authorize()`
- `POST /token` — client auth (Basic or POST body), no session needed
- `POST /consent` — session required
- `POST /revoke` — client auth
- `GET /userinfo` — Bearer JWT token (verify with JWKS)

Client authentication helper (extract from Basic header or body):
```typescript
function extractClientCredentials(request: FastifyRequest): { clientId: string; clientSecret: string } | null {
  // Check Authorization: Basic base64(clientId:clientSecret)
  // Fall back to body params client_id + client_secret
}
```

**Important:** `/oauth/token` accepts `application/x-www-form-urlencoded`. Fastify handles this with `@fastify/formbody` — check if installed, or use content type parser.

- [ ] **Step 3: Implement discovery routes**

`discovery.routes.ts`:

```typescript
// GET /.well-known/openid-configuration
{
  issuer: env.JWT_ISSUER,
  authorization_endpoint: `${env.JWT_ISSUER}/oauth/authorize`,
  token_endpoint: `${env.JWT_ISSUER}/oauth/token`,
  userinfo_endpoint: `${env.JWT_ISSUER}/oauth/userinfo`,
  revocation_endpoint: `${env.JWT_ISSUER}/oauth/revoke`,
  jwks_uri: `${env.JWT_ISSUER}/.well-known/jwks.json`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
  scopes_supported: ['openid', 'profile', 'email'],
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  code_challenge_methods_supported: ['S256'],
  claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'nonce', 'auth_time', 'acr', 'amr', 'at_hash', 'email', 'email_verified', 'name'],
}

// GET /.well-known/jwks.json
// Returns { keys: [...] } from signingKeyService.getJwks()
```

- [ ] **Step 4: Create index.ts and register modules**

Create `apps/server/src/modules/oauth/index.ts`.

Update `apps/server/src/core/module-loader.ts`:

```typescript
import { discoveryRoutes, oauthRoutes } from '../modules/oauth/index.js';
// ...
{ plugin: clientRoutes, prefix: '/api/admin/clients' },
{ plugin: oauthRoutes, prefix: '/oauth' },
{ plugin: discoveryRoutes, prefix: '' },  // .well-known at root
```

- [ ] **Step 5: Run route tests**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.routes.test.ts
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/discovery.routes.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(oauth): add OAuth and discovery routes"
```

---

## Task 13: Per-Route CORS for OAuth Endpoints

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/modules/oauth/oauth.routes.ts`
- Modify: `apps/server/src/modules/oauth/discovery.routes.ts`

- [ ] **Step 1: Configure per-route CORS**

Discovery/JWKS endpoints (`/.well-known/*`): `Access-Control-Allow-Origin: *`

OAuth token/revoke endpoints: Dynamic origin from registered client redirect URIs. In the oauth routes plugin, add a `preHandler` or use Fastify's route-level CORS:

```typescript
// In oauth.routes.ts, for POST /token, POST /revoke:
fastify.addHook('onRequest', async (request, reply) => {
  const origin = request.headers.origin;
  if (origin) {
    // Look up if origin matches any registered client's redirect_uri origins
    // If yes, set CORS headers
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Access-Control-Allow-Methods', 'POST');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, DPoP');
    reply.header('Access-Control-Allow-Credentials', 'true');
  }
});
```

For discovery routes:
```typescript
fastify.addHook('onSend', async (_request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
});
```

- [ ] **Step 2: Verify CORS headers in existing route tests**

Add assertions in route tests that check `access-control-allow-origin` header.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(oauth): add per-route CORS for OAuth endpoints"
```

---

## Task 14: Integration Tests — Full Authorization Code Flow

**Files:**
- Test: `apps/server/src/modules/oauth/__tests__/oauth.routes.integration.test.ts`

- [ ] **Step 1: Write end-to-end integration tests**

Test flows against real DB and HTTP:

1. **Full auth code flow:** Register user → make admin → create client → GET /oauth/authorize → POST /oauth/consent (approve) → POST /oauth/token (exchange code) → GET /oauth/userinfo → verify all tokens
2. **Refresh token rotation:** Exchange code → refresh → verify old refresh token revoked → verify new tokens work
3. **PKCE validation:** Correct verifier works, wrong verifier fails
4. **Consent skip:** First authorize triggers consent → second authorize for same scopes skips consent
5. **Token revocation:** Revoke refresh token → refresh fails
6. **Replay detection:** Use revoked refresh token → entire family revoked
7. **Discovery endpoints:** Verify metadata shape, JWKS contains valid keys
8. **acr/amr claims:** Verify ID token contains correct authentication method references

- [ ] **Step 2: Run full integration suite**

```bash
cd apps/server && pnpm vitest run src/modules/oauth/__tests__/oauth.routes.integration.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(oauth): add end-to-end OAuth2/OIDC integration tests"
```

---

## Task 15: Install @fastify/formbody + Final Wiring

**Files:**
- Modify: `apps/server/package.json` (via pnpm)
- Modify: `apps/server/src/app.ts`

The OAuth token endpoint receives `application/x-www-form-urlencoded` bodies. Fastify needs `@fastify/formbody` to parse these.

- [ ] **Step 1: Install @fastify/formbody**

```bash
cd apps/server && pnpm add @fastify/formbody
```

- [ ] **Step 2: Register in app.ts**

```typescript
import formbody from '@fastify/formbody';
// ... after helmet, before rate-limit:
await app.register(formbody);
```

- [ ] **Step 3: Verify all tests pass**

```bash
cd apps/server && pnpm vitest run
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add formbody parser for OAuth token endpoint"
```

---

## Task Dependency Graph

```
Task 1 (infra) ──┐
                  ├── Task 2 (admin bridge)
                  │
                  ├── Task 3 (DB schemas) ──┬── Task 4 (client schemas)
                  │                         │        │
                  │                         │   Task 5 (client service)
                  │                         │        │
                  │                         │   Task 6 (client routes)
                  │                         │
                  │                         ├── Task 7 (signing key service)
                  │                         │        │
                  │                         │   Task 8 (JWT service)
                  │                         │        │
                  │                         │   Task 9 (refresh token service)
                  │                         │
                  │                         └── Task 10 (OAuth schemas)
                  │                                   │
                  │                         Task 11 (OAuth service) ← depends on Tasks 5-9
                  │                                   │
                  │                         Task 12 (OAuth routes)
                  │                                   │
                  │                         Task 13 (CORS)
                  │                                   │
                  │                         Task 14 (integration tests)
                  │
                  └── Task 15 (formbody) — can be done early or late
```

Tasks 4-6 (client) and Tasks 7-9 (token) can run in parallel after Task 3.
Task 11+ must wait for both client and token modules.
