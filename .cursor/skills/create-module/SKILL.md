---
name: create-module
description: >-
  Scaffold a new module in this identity-starter project. Use when the user asks
  to create a new module, add a new domain, scaffold module files, or says
  anything like "new module", "add module", "create <name> module". Also trigger
  for "I need a new domain for X" or "set up the <name> feature". Generates all
  required files following the project's modular monolith conventions.
---

# Create Module Skill

Scaffold a complete module in `apps/server/src/modules/<name>/` following the
project's modular monolith architecture. Each module is a self-contained Fastify
plugin with strict boundaries.

## Before Creating

1. Confirm the module name with the user (singular, lowercase, e.g., `session`, `token`, `role`)
2. Ask what entities/resources this module manages
3. Ask what operations are needed (CRUD, custom actions)
4. Read the `zod-v4` skill (`.cursor/skills/zod-v4/SKILL.md`) — this project uses Zod 4 syntax
5. Check `packages/db/src/schema/` for existing DB schemas to avoid conflicts

## Module Directory Structure

```
apps/server/src/modules/<name>/
  <name>.schemas.ts     — Zod validation schemas + TypeScript interfaces
  <name>.service.ts     — Business logic, throws domain errors, emits events
  <name>.routes.ts      — Fastify routes (HTTP layer)
  <name>.events.ts      — Event constants and payload types
  index.ts              — Public API barrel export
  __tests__/
    <name>.factory.ts   — Test factories using @faker-js/faker
    <name>.schemas.test.ts
    <name>.service.test.ts
    <name>.routes.test.ts
    <name>.service.integration.test.ts
    <name>.routes.integration.test.ts
```

## Formatting Rules (Biome)

- 2-space indent, single quotes, always semicolons, trailing commas everywhere
- Arrow functions always parenthesized: `(x) => x`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- No `any` — use `unknown`
- No `console.*` — use pino logger
- Always use block statements (braces)
- Line width: 100 characters

## Step 1: Database Schema

Create `packages/db/src/schema/<name>.ts`:

```typescript
import { getTableColumns, sql } from 'drizzle-orm';
import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  // ... domain-specific columns
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Exclude sensitive columns from default queries
const { sensitiveField: _, ...sessionColumns } = getTableColumns(sessions);

export { sessionColumns };
```

Key patterns:
- UUIDs use `uuidv7()` via SQL default
- Timestamps: `created_at` and `updated_at` with `defaultNow()`
- Column names use snake_case in the database
- Use `getTableColumns()` to create a safe subset excluding sensitive fields
- Export both the full table (for internal service use) and safe columns (for public queries)

Then export from `packages/db/src/schema/index.ts`:
```typescript
export { sessionColumns, sessions } from './session.js';
```

Also export from `packages/db/src/index.ts` if there's a top-level barrel.

After creating the schema, generate a migration:
```bash
pnpm db:generate
```

## Step 2: Schemas (Zod Validation)

Create `<name>.schemas.ts` — this file contains both Zod schemas and TypeScript interfaces.

```typescript
import { z } from 'zod';

// TypeScript interfaces define the domain shape
export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Zod schemas validate input — use Zod 4 syntax
export const createSessionSchema = z.object({
  userId: z.uuid(),
  expiresAt: z.iso.datetime(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const sessionIdParamSchema = z.object({
  id: z.uuid(),
});
```

Important:
- Use Zod 4 top-level validators: `z.email()`, `z.uuid()`, `z.url()` — NOT `z.string().email()`
- Records always need two args: `z.record(z.string(), z.unknown())`
- Error customization uses `{ error: '...' }` not `{ message: '...' }`
- Export both the interface AND the Zod schema + inferred type

## Step 3: Events

Create `<name>.events.ts`:

```typescript
import type { Session } from './<name>.schemas.js';

export const SESSION_EVENTS = {
  CREATED: 'session.created',
  DELETED: 'session.deleted',
} as const;

export interface SessionCreatedPayload {
  session: Session;
}

export interface SessionDeletedPayload {
  sessionId: string;
}
```

Pattern: `<MODULE>_EVENTS` constant object with `<module>.<action>` string values.

## Step 4: Service

Create `<name>.service.ts`:

```typescript
import { ConflictError, NotFoundError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { sessionColumns, sessions } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { SESSION_EVENTS } from './<name>.events.js';
import type { CreateSessionInput, Session } from './<name>.schemas.js';

// Row mapping functions — convert DB rows to domain types
type SafeRow = typeof sessionColumns;
type SafeRowResult = { [K in keyof SafeRow]: SafeRow[K]['_']['data'] };

function mapToSession(row: SafeRowResult): Session {
  return {
    id: row.id,
    // ... map each field
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createSession(
  db: Database,
  eventBus: EventBus,
  input: CreateSessionInput,
): Promise<Session> {
  const [row] = await db
    .insert(sessions)
    .values({
      // ... map input to DB values
    })
    .returning(sessionColumns);

  const session = mapToSession(row);
  await eventBus.publish(createDomainEvent(SESSION_EVENTS.CREATED, { session }));
  return session;
}

export async function findSessionById(db: Database, id: string): Promise<Session> {
  const [row] = await db.select(sessionColumns).from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!row) {
    throw new NotFoundError('Session', id);
  }
  return mapToSession(row);
}
```

Key patterns:
- Functions take `db: Database` and `eventBus: EventBus` as first arguments (dependency injection, not class-based)
- Throw `NotFoundError`, `ConflictError`, `ValidationError` from `@identity-starter/core` — never throw generic errors for business logic
- Use `returning(safeColumns)` to exclude sensitive fields from results
- Emit domain events after successful operations
- Map DB rows to domain types via explicit mapping functions

## Step 5: Routes

Create `<name>.routes.ts`:

```typescript
import type { FastifyPluginAsync } from 'fastify';
import { validate } from '../../core/validate.js';
import type { CreateSessionInput } from './<name>.schemas.js';
import { createSessionSchema, sessionIdParamSchema } from './<name>.schemas.js';
import { createSession, findSessionById } from './<name>.service.js';

export const sessionRoutes: FastifyPluginAsync = async (fastify) => {
  const { db } = fastify.container;
  const { eventBus } = fastify;

  fastify.post(
    '/',
    { preHandler: validate({ body: createSessionSchema }) },
    async (request, reply) => {
      const session = await createSession(db, eventBus, request.body as CreateSessionInput);
      return reply.status(201).send(session);
    },
  );

  fastify.get(
    '/:id',
    { preHandler: validate({ params: sessionIdParamSchema }) },
    async (request) => {
      const { id } = request.params as { id: string };
      return findSessionById(db, id);
    },
  );
};
```

Key patterns:
- Export as `const <name>Routes: FastifyPluginAsync`
- Destructure `db` from `fastify.container` and `eventBus` from `fastify`
- Use `validate()` preHandler for all input validation
- Cast `request.body` and `request.params` to the appropriate types
- POST returns 201 via `reply.status(201).send()`
- GET returns the result directly (Fastify sends 200 by default)

## Step 6: Barrel Export

Create `index.ts`:

```typescript
export { sessionRoutes } from './<name>.routes.js';
export * from './<name>.schemas.js';
export {
  createSession,
  findSessionById,
} from './<name>.service.js';
```

Only export what other modules might need:
- The routes plugin (for module-loader registration)
- All schemas and types (other modules may need to reference them)
- Service functions that represent the public API

Do NOT export events or internal helpers.

## Step 7: Register Module

Add to `apps/server/src/core/module-loader.ts`:

```typescript
import { sessionRoutes } from '../modules/session/index.js';

export async function registerModules(app: FastifyInstance) {
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(sessionRoutes, { prefix: '/api/sessions' });
}
```

## Step 8: Factory Functions

Create a factory file at `apps/server/src/modules/<name>/__tests__/<name>.factory.ts`.
Each module owns its factories — no shared factory file.

Uses `@faker-js/faker` for realistic, unique test data:

```typescript
import { faker } from '@faker-js/faker';
import type { CreateSessionInput, Session } from '../session.schemas.js';

export function makeCreateSessionInput(
  overrides?: Partial<CreateSessionInput>,
): CreateSessionInput {
  return {
    userId: faker.string.uuid(),
    expiresAt: faker.date.future().toISOString(),
    ...overrides,
  };
}

export function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    token: faker.string.alphanumeric(64),
    expiresAt: faker.date.future(),
    createdAt: faker.date.recent(),
    updatedAt: faker.date.recent(),
    ...overrides,
  };
}
```

## Step 9: Tests

Create all test files following the `unit-test` and `integration-test` skills. Refer to those skills for the exact patterns and coverage requirements. At minimum, create:

1. `__tests__/<name>.schemas.test.ts` — schema validation tests
2. `__tests__/<name>.service.test.ts` — event and domain logic unit tests
3. `__tests__/<name>.routes.test.ts` — route unit tests with mocked service
4. `__tests__/<name>.service.integration.test.ts` — service tests with real DB
5. `__tests__/<name>.routes.integration.test.ts` — route tests with real DB

## Step 10: Generate Migration and Verify

```bash
pnpm db:generate          # Generate Drizzle migration
pnpm biome check .        # Verify formatting
pnpm turbo test           # Run all tests
```

## Checklist

Before considering the module complete:
- [ ] DB schema created in `packages/db/src/schema/` and exported
- [ ] Migration generated with `pnpm db:generate`
- [ ] Schemas file with Zod 4 syntax
- [ ] Events file with constants and payload types
- [ ] Service file with all operations
- [ ] Routes file as Fastify plugin
- [ ] Barrel export in `index.ts`
- [ ] Module registered in `core/module-loader.ts`
- [ ] Factory file created at `__tests__/<name>.factory.ts` using `@faker-js/faker`
- [ ] All 5 test files created with comprehensive coverage
- [ ] `pnpm biome check .` passes
- [ ] `pnpm turbo test` passes
