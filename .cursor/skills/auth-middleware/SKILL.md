---
name: auth-middleware
description: >-
  Session-based authentication middleware for Fastify in this identity-starter
  project. Use when creating protected routes, adding session validation,
  extracting Bearer tokens, decorating requests with session/user data, or
  implementing public vs authenticated route patterns. Also trigger when the
  user says "protect this route", "add auth", "require login", "session
  middleware", or "authentication hook". Covers the full pattern from middleware
  creation to testing authenticated routes.
---

# Auth Middleware Skill

Implement session-based authentication middleware for Fastify routes. This project
uses opaque Bearer tokens (not JWT). Tokens are sent raw by the client; the server
stores only a **SHA-256 hash** (base64url) in the database. `validateSession`
receives the raw token, hashes it, and looks up the session by hash.

## Before Writing

1. Read `apps/server/src/core/plugins/error-handler.ts` to understand how errors map to HTTP status codes
2. Read an existing routes file such as `apps/server/src/modules/auth/auth.routes.ts` for the `schema: { body, response }` pattern with `fastify-type-provider-zod`
3. Read the session module's service file (for `validateSession` function signature and hashing behavior)
4. Use the `zod-v4` skill when defining or editing Zod schemas used in route `schema` options

## Architecture

```
Client → Authorization: Bearer <raw-token>
  → Middleware extracts raw token
  → validateSession(db, rawToken)
    → Hash token (SHA-256 → base64url)
    → Query DB by hash
    → Expired? Return null
    → Debounce lastActiveAt update (5min threshold)
  → Decorate request with session + userId
  → Route handler has access to request.session and request.userId
```

Session validation is database-backed only in the current implementation (no Redis
layer for session lookup yet).

The middleware is a Fastify plugin that can be applied at route-level (`preHandler`)
or plugin-level (all routes in a plugin scope).

## Fastify Type Declarations

Add to the session module or a shared types file. The request must be decorated
with session data so route handlers can access it type-safely:

```typescript
import type { Session } from '../modules/session/session.schemas.js';

declare module 'fastify' {
  interface FastifyRequest {
    session: Session;
    userId: string;
  }
}
```

Place this in the file that defines the middleware plugin so the types are
available whenever the plugin is registered.

## The Middleware Plugin

Create as a Fastify plugin using `fastify-plugin` (so it propagates to parent scope):

```typescript
import { UnauthorizedError } from '@identity-starter/core';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Session } from '../../modules/session/session.schemas.js';
import { validateSession } from '../../modules/session/session.service.js';

export const authPlugin = fp(async (fastify) => {
  const { db } = fastify.container;

  fastify.decorateRequest('session', null as unknown as Session);
  fastify.decorateRequest('userId', '');

  fastify.decorate('requireSession', async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }

    const rawToken = authHeader.slice(7);
    const session = await validateSession(db, rawToken);
    if (!session) {
      throw new UnauthorizedError('Invalid or expired session');
    }

    request.session = session;
    request.userId = session.userId;
  });
});
```

Important patterns:

- Use `fp()` wrapper so decorations propagate across plugin scopes
- `decorateRequest` with typed null default (`null as unknown as Session`) and empty `userId` string (Fastify expects defaults for request decorations)
- Extract token by slicing after `"Bearer "` (7 characters); pass the **raw** string to `validateSession` — hashing happens inside the service
- Throw `UnauthorizedError` which the error handler maps to 401
- The `requireSession` function is a preHandler, not an onRequest hook — this allows selective application per route

## UnauthorizedError

Add to `packages/core/src/errors.ts` if it doesn't exist:

```typescript
export class UnauthorizedError extends DomainError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}
```

Add to the error handler's STATUS_MAP:

```typescript
const STATUS_MAP: Record<string, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
};
```

## Route plugin type and validation

Use `FastifyPluginAsyncZod` from `fastify-type-provider-zod` (not `FastifyPluginAsync` from `fastify`). Register `validatorCompiler` and `serializerCompiler` from the same package on the Fastify instance where Zod routes run.

Validate request bodies and declare responses with the route `schema` option; do not use a removed `validate()` helper from core.

## Applying Middleware to Routes

### Route-level (selective — preferred)

Use `preHandler` to protect individual routes:

```typescript
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const accountRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.container;

  fastify.get(
    '/profile',
    { preHandler: fastify.requireSession },
    async (request) => {
      return getProfile(db, request.userId);
    },
  );
};
```

### Plugin-level (all routes in scope)

Use `addHook` to protect every route registered within a plugin:

```typescript
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const accountRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.container;

  fastify.addHook('onRequest', fastify.requireSession);

  fastify.get('/profile', async (request) => {
    return getProfile(db, request.userId);
  });
};
```

### Mixing public and protected routes

Public routes omit `preHandler` and use `schema` for validation. Protected routes use `preHandler: fastify.requireSession`. You can combine both on one route:

```typescript
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const authRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.container;
  const { eventBus } = fastify;

  // Public routes — no preHandler, use schema for validation
  fastify.post(
    '/login',
    {
      schema: { body: loginSchema, response: { 200: authResponseSchema } },
    },
    async (request, reply) => {
      const result = await login(db, eventBus, request.body, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      return reply.status(200).send(result);
    },
  );

  // Protected routes
  fastify.post(
    '/logout',
    { preHandler: fastify.requireSession },
    async (request, reply) => {
      await logout(db, eventBus, request.session.id, request.userId);
      return reply.status(204).send();
    },
  );

  // Protected + validated
  fastify.post(
    '/change-password',
    {
      preHandler: fastify.requireSession,
      schema: { body: changePasswordSchema },
    },
    async (request, reply) => {
      await changePassword(db, eventBus, request.userId, request.session.id, request.body);
      return reply.status(204).send();
    },
  );
};
```

## Registering the Auth Plugin

Register in `app.ts` after the container plugin but before module registration:

```typescript
await app.register(containerPlugin, { container: options.container });
await app.register(errorHandlerPlugin);
await app.register(authPlugin);
// ... then register modules
```

## Fastify Type Declaration for requireSession

Add alongside the auth plugin:

```typescript
declare module 'fastify' {
  interface FastifyInstance {
    requireSession: (request: FastifyRequest) => Promise<void>;
  }
}
```

## Testing Protected Routes

### Unit Tests (mocked service)

In route unit tests, mock the session middleware by decorating the test app:

```typescript
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Container } from '../../../core/container-plugin.js';
import type { Session } from '../../session/session.schemas.js';
import { makeSession } from '../../session/__tests__/session.factory.js';

let app: FastifyInstance;
let mockSession: Session;

beforeAll(async () => {
  mockSession = makeSession();
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('container', { db: {} as unknown as Container['db'] });
  app.decorate('eventBus', new InMemoryEventBus());

  app.decorate('requireSession', async (request: FastifyRequest) => {
    request.session = mockSession;
    request.userId = mockSession.userId;
  });
  app.decorateRequest('session', null as unknown as typeof mockSession);
  app.decorateRequest('userId', '');

  await app.register(errorHandlerPlugin);
  await app.register(accountRoutes, { prefix: '/api/account' });
  await app.ready();
});
```

This gives every request a valid session without hitting the database. To test the
401 path, create a separate test that doesn't set up the mock, or override
`requireSession` to throw.

### Testing 401 responses

To test that routes actually reject unauthenticated requests, either:

1. **Don't set the Authorization header** in integration tests (real middleware runs):

```typescript
it('returns 401 without auth header', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/account/profile',
    // No authorization header
  });
  expect(response.statusCode).toBe(401);
});
```

2. **Set an invalid token**:

```typescript
it('returns 401 with invalid token', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/account/profile',
    headers: { authorization: 'Bearer invalid-token' },
  });
  expect(response.statusCode).toBe(401);
});
```

### Integration Tests (real middleware)

In integration tests, create a real user + session first, then use the token:

```typescript
let testDb: TestDb;
let app: FastifyInstance;
let authToken: string;

beforeAll(async () => {
  testDb = await createTestDb();
  app = await buildTestApp({ db: testDb.db });

  // Create a user and session to get a valid token
  const registerResponse = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'test@example.com', password: 'securepass123', displayName: 'Test' },
  });
  authToken = registerResponse.json().token;
});

it('returns profile for authenticated user', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/account/profile',
    headers: { authorization: `Bearer ${authToken}` },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().email).toBe('test@example.com');
});
```

### Helper for Authenticated Requests

Create a test helper to reduce boilerplate:

```typescript
function authRequest(app: FastifyInstance, token: string) {
  return {
    get: (url: string) =>
      app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }),
    post: (url: string, payload?: unknown) =>
      app.inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${token}` },
        payload,
      }),
    patch: (url: string, payload?: unknown) =>
      app.inject({
        method: 'PATCH',
        url,
        headers: { authorization: `Bearer ${token}` },
        payload,
      }),
    delete: (url: string) =>
      app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${token}` } }),
  };
}
```

## Checklist

- [ ] `UnauthorizedError` added to `@identity-starter/core` and exported
- [ ] Error handler STATUS_MAP includes `UNAUTHORIZED: 401` and `FORBIDDEN: 403`
- [ ] Auth plugin created with `requireSession` decorator (raw token → `validateSession(db, rawToken)`; hashes stored in DB)
- [ ] Fastify type declarations for `request.session`, `request.userId`, `fastify.requireSession`
- [ ] Auth plugin registered in `app.ts` after container but before modules
- [ ] Route modules use `FastifyPluginAsyncZod` and route `schema` for validation (no `validate()` from core)
- [ ] Protected routes use `{ preHandler: fastify.requireSession }`
- [ ] Unit tests mock `requireSession` and use `decorateRequest('session', null as unknown as typeof mockSession)`
- [ ] Integration tests create real sessions and send Bearer tokens
- [ ] 401 responses tested for missing/invalid/expired tokens
