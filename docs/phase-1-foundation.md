# Identity Starter — Phase 1: Foundation

**Status: COMPLETED**

## Context

Build a learning + reference implementation of an identity provider (like Auth0/Keycloak) to deeply understand IdP internals. This is Phase 1 of 4, establishing the monorepo scaffold, shared infrastructure, database layer, and the first module (User Management).

**Phases overview:**
1. **Foundation** (this phase) — Scaffold, DB, Redis, event bus, User module (internal service, no HTTP routes)
2. **Authentication** — Auth API, account self-service API, sessions, passkeys, login UI
3. **OAuth2/OIDC** — Authorization server, client management, token service, consent UI
4. **Admin & Governance** — Admin management API (`/api/admin/*`), RBAC, audit logging, admin dashboard

---

## Technical Stack

| Category | Choice |
|---|---|
| Runtime | Node.js ≥24 |
| Package Manager | pnpm |
| Monorepo | Turborepo |
| Backend Framework | Fastify |
| Frontend Framework | Next.js 15 (Phase 2+) |
| UI Components | shadcn/ui + Tailwind CSS v4 (Phase 2+) |
| Database | PostgreSQL + Drizzle ORM |
| Cache/Sessions | Redis + ioredis |
| Validation | Zod (+ fastify-type-provider-zod) |
| Logging | Pino + pino-pretty |
| Password Hashing | Argon2 (@node-rs/argon2) |
| JWT/JWKS | jose |
| WebAuthn | @simplewebauthn/server |
| Env Config | @t3-oss/env-core + Zod |
| Event Bus | mitt |
| Code Quality | Biome (lint + format) |
| Git Hooks | lefthook |
| Testing | Vitest (unit/integration) + Playwright (E2E) |
| ID Generation | nanoid |
| Date Handling | date-fns |
| Dev Runner | tsx |
| Security | @fastify/cors + @fastify/helmet |

---

## Architecture Decisions

### 1. Module Pattern (Strict Boundaries)
- Each module is a Fastify plugin registered via `module-loader.ts`
- Public API: `index.ts` barrel exports only types + service interface
- No direct imports between module internals — only through public API
- Cross-module communication via typed event bus (mitt)
- Each module owns its DB tables — no cross-module direct table access

### 2. Result Pattern (No Exceptions for Business Logic)
- Service methods return `Result<T, DomainError>` instead of throwing
- Exceptions reserved for unexpected/infrastructure failures only
- Routes translate Results to HTTP responses

### 3. Module Internal Layering
- **Routes**: Zod schema validation, HTTP concerns, call service
- **Service**: Pure business logic, returns Result types, emits events
- **Repository**: Drizzle queries, data mapping

### 4. Event Bus
- In-process typed event emitter using mitt
- Events are defined per module (e.g., `user.created`, `user.updated`)
- Type-safe: all events and payloads are typed
- Synchronous within the same process (can be made async later)

### 5. Database Schema Ownership
- All Drizzle schemas live in `packages/db/src/schema/`
- Each module's tables are in a separate file (e.g., `user.ts`)
- Only the owning module's repository can query its tables
- Cross-module data access goes through service interfaces

---

## DB Schema

### users
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | nanoid |
| email | text | unique, indexed |
| emailVerified | boolean | default false |
| passwordHash | text | nullable (passkey-only users) |
| displayName | text | |
| status | text | 'active' / 'suspended' / 'pending_verification' |
| metadata | jsonb | default {} |
| createdAt | timestamp | |
| updatedAt | timestamp | |

---

## User Module

The User module is an **internal data layer** with no HTTP routes. It exposes service methods consumed by other modules (Auth in Phase 2, Admin API in Phase 4). User management routes appear as admin endpoints (`/api/admin/users/*`) in Phase 4.

### Service Methods (Internal API)
- `create`, `findById`, `findByEmail`, `update`, `delete`
- `list` (paginated)
- `updatePassword`, `verifyEmail`, `suspend`, `activate`

### Events
- `user.created`, `user.updated`, `user.deleted`
- `user.suspended`, `user.activated`, `user.email_verified`

---

## Testing Strategy

### Unit Tests (Vitest)
- Service layer: mock repository, test business logic + Result returns
- Schemas: test Zod validation for edge cases

### Integration Tests (Vitest)
- Service layer: test against real PostgreSQL with test database
- Use transactions for isolation
- Test event bus emissions

### E2E Tests (Playwright) — Phase 2+
- Not needed in Phase 1 (no UI yet)

---

## Environment Variables

| Variable | Example | Purpose |
|----------|---------|---------|
| DATABASE_URL | `postgresql://postgres:postgres@localhost:5432/identity_starter` | PostgreSQL connection |
| REDIS_URL | `redis://localhost:6379` | Redis connection |
| PORT | `3000` | Server port |
| HOST | `0.0.0.0` | Server host |
| NODE_ENV | `development` | Environment |
| LOG_LEVEL | `debug` | Pino log level |

---

## Verification Checklist

- [x] **Build**: `pnpm turbo build` — all packages compile
- [x] **Lint**: `pnpm biome check .` — zero errors
- [x] **Tests**: `pnpm turbo test` — 22 tests passing
- [ ] **DB**: Drizzle migrations run (requires running PostgreSQL)
- [ ] **Server**: `pnpm --filter server dev` starts (requires DB + Redis)
- [ ] **Redis**: Client connects (requires running Redis)

---

## Implementation Notes

- Node.js requirement is `≥24` (per package.json engines field)
- pnpm version pinned to `10.32.1`
- Fastify 5.2, Drizzle 0.38, Vitest 3.0, Biome 1.9
- Git hooks managed by lefthook 1.10
- 4 commits completed for Phase 1 (scaffold → user module → enhancements → formatting)
