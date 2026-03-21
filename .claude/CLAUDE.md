# Identity Starter — AI Workflow Guide

## Project Overview

Learning + reference implementation of an identity provider (IdP). Modular monolith architecture with strict module boundaries.

## Monorepo Structure

- `apps/server` — Fastify backend (modules live in `src/modules/`)
- `packages/core` — Shared types, Result pattern, domain errors
- `packages/db` — Drizzle ORM schema, migrations, DB client
- `packages/redis` — ioredis client wrapper
- `packages/config` — Shared tsconfig, biome, vitest configs

## Key Commands

```bash
pnpm turbo build          # Build all packages
pnpm turbo test           # Run all tests
pnpm biome check .        # Lint (zero errors expected)
pnpm biome check --write . # Auto-fix lint issues
pnpm --filter server dev  # Start dev server
pnpm db:generate          # Generate Drizzle migrations
pnpm db:migrate           # Run migrations
```

## Architecture Rules

### Module Pattern
- Each module is a Fastify plugin in `apps/server/src/modules/<name>/`
- Public API: `index.ts` barrel exports only types + service interface
- No direct imports between module internals — only through `index.ts`
- Cross-module communication via typed event bus (mitt)
- Each module owns its DB tables — no cross-module direct table access

### Module Internal Layering
```
Routes (HTTP) → Service (Business Logic) → Repository (Data Access)
```

### Result Pattern
- Service methods return `Result<T, DomainError>` — never throw for business logic
- Exceptions reserved for infrastructure failures only
- Routes translate Results to HTTP responses

### Events
- Defined per module (e.g., `user.events.ts`)
- Emitted from service layer after successful operations
- Type-safe via mitt

## Code Style
- **Formatter**: Biome — tabs, single quotes, no semicolons, 100 char line width
- **Imports**: Auto-sorted by Biome (organize imports enabled)
- **TypeScript**: Strict mode, ESNext module, Bundler resolution

## Testing
- **Unit tests**: Mock repository, test service business logic
- **Route tests**: Spin up Fastify with in-memory fakes, test full request/response
- **Integration tests** (Phase 2+): Real PostgreSQL with transaction isolation
- Test files live in `__tests__/` next to the module code
- Run with: `pnpm turbo test`

## When Adding a New Module
1. Create `apps/server/src/modules/<name>/` with:
   - `<name>.schemas.ts` — Zod validation schemas
   - `<name>.types.ts` — TypeScript types (derived from Zod where possible)
   - `<name>.repository.ts` — Drizzle data access
   - `<name>.service.ts` — Business logic, Result returns, event emission
   - `<name>.routes.ts` — Fastify routes
   - `<name>.events.ts` — Event type definitions
   - `index.ts` — Public API barrel
   - `__tests__/` — Tests
2. Add DB schema to `packages/db/src/schema/`
3. Register module in `apps/server/src/infra/module-loader.ts`
4. Add event types to `AllEvents` in `apps/server/src/app.ts`
