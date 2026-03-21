---
name: redis-integration
description: >-
  Redis caching and storage patterns for this identity-starter project. Use when
  wiring Redis into the Fastify container, implementing cache-aside patterns,
  storing session data in Redis, managing TTLs, creating Redis key naming
  conventions, or setting up Redis test infrastructure. Also trigger when the
  user says "add Redis", "cache this", "session cache", "Redis test helper",
  "challenge storage", or any task involving ioredis within this project. Covers
  container wiring, cache-aside, TTL management, key naming, and test helpers.
---

# Redis Integration Skill

Integrate Redis (via ioredis) into the identity-starter project for session
caching, challenge storage, and general-purpose caching. The `@identity-starter/redis`
package already exists with `createRedisClient` and `healthCheck` — this skill
covers wiring it into the app and using it in services.

## Before Writing

1. Read `packages/redis/src/client.ts` to understand the existing Redis client factory
2. Read `apps/server/src/core/container.ts` and `container-plugin.ts` for the DI pattern
3. Read `apps/server/src/core/env.ts` for the `REDIS_URL` env variable
4. Read `apps/server/src/test/app-builder.ts` for how the test app is constructed

## Step 1: Wire Redis into the Container

### Update Container Interface

In `apps/server/src/core/container-plugin.ts`:

```typescript
import type { Database } from '@identity-starter/db';
import type { Redis } from 'ioredis';
import fp from 'fastify-plugin';

export interface Container {
  db: Database;
  redis: Redis;
}

export const containerPlugin = fp(async (fastify, opts: { container: Container }) => {
  fastify.decorate('container', opts.container);
});

declare module 'fastify' {
  interface FastifyInstance {
    container: Container;
  }
}
```

### Update Container Factory

In `apps/server/src/core/container.ts`:

```typescript
import { createDb } from '@identity-starter/db';
import { createRedisClient } from '@identity-starter/redis';
import type { Container } from './container-plugin.js';
import { env } from './env.js';

export type { Container } from './container-plugin.js';
export { containerPlugin } from './container-plugin.js';

let instance: Container | null = null;

export const createContainer = (): Container => {
  if (instance) {
    return instance;
  }

  const { db } = createDb(env.DATABASE_URL);
  const redis = createRedisClient({ url: env.REDIS_URL });

  instance = { db, redis };
  return instance;
};
```

### Connect and Disconnect in server.ts

```typescript
const container = createContainer();
await container.redis.connect();

const app = await buildApp({ container, logger: { level: env.LOG_LEVEL } });
await app.listen({ port: env.PORT, host: env.HOST });

// Graceful shutdown
const shutdown = async () => {
  await app.close();
  await container.redis.quit();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

## Step 2: Key Naming Convention

All Redis keys follow a namespaced pattern to avoid collisions:

| Purpose | Key Pattern | TTL | Value |
|---------|------------|-----|-------|
| Session cache | `session:{token}` | Same as session expiry (e.g., 7 days) | JSON-serialized session object |
| WebAuthn challenge | `challenge:{userId}` | 5 minutes | Challenge string |
| Rate limiting (future) | `ratelimit:{ip}:{route}` | Window size | Counter |

Key rules:
- Use `:` as separator (Redis convention for logical namespaces)
- Keep keys short but descriptive
- Always set a TTL — never store permanent keys in cache

## Step 3: Cache-Aside Pattern

The primary pattern for session caching. Read path: check Redis first, fall back
to DB, re-cache on miss. Write path: write to DB first (source of truth), then cache.

### Reading (with cache-aside)

```typescript
import type { Redis } from 'ioredis';

export async function validateSession(
  db: Database,
  redis: Redis,
  token: string,
): Promise<Session | null> {
  // 1. Check Redis cache
  const cached = await redis.get(`session:${token}`);
  if (cached) {
    const session = JSON.parse(cached) as CachedSession;
    if (new Date(session.expiresAt) < new Date()) {
      await redis.del(`session:${token}`);
      return null;
    }
    return deserializeSession(session);
  }

  // 2. Cache miss — check DB
  const [row] = await db
    .select(sessionColumns)
    .from(sessions)
    .where(eq(sessions.token, token))
    .limit(1);

  if (!row) {
    return null;
  }

  const session = mapToSession(row);

  // 3. Check expiry
  if (session.expiresAt < new Date()) {
    return null;
  }

  // 4. Re-cache on miss
  const ttlSeconds = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
  if (ttlSeconds > 0) {
    await redis.set(
      `session:${token}`,
      JSON.stringify(serializeSession(session)),
      'EX',
      ttlSeconds,
    );
  }

  return session;
}
```

### Writing (write-through)

```typescript
export async function createSession(
  db: Database,
  redis: Redis,
  eventBus: EventBus,
  input: CreateSessionInput,
): Promise<{ session: Session; token: string }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs);

  // 1. Write to DB (source of truth)
  const [row] = await db
    .insert(sessions)
    .values({ ...input, token, expiresAt })
    .returning(sessionColumns);

  const session = mapToSession(row);

  // 2. Cache in Redis
  const ttlSeconds = Math.floor(sessionTtlMs / 1000);
  await redis.set(
    `session:${token}`,
    JSON.stringify(serializeSession(session)),
    'EX',
    ttlSeconds,
  );

  await eventBus.publish(createDomainEvent(SESSION_EVENTS.CREATED, { session }));
  return { session, token };
}
```

### Deleting (invalidate both)

```typescript
export async function revokeSession(
  db: Database,
  redis: Redis,
  eventBus: EventBus,
  sessionId: string,
): Promise<void> {
  // 1. Get the token to find the Redis key
  const [row] = await db
    .select({ token: sessions.token })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!row) {
    throw new NotFoundError('Session', sessionId);
  }

  // 2. Delete from Redis
  await redis.del(`session:${row.token}`);

  // 3. Delete from DB
  await db.delete(sessions).where(eq(sessions.id, sessionId));

  await eventBus.publish(createDomainEvent(SESSION_EVENTS.REVOKED, { sessionId }));
}
```

## Step 4: Serialization

Dates don't survive JSON.stringify/parse round-trips. Use explicit serialization:

```typescript
interface CachedSession {
  id: string;
  token: string;
  userId: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

function serializeSession(session: Session): CachedSession {
  return {
    ...session,
    expiresAt: session.expiresAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
  };
}

function deserializeSession(cached: CachedSession): Session {
  return {
    ...cached,
    expiresAt: new Date(cached.expiresAt),
    createdAt: new Date(cached.createdAt),
  };
}
```

## Step 5: Challenge Storage (WebAuthn)

Short-lived values like WebAuthn challenges use simple set/get with a short TTL:

```typescript
const CHALLENGE_TTL = 300; // 5 minutes

export async function storeChallenge(
  redis: Redis,
  userId: string,
  challenge: string,
): Promise<void> {
  await redis.set(`challenge:${userId}`, challenge, 'EX', CHALLENGE_TTL);
}

export async function getAndDeleteChallenge(
  redis: Redis,
  userId: string,
): Promise<string | null> {
  const challenge = await redis.getdel(`challenge:${userId}`);
  return challenge;
}
```

`GETDEL` atomically retrieves and deletes, preventing replay attacks.
If your Redis version doesn't support `GETDEL`, use a Lua script or
`GET` + `DEL` in a pipeline.

## Step 6: Redis Test Infrastructure

### Create test/redis-helper.ts

```typescript
import { createRedisClient } from '@identity-starter/redis';
import type { Redis } from 'ioredis';

const TEST_KEY_PREFIX = 'test:';

export interface TestRedis {
  redis: Redis;
  cleanup: () => Promise<void>;
  teardown: () => Promise<void>;
}

export async function createTestRedis(): Promise<TestRedis> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const redis = createRedisClient({ url: redisUrl });
  await redis.connect();

  // Use a dedicated DB index for tests (DB 1) to isolate from dev data
  await redis.select(1);

  return {
    redis,
    cleanup: async () => {
      await redis.flushdb();
    },
    teardown: async () => {
      await redis.flushdb();
      await redis.quit();
    },
  };
}
```

Using `redis.select(1)` isolates test data from development data (which uses DB 0 by default).
`flushdb` only flushes the selected database, not all databases.

### Update test/app-builder.ts

```typescript
import type { Database } from '@identity-starter/db';
import type { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { Container } from '../core/container-plugin.js';
import type { EventBus } from '../infra/event-bus.js';

export interface BuildTestAppOptions {
  db: Database;
  redis?: Redis;
  eventBus?: EventBus;
}

export async function buildTestApp(options: BuildTestAppOptions): Promise<FastifyInstance> {
  const container: Container = {
    db: options.db,
    redis: options.redis ?? ({} as Redis),
  };

  const app = await buildApp({
    container,
    eventBus: options.eventBus,
    logger: false,
  });

  await app.ready();
  return app;
}
```

When Redis is not provided (e.g., user module tests that don't need it), pass an
empty object cast as `Redis`. This avoids requiring Redis for tests that don't
use caching.

### Using Redis in Integration Tests

```typescript
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { createTestRedis, type TestRedis } from '../../../test/redis-helper.js';

let testDb: TestDb;
let testRedis: TestRedis;

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
});

afterAll(async () => {
  await testRedis.teardown();
  await testDb.teardown();
});

beforeEach(async () => {
  await testRedis.cleanup();
});

describe('session cache', () => {
  it('caches session in Redis on create', async () => {
    const { session, token } = await createSession(
      testDb.db,
      testRedis.redis,
      eventBus,
      input,
    );

    const cached = await testRedis.redis.get(`session:${token}`);
    expect(cached).not.toBeNull();

    const parsed = JSON.parse(cached!);
    expect(parsed.userId).toBe(session.userId);
  });

  it('returns session from cache without hitting DB', async () => {
    // Create session (caches it)
    const { token } = await createSession(testDb.db, testRedis.redis, eventBus, input);

    // Delete from DB directly to prove cache is used
    await testDb.db.delete(sessions);

    // Should still find it via Redis
    const session = await validateSession(testDb.db, testRedis.redis, token);
    expect(session).not.toBeNull();
  });

  it('re-caches on cache miss', async () => {
    const { token } = await createSession(testDb.db, testRedis.redis, eventBus, input);

    // Clear Redis only
    await testRedis.cleanup();

    // Should find in DB and re-cache
    const session = await validateSession(testDb.db, testRedis.redis, token);
    expect(session).not.toBeNull();

    // Verify it was re-cached
    const cached = await testRedis.redis.get(`session:${token}`);
    expect(cached).not.toBeNull();
  });
});
```

### Route Integration Tests with Redis

```typescript
let testDb: TestDb;
let testRedis: TestRedis;
let app: FastifyInstance;

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  app = await buildTestApp({ db: testDb.db, redis: testRedis.redis });
});

afterAll(async () => {
  await app.close();
  await testRedis.teardown();
  await testDb.teardown();
});

beforeEach(async () => {
  await testRedis.cleanup();
});
```

## Token Generation

Use Node.js crypto for generating secure opaque session tokens:

```typescript
import { randomBytes } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}
```

This produces a 43-character URL-safe string with 256 bits of entropy.

## Common Pitfalls

1. **Always set TTL** — `redis.set(key, value, 'EX', seconds)`. Never store without expiry.
2. **Serialize dates explicitly** — `JSON.parse` doesn't restore Date objects.
3. **Handle Redis failures gracefully** — If Redis is down, fall back to DB-only.
   Don't let a cache failure crash the request:
   ```typescript
   try {
     await redis.set(key, value, 'EX', ttl);
   } catch {
     request.log.warn('Redis cache write failed, continuing without cache');
   }
   ```
4. **Don't trust cached data for writes** — Always read from DB for mutations. Cache is only for read optimization.
5. **Use `GETDEL` for one-time values** — Challenges, verification codes, etc.

## Checklist

- [ ] `Container` interface updated with `redis: Redis`
- [ ] `createContainer()` creates Redis client from `env.REDIS_URL`
- [ ] `server.ts` calls `redis.connect()` on startup and `redis.quit()` on shutdown
- [ ] `test/redis-helper.ts` created with `createTestRedis()`
- [ ] `test/app-builder.ts` updated to accept optional Redis
- [ ] Cache-aside pattern implemented (read: Redis → DB → re-cache)
- [ ] Write-through pattern implemented (write DB → cache Redis)
- [ ] Delete pattern implemented (delete Redis + DB)
- [ ] Dates serialized/deserialized explicitly
- [ ] TTLs set on all cached values
- [ ] Integration tests verify cache hit, cache miss, and cache invalidation
