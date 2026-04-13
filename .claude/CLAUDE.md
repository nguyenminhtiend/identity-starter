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

## Coding Behaviour Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Biased toward caution over speed — use judgment for trivial tasks.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria enable independent problem-solving. Weak criteria ("make it work") require constant clarification.
