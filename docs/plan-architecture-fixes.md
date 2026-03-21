# Architecture Fixes Plan

> Remaining items from principal backend review. Items 1, 5, 6, 8, 10 already fixed.

---

## Item 2 — Service Factory Pattern (stop threading `db, eventBus` everywhere)

**Problem**: Every service function takes `(db, eventBus, ...)` as first args. Every route handler destructures both and threads them manually. This gets worse with each new dependency (Redis, email service, rate limiter, TOTP service, etc.).

**Fix**: Convert services from free functions to factory-created objects. Dependencies are captured in the closure once.

**Before**:

```ts
// auth.service.ts
export async function register(db: Database, eventBus: EventBus, input: RegisterInput) { ... }
export async function login(db: Database, eventBus: EventBus, input: LoginInput, meta) { ... }

// auth.routes.ts
const { db } = fastify.container;
const { eventBus } = fastify;
const result = await register(db, eventBus, request.body);
```

**After**:

```ts
// auth.service.ts
export interface AuthServiceDeps {
  db: Database;
  eventBus: EventBus;
}

export function createAuthService(deps: AuthServiceDeps) {
  const { db, eventBus } = deps;

  return {
    register: async (input: RegisterInput): Promise<AuthResponse> => { ... },
    login: async (input: LoginInput, meta: LoginMeta): Promise<AuthResponse> => { ... },
    logout: async (sessionId: string, userId: string): Promise<void> => { ... },
    changePassword: async (userId: string, currentSessionId: string, input: ChangePasswordInput): Promise<void> => { ... },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

// auth.routes.ts
const authService = createAuthService({ db: fastify.container.db, eventBus: fastify.eventBus });
const result = await authService.register(request.body);
```

**Scope**: `auth.service.ts`, `user.service.ts`, `session.service.ts`, and their corresponding route files and tests.

**Note**: Session service functions (`validateSession`, `createSession`, etc.) are also consumed by auth service. The auth service factory should accept a `sessionService` dep rather than importing session functions directly — this also helps fix Item 9.

---

## Item 3 — Unify Container (eventBus + Redis inside Container)

**Problem**: Dependencies are accessed inconsistently:
- `fastify.container.db` — via container plugin
- `fastify.eventBus` — via decoration
- Redis — exists as a package but isn't wired in at all

**Fix**: Expand the `Container` interface to hold all infrastructure deps. Remove the separate `eventBus` decoration.

```ts
// container-plugin.ts
export interface Container {
  db: Database;
  eventBus: EventBus;
  redis?: Redis;  // optional until actively used
}
```

**Changes**:
1. `container-plugin.ts` — expand `Container` interface
2. `container.ts` — create eventBus + redis in `createContainer()`
3. `app.ts` — remove `app.decorate('eventBus', ...)`, pass eventBus through container instead
4. All route files — access via `fastify.container.eventBus` instead of `fastify.eventBus`
5. Remove `declare module 'fastify' { interface FastifyInstance { eventBus } }` from `app.ts`
6. `test/app-builder.ts` — update test container to include eventBus

**Depends on**: Do this before or alongside Item 2 (service factories), since factories will take their deps from the container.

---

## Item 4 — Replace `mitt` with `emittery` (async event bus)

**Problem**: `mitt.emit()` is synchronous. The current try/catch in `publish()` only catches sync throws — if a handler returns a rejected Promise, that rejection is silently lost. This is a bug, not a design choice.

**Fix**: Replace `mitt` with `emittery` — purpose-built for async event emission.

```ts
// infra/event-bus.ts
import Emittery from 'emittery';

export class InMemoryEventBus implements EventBus {
  private emitter = new Emittery<Record<string, DomainEvent>>();

  async publish(event: DomainEvent): Promise<void> {
    await this.emitter.emit(event.eventName, event);
    // emittery awaits all handlers and surfaces errors
  }

  subscribe(eventName: string, handler: EventHandler): void {
    this.emitter.on(eventName, handler);
  }

  unsubscribe(eventName: string, handler: EventHandler): void {
    this.emitter.off(eventName, handler);
  }
}
```

**Changes**:
1. `pnpm remove mitt && pnpm add emittery` in `apps/server`
2. Rewrite `infra/event-bus.ts`
3. Update any tests that mock or spy on the event bus

**Alternative (no new dep)**: Write a ~20-line custom implementation that collects handler results via `Promise.allSettled` and logs failures. This avoids adding a dependency for a simple pattern.

---

## Item 7 — Declarative Module Registration

**Problem**: `module-loader.ts` manually imports each module. Every new module requires editing this file and adding an import line. Easy to forget.

**Fix**: Convert to a declarative array. Still explicit (no filesystem magic), but adding a module is one line.

```ts
// core/module-loader.ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

interface ModuleDefinition {
  plugin: FastifyPluginAsync;
  prefix: string;
}

const modules: ModuleDefinition[] = [
  { plugin: (await import('../modules/user/index.js')).userRoutes, prefix: '/api/users' },
  { plugin: (await import('../modules/auth/index.js')).authRoutes, prefix: '/api/auth' },
  // add new modules here — one line each
];

export async function registerModules(app: FastifyInstance) {
  for (const mod of modules) {
    await app.register(mod.plugin, { prefix: mod.prefix });
  }
}
```

**Priority**: Low. This is cosmetic until you have 5+ modules.

---

## Item 9 — Fix Auth Plugin Dependency Direction

**Problem**: `core/plugins/auth.ts` imports `validateSession` directly from `modules/session/session.service.ts`. Core infrastructure should not depend on module code — dependency arrows should point inward (modules → core), not outward (core → modules).

**Fix**: The auth plugin should receive the session validation function via plugin options or from the container, not import it directly.

**Option A — Plugin option**:

```ts
// core/plugins/auth.ts
interface AuthPluginOptions {
  validateSession: (db: Database, token: string) => Promise<Session | null>;
}

export const authPlugin = fp(async (fastify, opts: AuthPluginOptions) => {
  // use opts.validateSession instead of importing it
});

// app.ts — when registering
import { validateSession } from './modules/session/session.service.js';
await app.register(authPlugin, { validateSession });
```

**Option B — Container-based** (pairs with Items 2+3):

If you adopt service factories and a unified container, the session service lives in the container. The auth plugin reads it from there:

```ts
export const authPlugin = fp(async (fastify) => {
  const { sessionService } = fastify.container;
  // use sessionService.validate(token) instead of bare import
});
```

**Recommended**: Option B, since it pairs naturally with Items 2 and 3.

---

## Execution Order

```
Item 3 (unify container)
  └─→ Item 2 (service factories) — depends on unified container
        └─→ Item 9 (fix auth plugin) — falls out naturally from service factories
Item 4 (replace mitt) — independent, do anytime
Item 7 (declarative modules) — independent, lowest priority
```

Suggested sequence: **4 → 3 → 2 → 9 → 7**

Start with 4 (mitt → emittery) since it's isolated and fixes an active bug. Then do 3+2+9 as a batch since they're tightly coupled. Item 7 whenever.
