# Identity Starter

Learning + reference implementation of an identity provider (IdP). Modular monolith, pnpm + Turborepo monorepo, ESM-first.

## Monorepo Layout

| Path | Purpose |
|---|---|
| `apps/server` | Fastify backend — modules in `src/modules/`, has its own detailed CLAUDE.md |
| `apps/admin` | Next.js 16 admin dashboard — user/role/session/audit management, port 3002, has its own CLAUDE.md |
| `apps/web` | Next.js 16 user-facing auth app — login/register/MFA/passkeys/OAuth, port 3100, has its own CLAUDE.md |
| `packages/core` | `Result<T,E>` monad, `DomainError` hierarchy, `Brand<T,B>` nominal types, pagination — has its own CLAUDE.md |
| `packages/db` | Drizzle ORM — schema definitions, `createDb(url)`, migration runner, seed — has its own CLAUDE.md |
| `packages/ui` | Shared UI library — Radix primitives, `serverFetch`/`clientFetch`, shared components — has its own CLAUDE.md |
| `packages/redis` | ioredis wrapper — `createRedisClient(config)`, `healthCheck(client)` |
| `packages/config` | Shared `biome.json`, `tsconfig.base.json`, `vitest.shared.ts` |

## Commands

```bash
pnpm turbo build                # Build all packages
pnpm turbo test                 # Run all tests
pnpm biome check .              # Lint (zero errors expected)
pnpm biome check --write .      # Auto-fix lint issues
pnpm --filter server dev        # Start dev server
pnpm --filter server test:unit  # Server unit tests only
pnpm --filter server test:integration  # Server integration tests (needs DB)
pnpm db:generate                # Generate Drizzle migrations
pnpm db:migrate                 # Run migrations
```

## Code Style (Biome-enforced)

- 2-space indent, single quotes, always semicolons, trailing commas everywhere, LF, 100 char width
- Always-parenthesized arrow functions: `(x) => x`
- `import type` for type-only imports; `node:` protocol for Node.js built-ins
- **Errors**: `noExplicitAny`, `noUnusedImports`, `noUnusedVariables`, `noConsole` (relaxed in tests)
- **TypeScript**: Strict mode, ES2024 target, ESNext module, Bundler resolution

## Architecture Principles

- **Module isolation** — each module is a Fastify plugin; public API via `index.ts` barrel only; no cross-module internal imports
- **Domain errors throw** — services throw `DomainError` subclasses; the error-handler plugin maps them to HTTP status codes
- **Event-driven side effects** — in-memory event bus (mitt); services emit after successful operations
- **Each module owns its DB tables** — no cross-module direct table access
