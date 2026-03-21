# Server — Detailed Backend Guide

Fastify backend for the Identity Starter IdP. All module code lives in `src/modules/`.

## Directory Structure

```
src/
├── app.ts                    # buildApp() — assembles Fastify with all plugins
├── server.ts                 # Entry point — creates container, starts listening
├── core/
│   ├── container.ts          # Singleton DI container (holds db)
│   ├── container-plugin.ts   # Fastify plugin — decorates app with container
│   ├── env.ts                # Zod-validated env vars (DATABASE_URL, REDIS_URL, PORT, etc.)
│   ├── logger.ts             # Pino logger config (pino-pretty in dev)
│   ├── module-loader.ts      # registerModules() — registers all module routes with prefixes
│   ├── validate.ts           # validate() preHandler — Zod schema validation middleware
│   ├── plugins/
│   │   └── error-handler.ts  # Maps DomainError → HTTP status, ZodError → 400
│   └── index.ts              # Barrel export
├── infra/
│   └── event-bus.ts          # InMemoryEventBus (mitt), DomainEvent type, createDomainEvent()
├── modules/
│   └── user/                 # Reference module — follow this pattern for new modules
│       ├── index.ts
│       ├── user.schemas.ts
│       ├── user.service.ts
│       ├── user.routes.ts
│       ├── user.events.ts
│       └── __tests__/
└── test/
    ├── app-builder.ts        # buildTestApp() — Fastify with real DB, no logging
    ├── db-helper.ts          # createTestDb() — isolated DB per test file via PG templates
    └── setup-integration.ts  # Vitest globalSetup — creates template DB, runs migrations
```

## How to Run

```bash
pnpm --filter server dev              # Start with hot-reload (tsx watch)
pnpm --filter server test             # All tests
pnpm --filter server test:unit        # Unit tests only (fast, no DB)
pnpm --filter server test:integration # Integration tests (needs PostgreSQL)
pnpm --filter server test:watch       # Watch unit tests
```

## Core Patterns

### DI Container

Singleton created once at startup in `server.ts`:

```typescript
const container = createContainer();      // creates { db } from DATABASE_URL
const app = await buildApp({ container });
```

Accessed in routes via Fastify decorator: `fastify.container.db`

### Validation Middleware

`validate()` is a preHandler that parses `body`, `params`, `querystring` with Zod schemas. Returns 400 with field errors on failure.

```typescript
fastify.post('/', { preHandler: validate({ body: createUserSchema }) }, handler);
```

### Error Handling

Services throw `DomainError` subclasses. The error-handler plugin catches them:

| Error class | HTTP status |
|---|---|
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `ValidationError` | 400 |
| `ZodError` | 400 |
| Unhandled | 500 |

Response shape: `{ error: string, code: string }`

### Event Bus

In-memory event bus wrapping mitt. Services publish `DomainEvent` after successful operations.

```typescript
await eventBus.publish(createDomainEvent(USER_EVENTS.CREATED, { user }));
```

`DomainEvent` has: `id` (uuid v7), `eventName`, `occurredOn`, `payload`.

Accessed in routes via `fastify.eventBus`.

### Safe Response Mapping

User service uses `userColumns` (excludes `passwordHash`) for public responses. Separate `findUserByEmailWithPassword()` exists for auth flows.

## Module File Conventions

Every module in `src/modules/<name>/` must have:

| File | Responsibility |
|---|---|
| `<name>.schemas.ts` | Zod schemas + `z.infer<>` types. Types always derived from schemas. |
| `<name>.service.ts` | Business logic as pure async functions (not classes). Receives `db` and `eventBus` as args. Throws `DomainError` for business failures. Emits events after success. |
| `<name>.routes.ts` | Fastify plugin (`FastifyPluginAsync`). Gets `db` from `fastify.container`, `eventBus` from `fastify`. Uses `validate()` preHandler. |
| `<name>.events.ts` | `const <NAME>_EVENTS = { ... } as const` + payload interfaces |
| `index.ts` | Barrel — exports routes, schemas/types, and service functions. No internal implementation details. |
| `__tests__/<name>.factory.ts` | Test factories using `@faker-js/faker`. `make<Entity>(overrides?)` and `makeCreate<Entity>Input(overrides?)` |

### Registering a New Module

1. Create module files following the pattern above
2. Add DB table schema to `packages/db/src/schema/`
3. Register in `src/core/module-loader.ts`: `await app.register(routes, { prefix: '/api/<name>s' })`

## Testing Patterns

### Vitest Config

Dual-project setup in `vitest.config.ts`:
- **unit** project: `src/**/*.test.ts` (excludes `*.integration.test.ts`), 10s timeout
- **integration** project: `src/**/*.integration.test.ts`, 30s timeout, `pool: 'forks'`, sequential, uses `globalSetup`

### Test Factories (`__tests__/<name>.factory.ts`)

Each module has factories co-located in its `__tests__/` folder:

```typescript
export function makeCreateUserInput(overrides?: Partial<CreateUserInput>): CreateUserInput {
  return { email: faker.internet.email(), displayName: faker.person.fullName(), ...overrides };
}

export function makeUser(overrides?: Partial<User>): User {
  return { id: faker.string.uuid(), email: faker.internet.email(), status: 'pending_verification', ...overrides };
}
```

### Unit Tests — Route Layer (`*.routes.test.ts`)

- Mock the service module with `vi.mock('../<name>.service.js')`
- Build minimal Fastify app: decorate with fake container + event bus, register error handler + routes
- Use `app.inject()` for HTTP assertions
- Reset mocks in `beforeEach`
- Test: status codes, response shape, validation errors, error propagation

### Unit Tests — Service Layer (`*.service.test.ts`)

- Mock at the module level (mock the service's own module to intercept internal repository calls)
- Test business logic: duplicate checks, error throwing, event emission
- No database needed

### Integration Tests — Service (`*.service.integration.test.ts`)

- `createTestDb()` in `beforeAll` — real PostgreSQL with isolated DB per file
- `testDb.teardown()` in `afterAll`
- Fresh event bus per test
- Test actual DB operations, constraint violations, event publishing

### Integration Tests — Routes (`*.routes.integration.test.ts`)

- `createTestDb()` + `buildTestApp({ db: testDb.db })` — full Fastify app with real DB
- End-to-end HTTP tests via `app.inject()`
- Test validation + business logic + persistence together

### Test DB Isolation

`createTestDb()` creates a unique PostgreSQL database from a pre-migrated template (fast, no migration overhead per test). Global setup (`setup-integration.ts`) creates the template and runs migrations once. Teardown drops all `test_*` databases.

## Environment Variables

Validated by Zod in `src/core/env.ts`:

| Variable | Type | Default |
|---|---|---|
| `NODE_ENV` | `development \| production \| test` | `development` |
| `PORT` | number | `3000` |
| `HOST` | string | `0.0.0.0` |
| `DATABASE_URL` | URL (required) | — |
| `REDIS_URL` | URL (required) | — |
| `LOG_LEVEL` | pino levels | `info` |

## Dependencies

Key runtime deps: `fastify`, `fastify-type-provider-zod`, `drizzle-orm`, `@node-rs/argon2`, `zod` (v4), `mitt`, `pino`, `uuid`

Key dev deps: `@faker-js/faker`, `vitest` (v4), `tsx`, `postgres` (for test DB management)
