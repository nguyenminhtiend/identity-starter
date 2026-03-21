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
5. Routes use **`fastify-type-provider-zod` v6** with the Fastify Zod type provider — validation and types come from `schema: { body, params, querystring, response }`, not a custom preHandler (**`validate.ts` is removed**)

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

### 1. Define Request Schemas (Zod 4)

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

**User creation (`createUserSchema`)** does **not** include `passwordHash` or other credential material — public user creation is profile fields only; passwords are set via the **auth register** flow.

**For URL parameters:**
```typescript
export const fooIdParamSchema = z.object({
  id: z.uuid(),
});
```

**For query strings (list/search)** — use the `querystring` key in the route `schema` object (Fastify convention). The handler receives coerced query values on `request.query` (typed by the provider):
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

### 2. Define Response Schemas (Zod 4)

Each module should expose Zod schemas for **every response shape** the routes return. This wires into `fastify-type-provider-zod` serialization and **reduces accidental data leaks** (e.g. `passwordHash`) because the HTTP contract is explicit.

**Single resource:**
```typescript
export const fooResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
```

**List payload (example):**
```typescript
export const listFoosResponseSchema = z.object({
  items: z.array(fooResponseSchema),
  total: z.number().int().nonnegative(),
});
```

**Empty body (e.g. 204):** keep a tiny exported schema next to the others when you need a declared serializer shape:
```typescript
export const noContentSchema = z.undefined();
```

Reference these under `response` in each route (`200`, `201`, `204`, etc.).

### 3. Add Event (if the operation produces side effects)

Add to `<module>.events.ts`:
```typescript
export const FOO_EVENTS = {
  CREATED: 'foo.created',
  UPDATED: 'foo.updated',
  DELETED: 'foo.deleted',
} as const;
```

### 4. Implement the Service Function

Add to `<module>.service.ts`. Service functions follow these conventions.

**Unique constraints (no SELECT-before-INSERT):** Run the `insert` and catch Postgres unique violations (`23505`), including when Drizzle wraps the driver error (`cause.code === '23505'`). Use:

```typescript
function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const pgCode = (error as { code?: string }).code;
  if (pgCode === '23505') {
    return true;
  }
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === '23505';
}
```

(Keep this helper private to the service file, or extract to a small shared DB utility if several modules need it.)

**Create:**
```typescript
export async function createFoo(
  db: Database,
  eventBus: EventBus,
  input: CreateFooInput,
): Promise<Foo> {
  let row: SafeRowResult;
  try {
    [row] = await db.insert(foos).values({ ...input }).returning(fooColumns);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('Foo', 'email', input.email);
    }
    throw error;
  }

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

**Update:** If the table defines `updatedAt` with `.$onUpdate(() => new Date())` in Drizzle, you typically **do not** need to pass `updatedAt` in `.set()` unless you have a special case.

```typescript
export async function updateFoo(
  db: Database,
  eventBus: EventBus,
  id: string,
  input: UpdateFooInput,
): Promise<Foo> {
  const [row] = await db
    .update(foos)
    .set({ ...input })
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

### 5. Database schema (when adding or changing tables)

Follow the `create-db-schema` skill. Timestamp columns use **timezone-aware** timestamps and `updatedAt` uses Drizzle's `.$onUpdate`:

```typescript
createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
updatedAt: timestamp('updated_at', { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date()),
```

### 6. Add the Route

Add to `<module>.routes.ts`:

- Use **`FastifyPluginAsyncZod`** from `fastify-type-provider-zod`, not `FastifyPluginAsync` from `fastify`
- Pass Zod schemas in **`schema`** (`body`, `params`, `querystring`, **`response`**)
- Do **not** import or use `validate` — it no longer exists
- Do **not** cast `request.body` or `request.params` with `as SomeType` — the type provider infers types from the schema
- Use `preHandler: fastify.requireSession` (or a module-level `addHook('onRequest', fastify.requireSession)`) **only** for session gating — separate from Zod validation

```typescript
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  createFooSchema,
  fooIdParamSchema,
  fooResponseSchema,
  listFoosQuerySchema,
  listFoosResponseSchema,
  noContentSchema,
  updateFooSchema,
} from './foo.schemas.js';
import { createFoo, deleteFoo, findFooById, listFoos, updateFoo } from './foo.service.js';

export const fooRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.container;
  const { eventBus } = fastify;

  fastify.post(
    '/',
    {
      schema: {
        body: createFooSchema,
        response: { 201: fooResponseSchema },
      },
    },
    async (request, reply) => {
      const foo = await createFoo(db, eventBus, request.body);
      return reply.status(201).send(foo);
    },
  );

  fastify.get(
    '/:id',
    {
      schema: {
        params: fooIdParamSchema,
        response: { 200: fooResponseSchema },
      },
    },
    async (request) => {
      return findFooById(db, request.params.id);
    },
  );

  fastify.patch(
    '/:id',
    {
      schema: {
        params: fooIdParamSchema,
        body: updateFooSchema,
        response: { 200: fooResponseSchema },
      },
    },
    async (request) => {
      return updateFoo(db, eventBus, request.params.id, request.body);
    },
  );

  fastify.delete(
    '/:id',
    {
      schema: {
        params: fooIdParamSchema,
        response: { 204: noContentSchema },
      },
    },
    async (request, reply) => {
      await deleteFoo(db, eventBus, request.params.id);
      return reply.status(204).send();
    },
  );

  fastify.get(
    '/',
    {
      schema: {
        querystring: listFoosQuerySchema,
        response: { 200: listFoosResponseSchema },
      },
    },
    async (request) => {
      return listFoos(db, request.query);
    },
  );
};
```

HTTP status code conventions:
- `201` — resource created (POST)
- `200` — success (GET, PATCH, PUT)
- `204` — no content (DELETE and similar)
- `400` — validation error (Zod + `fastify-type-provider-zod` + error handler)
- `404` — not found (thrown as `NotFoundError`)
- `409` — conflict (thrown as `ConflictError`, including after unique violation on insert)

### 7. Update Barrel Export

Add new service functions to `index.ts`.

### 8. Add Factory Functions

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

### 9. Write Unit Tests

Create/update all three unit test files with 100% coverage:

#### Schema Tests (`__tests__/<module>.schemas.test.ts`)

For each new schema (request **and response**), test:
- Valid input (required fields only)
- Valid input (all fields)
- Default values
- Each required field missing
- Each field with invalid type/format
- Boundary values (min/max length)
- Nullable fields accept `null`
- Unknown fields stripped (request object schemas)
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

**Test app setup** (required for Zod routes):

```typescript
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

// ...

app = Fastify({ logger: false });
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.decorate('container', { db: {} as unknown as Container['db'] });
app.decorate('eventBus', new InMemoryEventBus());
```

**Protected routes** (routes that use `fastify.requireSession` or an `onRequest` session hook): mock session **before** `app.ready()`:

```typescript
const mockSession = makeSession();

app.decorate('requireSession', async (request: FastifyRequest) => {
  request.session = mockSession;
  request.userId = mockSession.userId;
});
app.decorateRequest('session', null as unknown as typeof mockSession);
app.decorateRequest('userId', '');
```

Then register `errorHandlerPlugin` and the routes as usual.

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

### 10. Write Integration Tests

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
- Unique constraints enforced via insert + `23505` → `ConflictError` (no duplicate rows)
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
- Duplicate handling (unique constraint → 409)
- Missing resources
- Validation at HTTP boundary (Zod + type provider)
- Sensitive field exclusion (response schemas align with safe DTOs)
- Pagination behavior (if applicable)

## Test Coverage Targets

Every code path should be tested. Specifically:

| Code path | Unit test | Integration test |
|---|---|---|
| Schema valid input | schema test | — |
| Schema invalid input | schema test | route integration |
| Service success | — | service integration |
| Service conflict (unique violation) | — | service integration |
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

- [ ] Zod **request** schemas added with Zod 4 syntax (no `passwordHash` on public user create — use auth register for passwords)
- [ ] Zod **response** schemas added for each HTTP response shape (JSON and empty-body statuses)
- [ ] Service function implemented; unique conflicts handled with **insert + `isUniqueViolation`** (not SELECT-then-insert)
- [ ] Route plugin typed as `FastifyPluginAsyncZod` with `schema: { body?, params?, querystring?, response }` — **no** `validate()` preHandler, **no** `as` casts on `request.body` / `request.params`
- [ ] DB columns use `timestamp(..., { withTimezone: true })` and `updatedAt` uses `.$onUpdate(() => new Date())` when defining new tables
- [ ] Barrel export updated
- [ ] Factory functions added/updated
- [ ] Schema unit tests cover all validation paths (request + response schemas)
- [ ] Service unit tests cover events and domain logic
- [ ] Route unit tests cover all status codes with mocked service; **protected** routes mock `requireSession` and decorate `session` / `userId`
- [ ] Service integration tests verify real DB behavior (including unique violations)
- [ ] Route integration tests verify full HTTP lifecycle
- [ ] `pnpm biome check .` passes
- [ ] `pnpm turbo test` passes
