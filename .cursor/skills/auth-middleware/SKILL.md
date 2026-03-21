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

Implement session-based authentication middleware for Fastify routes. This
project uses opaque Bearer tokens (not JWT) validated against Redis cache with
DB fallback.

## Before Writing

1. Read `apps/server/src/core/plugins/error-handler.ts` to understand how errors map to HTTP status codes
2. Read `apps/server/src/core/validate.ts` to understand the existing `preHandler` pattern
3. Read the session module's service file (for `validateSession` function signature)
4. Read the `redis-integration` skill if you need to understand Redis cache patterns

## Architecture

```
Client → Authorization: Bearer <token>
  → Middleware extracts token
  → validateSession(db, redis, token)
    → Check Redis cache (key: session:{token})
    → Cache miss? Check DB, re-cache on hit
    → Expired? Return null
  → Decorate request with session + userId
  → Route handler has access to request.session and request.userId
```

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
import fp from 'fastify-plugin';
import { validateSession } from '../modules/session/session.service.js';

export const authPlugin = fp(async (fastify) => {
  const { db, redis } = fastify.container;

  fastify.decorateRequest('session', null);
  fastify.decorateRequest('userId', '');

  fastify.decorate('requireSession', async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    const session = await validateSession(db, redis, token);
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
- `decorateRequest` with null/empty defaults (Fastify requires this for JIT optimization)
- Extract token by slicing after `"Bearer "` (7 characters)
- Throw `UnauthorizedError` which the error handler maps to 401
- The `requireSession` function is a preHandler, not an onRequest hook — this allows
  selective application per route

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

## Applying Middleware to Routes

### Route-level (selective — preferred)

Use `preHandler` to protect individual routes:

```typescript
export const accountRoutes: FastifyPluginAsync = async (fastify) => {
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
export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireSession);

  fastify.get('/profile', async (request) => {
    return getProfile(db, request.userId);
  });
};
```

### Mixing public and protected routes

Register public routes in a separate plugin scope, or use route-level preHandler:

```typescript
export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const { db, redis } = fastify.container;
  const { eventBus } = fastify;

  // Public routes — no preHandler
  fastify.post('/login', { preHandler: validate({ body: loginSchema }) }, async (request, reply) => {
    const result = await login(db, redis, eventBus, request.body as LoginInput, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    return reply.status(200).send(result);
  });

  // Protected routes — add requireSession to preHandler array
  fastify.post(
    '/logout',
    { preHandler: fastify.requireSession },
    async (request, reply) => {
      await logout(db, redis, eventBus, request.session.id);
      return reply.status(204).send();
    },
  );

  // Multiple preHandlers — validate + auth
  fastify.post(
    '/change-password',
    { preHandler: [fastify.requireSession, validate({ body: changePasswordSchema })] },
    async (request) => {
      return changePassword(db, eventBus, request.userId, request.body as ChangePasswordInput);
    },
  );
};
```

When combining `requireSession` with `validate()`, pass them as an array.
Order matters: auth first, then validation (so validation errors don't leak to unauthenticated users).

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
import type { Session } from '../../session/session.schemas.js';
import { makeSession } from '../../session/__tests__/session.factory.js';

let app: FastifyInstance;
let mockSession: Session;

beforeAll(async () => {
  mockSession = makeSession();
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('container', { db: {}, redis: {} });
  app.decorate('eventBus', new InMemoryEventBus());

  // Mock the requireSession preHandler
  app.decorate('requireSession', async (request: FastifyRequest) => {
    request.session = mockSession;
    request.userId = mockSession.userId;
  });
  app.decorateRequest('session', null);
  app.decorateRequest('userId', '');

  await app.register(errorHandlerPlugin);
  await app.register(accountRoutes, { prefix: '/api/account' });
  await app.ready();
});
```

This gives every request a valid session without hitting Redis/DB.
To test the 401 path, create a separate test that doesn't set up the mock,
or override `requireSession` to throw.

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
  app = await buildTestApp({ db: testDb.db, redis: testRedis });

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
- [ ] Auth plugin created with `requireSession` decorator
- [ ] Fastify type declarations for `request.session`, `request.userId`, `fastify.requireSession`
- [ ] Auth plugin registered in `app.ts` after container but before modules
- [ ] Protected routes use `{ preHandler: fastify.requireSession }`
- [ ] Unit tests mock `requireSession` via `app.decorate`
- [ ] Integration tests create real sessions and send Bearer tokens
- [ ] 401 responses tested for missing/invalid/expired tokens
