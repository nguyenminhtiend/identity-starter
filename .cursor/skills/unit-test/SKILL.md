---
name: unit-test
description: >-
  Generate unit tests for this identity-starter project. Use when the user asks
  to write unit tests, add test coverage, test a schema/service/route, or
  mentions "unit test" in any context. Also trigger when the user says "test
  this", "add tests", or "cover this with tests" for any module file. Produces
  vitest tests that match the project's exact conventions and biome formatting.
---

# Unit Test Skill

Generate unit tests for the identity-starter project. Tests live in
`apps/server/src/modules/<module>/__tests__/` and follow strict conventions
derived from the existing `user` module tests.

## Before Writing Tests

1. Read the source file being tested to understand its exports and behavior
2. Read the module's `index.ts` barrel to understand public API
3. Check the module's `__tests__/<module>.factory.ts` for existing factory functions
4. Read `zod-v4` skill (`.cursor/skills/zod-v4/SKILL.md`) when testing Zod schemas — this project uses Zod 4 syntax

## Test File Naming

| Source file | Test file |
|---|---|
| `<module>.schemas.ts` | `__tests__/<module>.schemas.test.ts` |
| `<module>.service.ts` | `__tests__/<module>.service.test.ts` |
| `<module>.routes.ts` | `__tests__/<module>.routes.test.ts` |
| `<module>.events.ts` | Tested inside `<module>.service.test.ts` |

Unit tests use the `.test.ts` suffix. Integration tests use `.integration.test.ts` — that's a different skill.

## Formatting Rules (Biome)

These rules are enforced by biome and will fail lint if violated:

- 2-space indent, single quotes, always semicolons, trailing commas everywhere
- Arrow functions always parenthesized: `(x) => x`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins (e.g., `node:crypto`)
- No `any` — use `unknown`
- No `console.*` (relaxed in test files, but prefer avoiding)
- Always use block statements (braces for if/else/for/while)
- Line width: 100 characters

## Schema Tests

Test every Zod schema exported from `<module>.schemas.ts`. Use `safeParse` to test both valid and invalid inputs.

```typescript
import { describe, expect, it } from 'vitest';
import { createUserSchema, userIdParamSchema } from '../user.schemas.js';

describe('createUserSchema', () => {
  const validInput = {
    email: 'test@example.com',
    displayName: 'Test User',
  };

  it('accepts valid input with required fields only', () => {
    const result = createUserSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@example.com');
      expect(result.data.displayName).toBe('Test User');
      expect(result.data.metadata).toEqual({});
    }
  });

  it('rejects missing email', () => {
    const result = createUserSchema.safeParse({ displayName: 'Test' });
    expect(result.success).toBe(false);
  });

  it('strips unknown fields', () => {
    const result = createUserSchema.safeParse({
      ...validInput,
      unknownField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('unknownField');
    }
  });
});
```

### What to Cover in Schema Tests

For each schema, test:
- Valid input with only required fields
- Valid input with all fields (required + optional)
- Default values applied correctly (e.g., `metadata` defaults to `{}`)
- Each required field missing individually
- Each field with invalid type/format (e.g., invalid email, empty string)
- Boundary values (e.g., min/max string length)
- Nullable fields accept `null`
- Unknown fields are stripped (Zod 4 `z.object()` strips by default)
- For `z.uuid()` param schemas: valid UUID, invalid UUID, missing field, empty string

## Service Tests (Unit — Event/Domain Logic)

Unit tests for services focus on event creation and domain logic that doesn't need a database. For tests that hit the database, use the integration test skill instead.

```typescript
import { describe, expect, it } from 'vitest';
import { createDomainEvent } from '../../../infra/event-bus.js';
import { USER_EVENTS } from '../user.events.js';
import { makeUser } from './user.factory.js';

describe('USER_EVENTS', () => {
  it('has CREATED event name', () => {
    expect(USER_EVENTS.CREATED).toBe('user.created');
  });
});

describe('createDomainEvent', () => {
  it('creates event with correct structure', () => {
    const payload = { user: makeUser() };
    const event = createDomainEvent(USER_EVENTS.CREATED, payload);

    expect(event.id).toBeDefined();
    expect(event.eventName).toBe('user.created');
    expect(event.occurredOn).toBeInstanceOf(Date);
    expect(event.payload).toBe(payload);
  });

  it('generates unique event ids', () => {
    const event1 = createDomainEvent('test', {});
    const event2 = createDomainEvent('test', {});
    expect(event1.id).not.toBe(event2.id);
  });
});
```

## Route Tests (Unit — Mocked Service)

Route unit tests mock the service layer with `vi.mock()` and test HTTP behavior in isolation. The service mock goes BEFORE the route import.

```typescript
import { ConflictError, NotFoundError } from '@identity-starter/core';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeUser } from './user.factory.js';

// Mock service BEFORE importing routes
vi.mock('../user.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../user.service.js')>();
  return {
    ...actual,
    createUser: vi.fn(),
    findUserById: vi.fn(),
  };
});

import { userRoutes } from '../user.routes.js';
import { createUser, findUserById } from '../user.service.js';

describe('user routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    app.decorate('container', { db: {} });
    app.decorate('eventBus', new InMemoryEventBus());

    await app.register(errorHandlerPlugin);
    await app.register(userRoutes, { prefix: '/api/users' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.mocked(createUser).mockReset();
    vi.mocked(findUserById).mockReset();
  });

  // ... test cases
});
```

### Route Test Setup Pattern

This setup is important — follow it exactly:
1. Create Fastify instance with `logger: false`
2. Set validator and serializer compilers from `fastify-type-provider-zod`
3. Decorate with `container: { db: {} }` (empty object — service is mocked)
4. Decorate with `eventBus: new InMemoryEventBus()`
5. Register `errorHandlerPlugin` (handles DomainError → HTTP status mapping)
6. Register the module routes with the correct prefix
7. Call `app.ready()`

### What to Cover in Route Tests

For each endpoint:
- **Success path**: correct status code, response body shape, no sensitive fields (e.g., `passwordHash`)
- **Domain errors**: mock service throwing `ConflictError` → 409, `NotFoundError` → 404
- **Validation errors**: missing required fields → 400, invalid format → 400
- **Service call verification**: `expect(serviceFunction).toHaveBeenCalledWith(expect.anything(), ...)`

Use `app.inject()` for requests — never make real HTTP calls.

## Factory Functions

Each module owns its factories at `__tests__/<module>.factory.ts`. Uses `@faker-js/faker` for realistic, unique test data:

```typescript
import { faker } from '@faker-js/faker';
import type { CreateFooInput, Foo } from '../foo.schemas.js';

export function makeCreateFooInput(overrides?: Partial<CreateFooInput>): CreateFooInput {
  return {
    name: faker.commerce.productName(),
    email: faker.internet.email(),
    // ... defaults for all required fields
    ...overrides,
  };
}

export function makeFoo(overrides?: Partial<Foo>): Foo {
  return {
    id: faker.string.uuid(),
    name: faker.commerce.productName(),
    createdAt: faker.date.recent(),
    updatedAt: faker.date.recent(),
    ...overrides,
  };
}
```

Key points:
- Faker generates unique, realistic values per call (no counters needed)
- Every required field has a sensible default
- Overrides via spread at the end
- Import factory from `./module.factory.js` (relative to `__tests__/`)

## Import Conventions

- Import from vitest: `import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest';`
- Import types with `import type`: `import type { FastifyInstance } from 'fastify';`
- Use `.js` extension in relative imports: `import { foo } from '../foo.service.js';`
- Import domain errors from core: `import { ConflictError, NotFoundError } from '@identity-starter/core';`

## Vitest Config Context

Unit tests are matched by `src/**/*.test.ts` excluding `*.integration.test.ts`. They run with:
- `testTimeout: 10_000`
- `hookTimeout: 10_000`
- `globals: true` (but prefer explicit imports for clarity)
- `environment: 'node'`
