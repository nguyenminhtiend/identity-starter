---
name: create-rest-api
description: >-
  Create a complete REST API endpoint with full unit and integration test
  coverage in this identity-starter project. Use when the user asks to add an
  API endpoint, create a route, add a REST resource, implement CRUD operations,
  or says anything like "add GET/POST/PUT/PATCH/DELETE endpoint", "create API
  for X", "I need an endpoint to Y". Also trigger for "add a route to the
  <module> module". Generates production-ready code with 100% test coverage
  following the project's exact conventions and Zod 4 schemas.
---

# Create REST API Skill

Add a complete REST API endpoint to an existing or new module with full unit
and integration test coverage. This skill produces production-ready, fully-tested
code in a single pass.

## Before Writing

1. Determine which module this endpoint belongs to — if the module doesn't exist, use the `create-module` skill first
2. Read the module's existing files: schemas, service, routes, events, tests
3. Read the `zod-v4` skill (`.cursor/skills/zod-v4/SKILL.md`) — Zod 4 syntax is required
4. Read the module's `__tests__/<module>.factory.ts` for existing factory functions
5. Read `apps/server/src/core/validate.ts` to understand the validation middleware

## Formatting Rules (Biome)

- 2-space indent, single quotes, always semicolons, trailing commas everywhere
- Arrow functions always parenthesized: `(x) => x`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- No `any` — use `unknown`
- No `console.*` — use pino logger
- Always use block statements (braces)
- Line width: 100 characters

## Step-by-Step Implementation

### 1. Define the Schema (Zod 4)

Add validation schemas to `<module>.schemas.ts`. Use Zod 4 syntax exclusively.

**For request body (POST/PUT/PATCH):**
```typescript
export const createFooSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.email(),
  type: z.enum(['a', 'b', 'c']),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export type CreateFooInput = z.infer<typeof createFooSchema>;
```

**For URL parameters:**
```typescript
export const fooIdParamSchema = z.object({
  id: z.uuid(),
});
```

**For query strings (list/search):**
```typescript
export const listFoosQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'inactive']).optional(),
});

export type ListFoosQuery = z.infer<typeof listFoosQuerySchema>;
```

**For update (PATCH) — partial body:**
```typescript
export const updateFooSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateFooInput = z.infer<typeof updateFooSchema>;
```

Zod 4 reminders:
- `z.email()`, `z.uuid()`, `z.url()` — top-level, not chained on `z.string()`
- `z.record(z.string(), z.unknown())` — always two arguments
- Error customization: `{ error: '...' }` not `{ message: '...' }`

### 2. Add Event (if the operation produces side effects)

Add to `<module>.events.ts`:
```typescript
export const FOO_EVENTS = {
  CREATED: 'foo.created',
  UPDATED: 'foo.updated',
  DELETED: 'foo.deleted',
} as const;
```

### 3. Implement the Service Function

Add to `<module>.service.ts`. Service functions follow these conventions:

**Create:**
```typescript
export async function createFoo(
  db: Database,
  eventBus: EventBus,
  input: CreateFooInput,
): Promise<Foo> {
  // Check for conflicts
  const existing = await findByUniqueField(db, input.email);
  if (existing) {
    throw new ConflictError('Foo', 'email', input.email);
  }

  const [row] = await db
    .insert(foos)
    .values({ ...input })
    .returning(fooColumns);

  const foo = mapToFoo(row);
  await eventBus.publish(createDomainEvent(FOO_EVENTS.CREATED, { foo }));
  return foo;
}
```

**Read by ID:**
```typescript
export async function findFooById(db: Database, id: string): Promise<Foo> {
  const [row] = await db.select(fooColumns).from(foos).where(eq(foos.id, id)).limit(1);
  if (!row) {
    throw new NotFoundError('Foo', id);
  }
  return mapToFoo(row);
}
```

**Update:**
```typescript
export async function updateFoo(
  db: Database,
  eventBus: EventBus,
  id: string,
  input: UpdateFooInput,
): Promise<Foo> {
  const [row] = await db
    .update(foos)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(foos.id, id))
    .returning(fooColumns);

  if (!row) {
    throw new NotFoundError('Foo', id);
  }

  const foo = mapToFoo(row);
  await eventBus.publish(createDomainEvent(FOO_EVENTS.UPDATED, { foo }));
  return foo;
}
```

**Delete:**
```typescript
export async function deleteFoo(
  db: Database,
  eventBus: EventBus,
  id: string,
): Promise<void> {
  const [row] = await db.delete(foos).where(eq(foos.id, id)).returning({ id: foos.id });
  if (!row) {
    throw new NotFoundError('Foo', id);
  }
  await eventBus.publish(createDomainEvent(FOO_EVENTS.DELETED, { fooId: id }));
}
```

**List with pagination:**
```typescript
export async function listFoos(
  db: Database,
  query: ListFoosQuery,
): Promise<{ items: Foo[]; total: number }> {
  const where = query.status ? eq(foos.status, query.status) : undefined;
  const offset = (query.page - 1) * query.limit;

  const [items, [{ count }]] = await Promise.all([
    db.select(fooColumns).from(foos).where(where).limit(query.limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(foos).where(where),
  ]);

  return {
    items: items.map(mapToFoo),
    total: count,
  };
}
```

### 4. Add the Route

Add to `<module>.routes.ts`:

```typescript
// POST — create resource
fastify.post(
  '/',
  { preHandler: validate({ body: createFooSchema }) },
  async (request, reply) => {
    const foo = await createFoo(db, eventBus, request.body as CreateFooInput);
    return reply.status(201).send(foo);
  },
);

// GET — read by ID
fastify.get(
  '/:id',
  { preHandler: validate({ params: fooIdParamSchema }) },
  async (request) => {
    const { id } = request.params as { id: string };
    return findFooById(db, id);
  },
);

// PATCH — update
fastify.patch(
  '/:id',
  { preHandler: validate({ params: fooIdParamSchema, body: updateFooSchema }) },
  async (request) => {
    const { id } = request.params as { id: string };
    return updateFoo(db, eventBus, id, request.body as UpdateFooInput);
  },
);

// DELETE — remove
fastify.delete(
  '/:id',
  { preHandler: validate({ params: fooIdParamSchema }) },
  async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteFoo(db, eventBus, id);
    return reply.status(204).send();
  },
);

// GET — list with query params
fastify.get(
  '/',
  { preHandler: validate({ querystring: listFoosQuerySchema }) },
  async (request) => {
    return listFoos(db, request.query as ListFoosQuery);
  },
);
```

HTTP status code conventions:
- `201` — resource created (POST)
- `200` — success (GET, PATCH, PUT) — Fastify default, no explicit `.status()` needed
- `204` — no content (DELETE)
- `400` — validation error (handled by `validate()` middleware and error handler)
- `404` — not found (thrown as `NotFoundError`)
- `409` — conflict (thrown as `ConflictError`)

### 5. Update Barrel Export

Add new service functions to `index.ts`.

### 6. Add Factory Functions

Create or update `apps/server/src/modules/<module>/__tests__/<module>.factory.ts`.
Each module owns its factories using `@faker-js/faker`:

```typescript
import { faker } from '@faker-js/faker';
import type { CreateFooInput, Foo } from '../foo.schemas.js';

export function makeCreateFooInput(overrides?: Partial<CreateFooInput>): CreateFooInput {
  return {
    name: faker.commerce.productName(),
    email: faker.internet.email(),
    // ... sensible defaults for all required fields
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

### 7. Write Unit Tests

Create/update all three unit test files with 100% coverage:

#### Schema Tests (`__tests__/<module>.schemas.test.ts`)

For each new schema, test:
- Valid input (required fields only)
- Valid input (all fields)
- Default values
- Each required field missing
- Each field with invalid type/format
- Boundary values (min/max length)
- Nullable fields accept `null`
- Unknown fields stripped
- Param schemas: valid UUID, invalid UUID, missing, empty string

#### Service Unit Tests (`__tests__/<module>.service.test.ts`)

- Event constants have correct values
- `createDomainEvent` produces correct structure
- Unique event IDs

#### Route Unit Tests (`__tests__/<module>.routes.test.ts`)

Mock all service functions with `vi.mock()`:

```typescript
vi.mock('../<module>.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../<module>.service.js')>();
  return {
    ...actual,
    createFoo: vi.fn(),
    findFooById: vi.fn(),
    updateFoo: vi.fn(),
    deleteFoo: vi.fn(),
    listFoos: vi.fn(),
  };
});
```

For each endpoint, test:

**POST:**
- 201 on success, response body shape, no sensitive fields
- 409 on `ConflictError`
- 400 on missing required fields
- 400 on invalid field formats
- Service called with correct args

**GET /:id:**
- 200 on success, response body shape
- 404 on `NotFoundError`
- 400 on invalid UUID
- Service called with correct args

**PATCH /:id:**
- 200 on success
- 404 on `NotFoundError`
- 400 on invalid body
- 400 on invalid UUID

**DELETE /:id:**
- 204 on success
- 404 on `NotFoundError`
- 400 on invalid UUID

**GET / (list):**
- 200 with items array and total
- Default pagination values applied
- Query parameter validation

### 8. Write Integration Tests

#### Service Integration Tests (`__tests__/<module>.service.integration.test.ts`)

```typescript
let testDb: TestDb;
let eventBus: InMemoryEventBus;

beforeAll(async () => { testDb = await createTestDb(); });
afterAll(async () => { await testDb.teardown(); });
beforeEach(() => { eventBus = new InMemoryEventBus(); });
```

Test each service function against the real database:
- CRUD operations work end-to-end
- Default values set correctly
- Unique constraints enforced
- Not found errors thrown
- Events published with correct payload
- Nullable fields round-trip correctly
- Complex data types (jsonb) round-trip correctly

#### Route Integration Tests (`__tests__/<module>.routes.integration.test.ts`)

```typescript
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
```

Test full HTTP lifecycle:
- Create and retrieve consistency
- Duplicate handling
- Missing resources
- Validation at HTTP boundary
- Sensitive field exclusion
- Pagination behavior (if applicable)

## Test Coverage Targets

Every code path should be tested. Specifically:

| Code path | Unit test | Integration test |
|---|---|---|
| Schema valid input | schema test | — |
| Schema invalid input | schema test | route integration |
| Service success | — | service integration |
| Service conflict | — | service integration |
| Service not found | — | service integration |
| Service events | — | service integration |
| Route success | route unit (mocked) | route integration |
| Route validation error | route unit (mocked) | route integration |
| Route domain error | route unit (mocked) | route integration |
| Route service args | route unit (mocked) | — |

## Verification

After implementing everything:

```bash
pnpm biome check .        # Lint passes
pnpm turbo test           # All tests pass
```

## Checklist

- [ ] Zod schemas added with Zod 4 syntax
- [ ] Service function implemented
- [ ] Event constant and payload type added (if applicable)
- [ ] Route added with `validate()` preHandler
- [ ] Barrel export updated
- [ ] Factory functions added/updated
- [ ] Schema unit tests cover all validation paths
- [ ] Service unit tests cover events and domain logic
- [ ] Route unit tests cover all status codes with mocked service
- [ ] Service integration tests verify real DB behavior
- [ ] Route integration tests verify full HTTP lifecycle
- [ ] `pnpm biome check .` passes
- [ ] `pnpm turbo test` passes
