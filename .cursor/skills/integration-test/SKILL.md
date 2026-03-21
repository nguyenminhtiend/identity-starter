---
name: integration-test
description: >-
  Generate integration tests for this identity-starter project. Use when the
  user asks for integration tests, end-to-end tests, database tests, or wants
  to test services/routes against a real PostgreSQL database. Also trigger when
  the user says "test with real db", "full lifecycle test", or wants to verify
  actual database behavior. Produces vitest integration tests matching the
  project's exact conventions.
---

# Integration Test Skill

Generate integration tests that run against a real PostgreSQL database. These
tests verify that services and routes work correctly with actual data persistence,
transaction behavior, and constraint enforcement.

## Before Writing Tests

1. Read the source file being tested
2. Read the module's schemas and events files
3. Check the module's `__tests__/<module>.factory.ts` for existing factory functions
4. Read `apps/server/src/test/db-helper.ts` and `apps/server/src/test/app-builder.ts` to understand the test infrastructure

## Test File Naming

Integration tests use the `.integration.test.ts` suffix:

| Source file | Test file |
|---|---|
| `<module>.service.ts` | `__tests__/<module>.service.integration.test.ts` |
| `<module>.routes.ts` | `__tests__/<module>.routes.integration.test.ts` |

They live in `apps/server/src/modules/<module>/__tests__/`.

## Formatting Rules (Biome)

- 2-space indent, single quotes, always semicolons, trailing commas everywhere
- Arrow functions always parenthesized: `(x) => x`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- No `any` — use `unknown`
- Always use block statements (braces)
- Line width: 100 characters

## Database Infrastructure

The project uses a template-database pattern for fast, isolated integration tests:

1. **Global setup** (`src/test/setup-integration.ts`): Creates a PostgreSQL template database with all migrations applied — runs once per test suite
2. **Per-file isolation** (`src/test/db-helper.ts`): Each test file creates its own database from the template — fast filesystem copy in PostgreSQL
3. **Cleanup**: Each file tears down its own database in `afterAll`

This means each test file gets a completely clean database, so tests don't interfere with each other.

## Service Integration Tests

Test service functions with a real database. The event bus is still in-memory (that's intentional — events are a side-effect, not the thing being tested).

```typescript
import { ConflictError, NotFoundError } from '@identity-starter/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { USER_EVENTS } from '../user.events.js';
import { makeCreateUserInput } from './user.factory.js';
import {
  createUser,
  findUserByEmail,
  findUserByEmailWithPassword,
  findUserById,
} from '../user.service.js';

let testDb: TestDb;
let eventBus: InMemoryEventBus;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.teardown();
});

beforeEach(() => {
  eventBus = new InMemoryEventBus();
});

describe('createUser', () => {
  it('creates a user and returns it', async () => {
    const input = makeCreateUserInput();
    const user = await createUser(testDb.db, eventBus, input);

    expect(user.email).toBe(input.email);
    expect(user.displayName).toBe(input.displayName);
    expect(user.id).toBeDefined();
  });

  it('sets correct default values', async () => {
    const input = makeCreateUserInput();
    const user = await createUser(testDb.db, eventBus, input);

    expect(user.emailVerified).toBe(false);
    expect(user.status).toBe('pending_verification');
    expect(user.metadata).toEqual({});
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });

  it('throws ConflictError on duplicate email', async () => {
    const input = makeCreateUserInput();
    await createUser(testDb.db, eventBus, input);

    await expect(createUser(testDb.db, eventBus, input)).rejects.toThrow(ConflictError);
  });
});
```

### Service Integration Test Setup

Follow this pattern exactly:
1. `let testDb: TestDb` — file-level variable
2. `let eventBus: InMemoryEventBus` — file-level variable
3. `beforeAll`: call `createTestDb()` to get an isolated database
4. `afterAll`: call `testDb.teardown()` to drop the test database
5. `beforeEach`: create a fresh `InMemoryEventBus()`
6. Use `testDb.db` as the database argument to service functions

### What to Cover in Service Integration Tests

- **CRUD operations**: create, read (by id, by email, etc.), update, delete
- **Default values**: verify database defaults are applied correctly
- **Unique constraints**: duplicate values throw `ConflictError`
- **Not found**: non-existent records throw `NotFoundError`
- **Event emission**: subscribe to event bus, verify events are published with correct payload
- **Nullable/optional fields**: verify null storage and retrieval
- **Complex data types**: jsonb metadata, arrays, nested objects round-trip correctly
- **Sensitive fields**: `passwordHash` excluded from safe queries, included in `WithPassword` variants

## Route Integration Tests

Test the full HTTP request/response cycle with a real database. Use `buildTestApp` from the test helpers.

```typescript
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/app-builder.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { makeCreateUserInput } from './user.factory.js';

let testDb: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  testDb = await createTestDb();
  app = await buildTestApp({ db: testDb.db });
});

afterAll(async () => {
  await app.close();
  await testDb.teardown();
});

describe('POST /api/users', () => {
  it('returns 201 with created user', async () => {
    const input = makeCreateUserInput();
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: input,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.email).toBe(input.email);
    expect(body.displayName).toBe(input.displayName);
    expect(body.id).toBeDefined();
    expect(body).not.toHaveProperty('passwordHash');
  });

  it('returns 409 on duplicate email', async () => {
    const input = makeCreateUserInput();
    await app.inject({ method: 'POST', url: '/api/users', payload: input });

    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: input,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toHaveProperty('error');
  });
});
```

### Route Integration Test Setup

1. `let testDb: TestDb` and `let app: FastifyInstance` — file-level
2. `beforeAll`: create test DB, then build test app with that DB
3. `afterAll`: close the app first, then teardown the database (order matters)
4. Use `app.inject()` for all requests

### What to Cover in Route Integration Tests

- **Success paths**: correct status codes, response body matches input
- **Duplicate/conflict**: real unique constraint violations → 409
- **Not found**: non-existent resources → 404
- **Validation**: missing fields → 400, invalid formats → 400
- **Full lifecycle**: create then retrieve, verify consistency
- **Sensitive data exclusion**: response body should never contain `passwordHash`
- **Edge cases**: empty body → 400, malformed UUIDs → 400

## Full Lifecycle Tests

Always include a lifecycle test that exercises the create-then-read flow:

```typescript
describe('full lifecycle', () => {
  it('create then retrieve returns consistent data', async () => {
    const input = makeCreateUserInput({ metadata: { source: 'test' } });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: input,
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/users/${created.id}`,
    });

    expect(getResponse.statusCode).toBe(200);
    const fetched = getResponse.json();

    expect(fetched.id).toBe(created.id);
    expect(fetched.email).toBe(created.email);
    expect(fetched.displayName).toBe(created.displayName);
  });
});
```

## Factory Functions

Each module owns its factories at `__tests__/<module>.factory.ts`. Uses `@faker-js/faker` for realistic, unique test data. Import from `./module.factory.js` (relative to `__tests__/`). See the `unit-test` skill for the full factory pattern.

## Vitest Config Context

Integration tests are matched by `src/**/*.integration.test.ts`. They run with:
- `testTimeout: 30_000` (longer than unit tests — database operations)
- `hookTimeout: 30_000`
- `globalSetup: ['src/test/setup-integration.ts']` — creates the template database
- `pool: 'forks'` — process isolation between test files
- `sequence: { concurrent: false }` — tests run sequentially within a file

## Important Notes

- Each test file gets its own database — no shared state between files
- `beforeEach` does NOT reset the database — if you need isolation between tests within a file, design tests to use unique input data (the factory counter handles this)
- The `buildTestApp` function sets `logger: false` and calls `app.ready()` before returning
- Always close the app before tearing down the database in `afterAll`
