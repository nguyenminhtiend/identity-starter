# Identity Starter — Phase 1: Foundation

**Status: COMPLETED**

## Context

Build a learning + reference implementation of an identity provider (like Auth0/Keycloak) to deeply understand IdP internals. This is Phase 1 of 4, establishing the monorepo scaffold, shared infrastructure, database layer, and the first module (User Management).

**Phases overview:**
1. **Foundation** (this phase) — Scaffold, DB, Redis, event bus, User module ✅
2. **Authentication** — Password auth, passkeys/WebAuthn, sessions, login UI
3. **OAuth2/OIDC** — Authorization server, client registry, token service, consent UI
4. **Admin & Governance** — Admin API, RBAC, audit logging, admin dashboard

---

## Technical Stack

| Category | Choice |
|---|---|
| Runtime | Node.js v24 |
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

## Monorepo Structure

```
identity-starter/
├─ apps/
│  └─ server/                      # Fastify IdP backend
│     ├─ src/
│     │  ├─ modules/
│     │  │  └─ user/               # User Management module
│     │  │     ├─ user.service.ts
│     │  │     ├─ user.repository.ts
│     │  │     ├─ user.routes.ts
│     │  │     ├─ user.events.ts
│     │  │     ├─ user.types.ts
│     │  │     ├─ user.schemas.ts
│     │  │     ├─ index.ts
│     │  │     └─ __tests__/
│     │  │        ├─ user.service.test.ts
│     │  │        └─ user.routes.test.ts
│     │  ├─ infra/
│     │  │  ├─ event-bus.ts        # Typed mitt-based event bus
│     │  │  └─ module-loader.ts    # Fastify plugin registration
│     │  ├─ app.ts                 # Fastify app factory
│     │  └─ server.ts              # Entry point
│     ├─ vitest.config.ts
│     ├─ tsconfig.json
│     └─ package.json
├─ packages/
│  ├─ core/                        # Shared types, result pattern, errors
│  │  ├─ src/
│  │  │  ├─ result.ts             # Result<T, E> type
│  │  │  ├─ errors.ts             # Base domain error types
│  │  │  ├─ types.ts              # Shared types (pagination, IDs)
│  │  │  └─ index.ts
│  │  ├─ tsconfig.json
│  │  └─ package.json
│  ├─ db/                          # Drizzle schema + migrations
│  │  ├─ src/
│  │  │  ├─ schema/
│  │  │  │  ├─ user.ts
│  │  │  │  └─ index.ts
│  │  │  ├─ client.ts             # DB connection factory
│  │  │  ├─ migrate.ts            # Migration runner
│  │  │  └─ index.ts
│  │  ├─ drizzle/                  # Generated migrations
│  │  ├─ drizzle.config.ts
│  │  ├─ tsconfig.json
│  │  └─ package.json
│  ├─ redis/                       # Redis client wrapper
│  │  ├─ src/
│  │  │  ├─ client.ts
│  │  │  └─ index.ts
│  │  ├─ tsconfig.json
│  │  └─ package.json
│  └─ config/                      # Shared tooling configs
│     ├─ biome.json
│     ├─ tsconfig.base.json
│     └─ vitest.shared.ts
├─ turbo.json
├─ pnpm-workspace.yaml
├─ biome.json                      # Root extends packages/config
├─ lefthook.yml                    # Git hooks config
├─ .env.example
├─ tsconfig.json                   # Root TS config
├─ .claude/
│  └─ CLAUDE.md                    # AI workflow instructions
└─ package.json
```

---

## Architecture Decisions

### 1. Module Pattern (Strict Boundaries)
- Each module is a Fastify plugin registered via `module-loader.ts`
- Public API: `index.ts` barrel exports only types + service interface
- No direct imports between module internals — only through public API
- Cross-module communication via typed event bus (mitt)
- Each module owns its DB tables — no cross-module direct table access

### 2. Result Pattern (No Exceptions for Business Logic)
```typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }
```
- Service methods return `Result<T, DomainError>` instead of throwing
- Exceptions reserved for unexpected/infrastructure failures only
- Routes translate Results to HTTP responses

### 3. Module Internal Layering
```
Routes (HTTP) → Service (Business Logic) → Repository (Data Access)
```
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

## User Management Module Design

### User Entity
```typescript
interface User {
  id: string              // nanoid
  email: string           // unique, indexed
  emailVerified: boolean
  passwordHash: string | null  // null for passkey-only users
  displayName: string
  status: 'active' | 'suspended' | 'pending_verification'
  metadata: Record<string, unknown>  // JSONB
  createdAt: Date
  updatedAt: Date
}
```

### Service Interface
```typescript
interface UserService {
  create(input: CreateUserInput): Promise<Result<User, UserAlreadyExistsError>>
  findById(id: string): Promise<Result<User, UserNotFoundError>>
  findByEmail(email: string): Promise<Result<User, UserNotFoundError>>
  update(id: string, input: UpdateUserInput): Promise<Result<User, UserNotFoundError>>
  delete(id: string): Promise<Result<void, UserNotFoundError>>
  list(pagination: PaginationInput): Promise<Result<PaginatedResult<User>>>
  updatePassword(id: string, hash: string): Promise<Result<void, UserNotFoundError>>
  verifyEmail(id: string): Promise<Result<void, UserNotFoundError>>
  suspend(id: string): Promise<Result<void, UserNotFoundError>>
  activate(id: string): Promise<Result<void, UserNotFoundError>>
}
```

### Events
```typescript
type UserEvents = {
  'user.created': { user: User }
  'user.updated': { user: User; changes: Partial<User> }
  'user.deleted': { userId: string }
  'user.suspended': { userId: string }
  'user.activated': { userId: string }
  'user.email_verified': { userId: string }
}
```

### API Routes
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/users` | Create user |
| GET | `/api/users/:id` | Get user by ID |
| GET | `/api/users` | List users (paginated) |
| PATCH | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Delete user |
| POST | `/api/users/:id/suspend` | Suspend user |
| POST | `/api/users/:id/activate` | Activate user |

---

## Testing Strategy

### Unit Tests (Vitest)
- Service layer: mock repository, test business logic + Result returns
- Repository layer: test against real PostgreSQL (integration)
- Schemas: test Zod validation for edge cases

### Integration Tests (Vitest)
- Route tests: spin up Fastify instance, test full request/response cycle
- Use real PostgreSQL with test database, transactions for isolation
- Test event bus emissions

### E2E Tests (Playwright) — Phase 2+
- Not needed in Phase 1 (no UI yet)

---

## Environment Variables
```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/identity_starter

# Redis
REDIS_URL=redis://localhost:6379

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=debug
```

---

## Verification Checklist

- [x] **Build**: `pnpm turbo build` — all packages compile
- [x] **Lint**: `pnpm biome check .` — zero errors
- [x] **Tests**: `pnpm turbo test` — 22 tests passing
- [ ] **DB**: Drizzle migrations run (requires running PostgreSQL)
- [ ] **Server**: `pnpm --filter server dev` starts (requires DB + Redis)
- [ ] **Redis**: Client connects (requires running Redis)
