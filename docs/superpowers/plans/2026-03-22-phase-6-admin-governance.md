# Phase 6: Admin & Governance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin user management, role-based access control (RBAC), and an append-only audit log to the identity system.

**Architecture:** Three new modules — RBAC (roles + permissions + assignment), Admin (user/session management via RBAC-protected routes), and Audit (append-only log with hash chain, wired to the event bus). A new `requirePermission(resource, action)` Fastify decorator replaces the boolean `isAdmin` check for new admin routes. Existing `/api/admin/clients` routes keep the old `requireAdmin` decorator unchanged. The `users.isAdmin` column is preserved during transition — existing admin users are backfilled to the `admin` role. Dropping the `isAdmin` column is deferred to a future cleanup phase.

**Tech Stack:** Fastify, Drizzle ORM, Zod 4, Vitest, @identity-starter/core errors

**Prerequisite:** Phase 5 complete (OAuth2/OIDC).
**Phase doc:** `docs/phase-6-admin-governance.md`

---

## File Map

### DB Schema (packages/db)

- Create: `packages/db/src/schema/role.ts` — `roles` table
- Create: `packages/db/src/schema/permission.ts` — `permissions` table
- Create: `packages/db/src/schema/role-permission.ts` — `role_permissions` join table
- Create: `packages/db/src/schema/user-role.ts` — `user_roles` join table
- Create: `packages/db/src/schema/audit-log.ts` — `audit_logs` append-only table
- Modify: `packages/db/src/schema/index.ts` — export new tables
- Modify: `packages/db/src/index.ts` — export new tables

### RBAC Module (apps/server/src/modules/rbac/)

- Create: `rbac.service.ts` — role CRUD, permission CRUD, role assignment, permission checking, seed logic
- Create: `rbac.schemas.ts` — Zod schemas for roles, permissions, assignments
- Create: `rbac.events.ts` — RBAC event constants + payload interfaces
- Create: `index.ts` — barrel exports
- Create: `__tests__/rbac.factory.ts` — test data builders
- Create: `__tests__/rbac.service.test.ts` — unit tests
- Create: `__tests__/rbac.service.integration.test.ts` — DB integration tests
- Create: `__tests__/rbac.schemas.test.ts` — schema validation tests

### Admin Module (apps/server/src/modules/admin/)

- Create: `admin.service.ts` — user list/detail/suspend/activate, session list/revoke
- Create: `admin.routes.ts` — all admin HTTP routes (users, roles, sessions)
- Create: `admin.schemas.ts` — Zod schemas for admin endpoints
- Create: `admin.events.ts` — admin event constants + payload interfaces
- Create: `index.ts` — barrel exports
- Create: `__tests__/admin.factory.ts` — test data builders
- Create: `__tests__/admin.service.test.ts` — unit tests
- Create: `__tests__/admin.service.integration.test.ts` — DB integration tests
- Create: `__tests__/admin.routes.test.ts` — route unit tests
- Create: `__tests__/admin.routes.integration.test.ts` — full HTTP integration tests
- Create: `__tests__/admin.schemas.test.ts` — schema validation tests

### Audit Module (apps/server/src/modules/audit/)

- Create: `audit.service.ts` — log creation with hash chain, querying, export
- Create: `audit.routes.ts` — query + export endpoints
- Create: `audit.schemas.ts` — Zod schemas for audit log entries + query params
- Create: `audit.listener.ts` — event bus subscriber that writes audit entries
- Create: `index.ts` — barrel exports
- Create: `__tests__/audit.factory.ts` — test data builders
- Create: `__tests__/audit.service.test.ts` — unit tests
- Create: `__tests__/audit.service.integration.test.ts` — DB integration tests
- Create: `__tests__/audit.routes.test.ts` — route unit tests
- Create: `__tests__/audit.routes.integration.test.ts` — full HTTP integration tests
- Create: `__tests__/audit.listener.test.ts` — event listener tests
- Create: `__tests__/audit.schemas.test.ts` — schema validation tests

### Core Changes

- Create: `apps/server/src/core/plugins/rbac.ts` — `requirePermission(resource, action)` Fastify decorator
- Create: `apps/server/src/core/plugins/__tests__/rbac.test.ts` — RBAC plugin unit tests
- Modify: `apps/server/src/core/module-loader.ts` — register admin, audit modules
- Modify: `apps/server/src/core/env.ts` — add `AUDIT_RETENTION_DAYS`
- Modify: `apps/server/src/app.ts` — register RBAC plugin + wire audit listener

---

## Task 1: Environment + DB Schema

**Files:**
- Modify: `apps/server/src/core/env.ts`
- Create: `packages/db/src/schema/role.ts`
- Create: `packages/db/src/schema/permission.ts`
- Create: `packages/db/src/schema/role-permission.ts`
- Create: `packages/db/src/schema/user-role.ts`
- Create: `packages/db/src/schema/audit-log.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add env var**

In `apps/server/src/core/env.ts`, add to `EnvSchema`:

```typescript
AUDIT_RETENTION_DAYS: z.coerce.number().default(90),
```

This is config-only for now — the pruning job that uses it is deferred to a future phase.

- [ ] **Step 2: Create roles table**

Create `packages/db/src/schema/role.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Create permissions table**

Create `packages/db/src/schema/permission.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    resource: varchar('resource', { length: 100 }).notNull(),
    action: varchar('action', { length: 100 }).notNull(),
  },
  (t) => [unique('permissions_resource_action_unique').on(t.resource, t.action)],
);
```

- [ ] **Step 4: Create role_permissions join table**

Create `packages/db/src/schema/role-permission.ts`:

```typescript
import { pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { permissions } from './permission.js';
import { roles } from './role.js';

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);
```

- [ ] **Step 5: Create user_roles join table**

Create `packages/db/src/schema/user-role.ts`:

```typescript
import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { roles } from './role.js';
import { users } from './user.js';

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);
```

- [ ] **Step 6: Create audit_logs table**

Create `packages/db/src/schema/audit-log.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  actorId: uuid('actor_id'),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 100 }).notNull(),
  resourceId: uuid('resource_id'),
  details: jsonb('details').notNull().default({}),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  prevHash: varchar('prev_hash', { length: 64 }),
});
```

No FK on `actorId` — audit entries survive user deletion (actor_id set to null on GDPR deletion, but the row stays).

- [ ] **Step 7: Export from schema/index.ts**

Add to `packages/db/src/schema/index.ts`:

```typescript
export { auditLogs } from './audit-log.js';
export { permissions } from './permission.js';
export { rolePermissions } from './role-permission.js';
export { roles } from './role.js';
export { userRoles } from './user-role.js';
```

- [ ] **Step 8: Export from packages/db/src/index.ts**

Add same exports to `packages/db/src/index.ts`:

```typescript
export { auditLogs } from './schema/index.js';
export { permissions } from './schema/index.js';
export { rolePermissions } from './schema/index.js';
export { roles } from './schema/index.js';
export { userRoles } from './schema/index.js';
```

Note: follow the existing pattern in that file — if they re-export from `'./schema/index.js'` in a single statement, group these with the existing exports.

- [ ] **Step 9: Generate migration**

```bash
cd packages/db && pnpm drizzle-kit generate
```

Verify the generated SQL creates all 5 tables with correct constraints.

- [ ] **Step 10: Build**

```bash
cd packages/db && pnpm build
```

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat(db): add RBAC and audit log tables"
```

---

## Task 2: RBAC Events + Schemas

**Files:**
- Create: `apps/server/src/modules/rbac/rbac.events.ts`
- Create: `apps/server/src/modules/rbac/rbac.schemas.ts`
- Create: `apps/server/src/modules/rbac/__tests__/rbac.schemas.test.ts`

- [ ] **Step 1: Create RBAC events**

Create `apps/server/src/modules/rbac/rbac.events.ts`:

```typescript
export const RBAC_EVENTS = {
  ROLE_CREATED: 'admin.role_created',
  ROLE_UPDATED: 'admin.role_updated',
  ROLE_ASSIGNED: 'admin.role_assigned',
  ROLE_REMOVED: 'admin.role_removed',
} as const;

export interface RoleCreatedPayload {
  roleId: string;
  name: string;
}

export interface RoleUpdatedPayload {
  roleId: string;
}

export interface RoleAssignedPayload {
  userId: string;
  roleId: string;
  assignedBy: string;
}

export interface RoleRemovedPayload {
  userId: string;
  roleId: string;
  removedBy: string;
}
```

- [ ] **Step 2: Create RBAC schemas**

Create `apps/server/src/modules/rbac/rbac.schemas.ts`:

```typescript
import { z } from 'zod';

export const roleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  createdAt: z.date(),
});

export type Role = z.infer<typeof roleSchema>;

export const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const permissionSchema = z.object({
  id: z.uuid(),
  resource: z.string(),
  action: z.string(),
});

export type Permission = z.infer<typeof permissionSchema>;

export const setRolePermissionsSchema = z.object({
  permissionIds: z.array(z.uuid()).min(1),
});

export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;

export const assignRoleSchema = z.object({
  roleId: z.uuid(),
});

export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const roleWithPermissionCountSchema = roleSchema.extend({
  permissionCount: z.number(),
});

export type RoleWithPermissionCount = z.infer<typeof roleWithPermissionCountSchema>;

export const roleListResponseSchema = z.array(roleWithPermissionCountSchema);

export const roleIdParamSchema = z.object({
  id: z.uuid(),
});

export const userIdParamSchema = z.object({
  id: z.uuid(),
});

export const userRoleParamsSchema = z.object({
  id: z.uuid(),
  roleId: z.uuid(),
});
```

- [ ] **Step 3: Write schema validation tests**

Create `apps/server/src/modules/rbac/__tests__/rbac.schemas.test.ts`:

Test `createRoleSchema`:
- Accepts `{ name: 'moderator' }` → valid
- Accepts `{ name: 'moderator', description: 'Can moderate' }` → valid
- Rejects `{ name: '' }` → fails min(1)
- Rejects `{ name: 'a'.repeat(101) }` → fails max(100)

Test `setRolePermissionsSchema`:
- Accepts `{ permissionIds: ['<uuid>'] }` → valid
- Rejects `{ permissionIds: [] }` → fails min(1)
- Rejects `{ permissionIds: ['not-uuid'] }` → fails uuid()

Test `assignRoleSchema`:
- Accepts `{ roleId: '<uuid>' }` → valid
- Rejects `{ roleId: 'bad' }` → fails uuid()

- [ ] **Step 4: Run schema tests**

```bash
cd apps/server && pnpm vitest run src/modules/rbac/__tests__/rbac.schemas.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rbac): add RBAC events, schemas, and schema tests"
```

---

## Task 3: RBAC Service — Core Logic

**Files:**
- Create: `apps/server/src/modules/rbac/rbac.service.ts`
- Create: `apps/server/src/modules/rbac/__tests__/rbac.factory.ts`
- Create: `apps/server/src/modules/rbac/__tests__/rbac.service.test.ts`
- Create: `apps/server/src/modules/rbac/index.ts`

- [ ] **Step 1: Create RBAC test factory**

Create `apps/server/src/modules/rbac/__tests__/rbac.factory.ts`:

```typescript
import { faker } from '@faker-js/faker';
import type { CreateRoleInput } from '../rbac.schemas.js';

export function makeCreateRoleInput(overrides?: Partial<CreateRoleInput>): CreateRoleInput {
  return {
    name: faker.word.noun(),
    description: faker.lorem.sentence(),
    ...overrides,
  };
}
```

- [ ] **Step 2: Write RBAC service unit tests**

Create `apps/server/src/modules/rbac/__tests__/rbac.service.test.ts`:

Mock the DB (`vi.mock`). Test cases:

**`createRole`:**
- Creates a role with `isSystem: false` and returns it
- Throws `ConflictError` when name already exists

**`listRoles`:**
- Returns roles with permission counts

**`setRolePermissions`:**
- Replaces existing permissions with new set
- Works on any role (including system roles — "read-only" for system roles means no rename/delete, not that permissions can't be updated)
- `super_admin` bypasses permission checks in middleware regardless of its `role_permissions` entries

**`assignRole`:**
- Creates `user_roles` entry
- Throws `ConflictError` when already assigned
- Throws `NotFoundError` when role doesn't exist

**`removeRole`:**
- Deletes `user_roles` entry
- Throws `NotFoundError` when not assigned

**`hasPermission`:**
- Returns `true` when user has role with matching permission
- Returns `true` when user has `super_admin` role (bypasses check)
- Returns `false` when user has no matching permission

**`getUserRoles`:**
- Returns list of roles for a user

**`seedSystemRoles`:**
- Creates system roles + permissions if not present
- Idempotent — no error on re-run

- [ ] **Step 3: Implement RBAC service**

Create `apps/server/src/modules/rbac/rbac.service.ts`:

```typescript
import { ConflictError, ForbiddenError, NotFoundError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { permissions, rolePermissions, roles, userRoles } from '@identity-starter/db';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { RBAC_EVENTS } from './rbac.events.js';
import type { CreateRoleInput } from './rbac.schemas.js';

const SYSTEM_ROLES = ['super_admin', 'admin', 'user'] as const;

const DEFAULT_PERMISSIONS = [
  { resource: 'users', action: 'read' },
  { resource: 'users', action: 'write' },
  { resource: 'roles', action: 'read' },
  { resource: 'roles', action: 'write' },
  { resource: 'sessions', action: 'read' },
  { resource: 'sessions', action: 'write' },
  { resource: 'audit', action: 'read' },
  { resource: 'audit', action: 'export' },
] as const;

const ADMIN_ROLE_PERMISSIONS = [
  { resource: 'users', action: 'read' },
  { resource: 'users', action: 'write' },
  { resource: 'sessions', action: 'read' },
  { resource: 'sessions', action: 'write' },
  { resource: 'audit', action: 'read' },
] as const;
```

Key functions:

**`createRole(db, eventBus, input)`:** Insert into `roles` with `isSystem: false`. Catch unique violation → `ConflictError`. Publish `RBAC_EVENTS.ROLE_CREATED` with `{ roleId, name }`.

**`listRoles(db)`:**
```typescript
const rows = await db
  .select({
    id: roles.id,
    name: roles.name,
    description: roles.description,
    isSystem: roles.isSystem,
    createdAt: roles.createdAt,
    permissionCount: count(rolePermissions.permissionId),
  })
  .from(roles)
  .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
  .groupBy(roles.id)
  .orderBy(roles.name);
```

**`setRolePermissions(db, eventBus, roleId, permissionIds)`:** Delete existing `role_permissions` for role, insert new ones. Verify all `permissionIds` exist first → `NotFoundError` if any missing. Publish `RBAC_EVENTS.ROLE_UPDATED` with `{ roleId }`.

**`assignRole(db, eventBus, userId, roleId, assignedBy)`:** Insert into `user_roles`. Catch unique → `ConflictError`. Publish `RBAC_EVENTS.ROLE_ASSIGNED` with `{ userId, roleId, assignedBy }`.

**`removeRole(db, eventBus, userId, roleId, removedBy)`:** Delete from `user_roles`. Throw `NotFoundError` if no row deleted. Publish `RBAC_EVENTS.ROLE_REMOVED` with `{ userId, roleId, removedBy }`.

**`hasPermission(db, userId, resource, action)`:**
```typescript
// Fast path: super_admin bypasses all checks
const [superAdminRole] = await db
  .select({ id: userRoles.roleId })
  .from(userRoles)
  .innerJoin(roles, eq(roles.id, userRoles.roleId))
  .where(and(eq(userRoles.userId, userId), eq(roles.name, 'super_admin')))
  .limit(1);

if (superAdminRole) {
  return true;
}

// Check specific permission via role chain
const [match] = await db
  .select({ id: rolePermissions.permissionId })
  .from(userRoles)
  .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
  .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
  .where(
    and(
      eq(userRoles.userId, userId),
      eq(permissions.resource, resource),
      eq(permissions.action, action),
    ),
  )
  .limit(1);

return !!match;
```

**`getUserRoles(db, userId)`:** Select from `user_roles` joined with `roles` where `userId` matches.

**`seedSystemRoles(db)`:** Idempotent upsert of system roles, default permissions, and admin role permission assignments. Use `ON CONFLICT DO NOTHING` via Drizzle's `.onConflictDoNothing()`.

- [ ] **Step 4: Create barrel index**

Create `apps/server/src/modules/rbac/index.ts`:

```typescript
export { RBAC_EVENTS } from './rbac.events.js';
export * from './rbac.schemas.js';
export {
  assignRole,
  createRole,
  getUserRoles,
  hasPermission,
  listRoles,
  removeRole,
  seedSystemRoles,
  setRolePermissions,
} from './rbac.service.js';
```

- [ ] **Step 5: Run unit tests**

```bash
cd apps/server && pnpm vitest run src/modules/rbac/__tests__/rbac.service.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(rbac): add RBAC service with role/permission CRUD and permission checking"
```

---

## Task 4: RBAC Service — Integration Tests

**Files:**
- Create: `apps/server/src/modules/rbac/__tests__/rbac.service.integration.test.ts`

- [ ] **Step 1: Write RBAC integration tests**

Test against real DB using `createTestDb()` + `InMemoryEventBus`. Import helpers from `../../user/__tests__/user.factory.js` for seeding users.

Test cases:

**`seedSystemRoles`:**
- Seeds 3 system roles (`super_admin`, `admin`, `user`)
- Seeds 8 default permissions
- Assigns correct permissions to `admin` role
- Idempotent — calling twice doesn't error or duplicate

**`createRole`:**
- Creates custom role, returns it with `isSystem: false`
- Throws `ConflictError` on duplicate name

**`listRoles`:**
- Returns all roles with correct permission counts
- After `setRolePermissions`, count reflects new set

**`setRolePermissions`:**
- Sets permissions on a role
- Replaces (not appends) on second call

**`assignRole + getUserRoles`:**
- Assigns role to user, `getUserRoles` returns it
- Duplicate assignment throws `ConflictError`

**`removeRole`:**
- Removes assigned role
- Removing non-assigned throws `NotFoundError`

**`hasPermission`:**
- User with `admin` role and `users:read` permission → `true`
- User with `admin` role but `audit:export` not assigned → `false`
- User with `super_admin` role → `true` for any permission
- User with no roles → `false`

- [ ] **Step 2: Run integration tests**

```bash
cd apps/server && pnpm vitest run src/modules/rbac/__tests__/rbac.service.integration.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(rbac): add RBAC service integration tests"
```

---

## Task 5: RBAC Middleware Plugin

**Files:**
- Create: `apps/server/src/core/plugins/rbac.ts`
- Create: `apps/server/src/core/plugins/__tests__/rbac.test.ts`

- [ ] **Step 1: Write RBAC plugin unit tests**

Create `apps/server/src/core/plugins/__tests__/rbac.test.ts`:

Follow the same pattern as `apps/server/src/core/plugins/__tests__/admin.test.ts` — minimal Fastify + `containerPlugin` + mock DB.

Test cases:
1. `requirePermission('users', 'read')` — user with matching permission → request passes
2. `requirePermission('users', 'read')` — user without permission → throws `ForbiddenError`
3. `requirePermission` calls `requireSession` first — no Bearer token → throws `UnauthorizedError`
4. `requirePermission('anything', 'anything')` — `super_admin` user → request passes

Mock `hasPermission` from the RBAC service module (via `vi.mock`) and `requireSession`.

- [ ] **Step 2: Implement RBAC plugin**

Create `apps/server/src/core/plugins/rbac.ts`:

```typescript
import { ForbiddenError } from '@identity-starter/core';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasPermission } from '../../modules/rbac/rbac.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    requirePermission: (
      resource: string,
      action: string,
    ) => (request: FastifyRequest) => Promise<void>;
  }
}

export const rbacPlugin = fp(async (fastify) => {
  const { db } = fastify.container;

  fastify.decorate(
    'requirePermission',
    (resource: string, action: string) => async (request: FastifyRequest) => {
      await fastify.requireSession(request);

      const allowed = await hasPermission(db, request.userId, resource, action);
      if (!allowed) {
        throw new ForbiddenError(`Missing permission: ${resource}:${action}`);
      }
    },
  );
});
```

Usage in routes: `preHandler: fastify.requirePermission('users', 'read')`.

- [ ] **Step 3: Run tests**

```bash
cd apps/server && pnpm vitest run src/core/plugins/__tests__/rbac.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(core): add RBAC middleware plugin with requirePermission decorator"
```

---

## Task 6: Admin Events + Schemas

**Files:**
- Create: `apps/server/src/modules/admin/admin.events.ts`
- Create: `apps/server/src/modules/admin/admin.schemas.ts`
- Create: `apps/server/src/modules/admin/__tests__/admin.schemas.test.ts`

- [ ] **Step 1: Create admin events**

Create `apps/server/src/modules/admin/admin.events.ts`:

```typescript
export const ADMIN_EVENTS = {
  USER_SUSPENDED: 'admin.user_suspended',
  USER_ACTIVATED: 'admin.user_activated',
  SESSION_REVOKED: 'admin.session_revoked',
  SESSIONS_BULK_REVOKED: 'admin.sessions_bulk_revoked',
} as const;

export interface AdminUserSuspendedPayload {
  userId: string;
  adminId: string;
}

export interface AdminUserActivatedPayload {
  userId: string;
  adminId: string;
}

export interface AdminSessionRevokedPayload {
  sessionId: string;
  userId: string;
  adminId: string;
}

export interface AdminSessionsBulkRevokedPayload {
  userId: string;
  count: number;
  adminId: string;
}
```

- [ ] **Step 2: Create admin schemas**

Create `apps/server/src/modules/admin/admin.schemas.ts`:

```typescript
import { z } from 'zod';

const userStatusEnum = z.enum(['active', 'suspended', 'pending_verification']);

export const adminUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  displayName: z.string(),
  status: userStatusEnum,
  createdAt: z.date(),
  roles: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserListItemSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  status: userStatusEnum,
  createdAt: z.date(),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const userListQuerySchema = paginationQuerySchema.extend({
  status: userStatusEnum.optional(),
  email: z.string().optional(),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const paginatedResponseSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  });

export const userListResponseSchema = paginatedResponseSchema(adminUserListItemSchema);
export type UserListResponse = z.infer<typeof userListResponseSchema>;

export const updateUserStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});

export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const userIdParamSchema = z.object({
  id: z.uuid(),
});

export const adminSessionSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  lastActiveAt: z.date(),
  createdAt: z.date(),
});

export const sessionListQuerySchema = paginationQuerySchema.extend({
  userId: z.uuid().optional(),
});

export const sessionListResponseSchema = paginatedResponseSchema(adminSessionSchema);

export const sessionIdParamSchema = z.object({
  id: z.uuid(),
});

export const messageResponseSchema = z.object({
  message: z.string(),
});
```

- [ ] **Step 3: Write schema validation tests**

Create `apps/server/src/modules/admin/__tests__/admin.schemas.test.ts`:

Test key schemas:
- `userListQuerySchema`: page/limit defaults, status filter, email filter
- `updateUserStatusSchema`: accepts `'active'` and `'suspended'`, rejects `'deleted'`
- `sessionListQuerySchema`: page/limit, optional userId filter

- [ ] **Step 4: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/admin/__tests__/admin.schemas.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(admin): add admin events and schemas"
```

---

## Task 7: Admin Service — User + Session Management

**Files:**
- Create: `apps/server/src/modules/admin/admin.service.ts`
- Create: `apps/server/src/modules/admin/__tests__/admin.factory.ts`
- Create: `apps/server/src/modules/admin/__tests__/admin.service.test.ts`

- [ ] **Step 1: Create admin test factory**

Create `apps/server/src/modules/admin/__tests__/admin.factory.ts`:

```typescript
import { faker } from '@faker-js/faker';
import type { UpdateUserStatusInput, UserListQuery } from '../admin.schemas.js';

export function makeUserListQuery(overrides?: Partial<UserListQuery>): UserListQuery {
  return {
    page: 1,
    limit: 20,
    ...overrides,
  };
}

export function makeUpdateUserStatusInput(
  overrides?: Partial<UpdateUserStatusInput>,
): UpdateUserStatusInput {
  return {
    status: faker.helpers.arrayElement(['active', 'suspended'] as const),
    ...overrides,
  };
}
```

- [ ] **Step 2: Write admin service unit tests**

Create `apps/server/src/modules/admin/__tests__/admin.service.test.ts`:

Mock DB. Test cases:

**`listUsers(db, query)`:**
- Returns paginated users with total count
- Filters by `status` when provided
- Filters by `email` partial match when provided

**`getUser(db, userId)`:**
- Returns user with roles
- Throws `NotFoundError` when not found

**`updateUserStatus(db, eventBus, userId, input, adminId)`:**
- Updates user status and emits `admin.user_suspended` or `admin.user_activated`
- Throws `NotFoundError` when user doesn't exist
- Throws `ValidationError` when trying to suspend self

**`listSessions(db, query)`:**
- Returns paginated sessions
- Filters by `userId` when provided

**`revokeSession(db, eventBus, sessionId, adminId)`:**
- Deletes session and emits `admin.session_revoked`
- Throws `NotFoundError` when session doesn't exist

**`bulkRevokeSessions(db, eventBus, userId, adminId)`:**
- Deletes all sessions for a user
- Returns count of revoked sessions
- Throws `NotFoundError` when user doesn't exist

- [ ] **Step 3: Implement admin service**

Create `apps/server/src/modules/admin/admin.service.ts`:

```typescript
import { NotFoundError, ValidationError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { roles, sessionColumns, sessions, userColumns, userRoles, users } from '@identity-starter/db';
import { and, count, eq, ilike, sql } from 'drizzle-orm';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { ADMIN_EVENTS } from './admin.events.js';
import type { UpdateUserStatusInput, UserListQuery } from './admin.schemas.js';
```

**`listUsers(db, query)`:**
1. Build `where` conditions array based on `query.status` and `query.email` (use `ilike` for email partial match)
2. Run count query for total
3. Run select query with `offset = (page - 1) * limit` and `limit`
4. Select from `userColumns` (excludes `passwordHash`)
5. Return `{ data, total, page: query.page, limit: query.limit }`

**`getUser(db, userId)`:**
1. Select user by ID from `userColumns`
2. If not found → `NotFoundError`
3. Query `user_roles` joined with `roles` for the user
4. Return user object with `roles` array

**`updateUserStatus(db, eventBus, userId, input, adminId)`:**
1. If `userId === adminId` → throw `ValidationError('Cannot change own status')`
2. Verify user exists → `NotFoundError`
3. Update `users.status` to `input.status`
4. Emit appropriate event (`USER_SUSPENDED` or `USER_ACTIVATED`)
5. If suspending, also delete all sessions for the user
6. Return updated user (via `getUser`)

**`listSessions(db, query)`:**
1. Build where conditions (optionally filter by `userId`)
2. Count + paginated select from `sessions` using `sessionColumns`
3. Return paginated response

**`revokeSession(db, eventBus, sessionId, adminId)`:**
1. Look up session to get `userId` → `NotFoundError` if missing
2. Delete session
3. Emit `admin.session_revoked` with `{ sessionId, userId, adminId }`

**`bulkRevokeSessions(db, eventBus, userId, adminId)`:**
1. Verify user exists → `NotFoundError` if missing
2. Count active sessions for user
3. Delete all sessions for user
4. Emit `admin.session_revoked` for each deleted session (or a single `admin.sessions_bulk_revoked` event with `{ userId, count, adminId }`)
5. Return `{ revoked: count }`

- [ ] **Step 4: Run unit tests**

```bash
cd apps/server && pnpm vitest run src/modules/admin/__tests__/admin.service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(admin): add admin service for user and session management"
```

---

## Task 8: Admin Routes

**Files:**
- Create: `apps/server/src/modules/admin/admin.routes.ts`
- Create: `apps/server/src/modules/admin/__tests__/admin.routes.test.ts`
- Create: `apps/server/src/modules/admin/index.ts`

- [ ] **Step 1: Write admin route unit tests**

Create `apps/server/src/modules/admin/__tests__/admin.routes.test.ts`:

Follow the pattern from `account.routes.test.ts`:
- Create Fastify instance with Zod compilers
- Decorate with mock `container`, `requireSession`, `requirePermission`
- Mock `admin.service.js` and `rbac.service.js` with `vi.hoisted` + `vi.mock`
- Register `errorHandlerPlugin` + `adminRoutes` with prefix `/api/admin`

Test cases:

**`GET /api/admin/users`:**
- Returns 200 with paginated user list
- Passes query params to service

**`GET /api/admin/users/:id`:**
- Returns 200 with user detail + roles
- Returns 404 when not found

**`PATCH /api/admin/users/:id/status`:**
- Returns 200 with updated user
- Returns 400 on invalid status
- Returns 404 when user not found

**`POST /api/admin/roles`:**
- Returns 201 with created role
- Returns 400 on invalid body

**`GET /api/admin/roles`:**
- Returns 200 with role list + permission counts

**`PUT /api/admin/roles/:id/permissions`:**
- Returns 200 on success

**`POST /api/admin/users/:id/roles`:**
- Returns 201 on success

**`DELETE /api/admin/users/:id/roles/:roleId`:**
- Returns 204 on success

**`GET /api/admin/sessions`:**
- Returns 200 with paginated sessions

**`DELETE /api/admin/sessions/:id`:**
- Returns 204 on success

**`DELETE /api/admin/users/:id/sessions`:**
- Returns 200 with `{ message: 'Revoked N sessions' }`
- Bulk revokes all sessions for a user

For the `requirePermission` mock — decorate a `requirePermission` that returns a function which sets `request.session` and `request.userId` (just like the session mock pattern), so route handlers have access to the admin's identity.

- [ ] **Step 2: Implement admin routes**

Create `apps/server/src/modules/admin/admin.routes.ts`:

```typescript
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  assignRole,
  createRole,
  listRoles,
  removeRole,
  setRolePermissions,
} from '../rbac/rbac.service.js';
import {
  assignRoleSchema,
  createRoleSchema,
  roleIdParamSchema,
  roleListResponseSchema,
  roleSchema,
  setRolePermissionsSchema,
  userRoleParamsSchema,
} from '../rbac/rbac.schemas.js';
import {
  bulkRevokeSessions,
  getUser,
  listSessions,
  listUsers,
  revokeSession,
  updateUserStatus,
} from './admin.service.js';
import {
  adminUserSchema,
  messageResponseSchema,
  sessionIdParamSchema,
  sessionListQuerySchema,
  sessionListResponseSchema,
  updateUserStatusSchema,
  userIdParamSchema,
  userListQuerySchema,
  userListResponseSchema,
} from './admin.schemas.js';

export const adminRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db, eventBus } = fastify.container;

  // --- User Management ---
  fastify.get(
    '/users',
    {
      preHandler: fastify.requirePermission('users', 'read'),
      schema: {
        querystring: userListQuerySchema,
        response: { 200: userListResponseSchema },
      },
    },
    async (request) => {
      return listUsers(db, request.query);
    },
  );

  fastify.get(
    '/users/:id',
    {
      preHandler: fastify.requirePermission('users', 'read'),
      schema: {
        params: userIdParamSchema,
        response: { 200: adminUserSchema },
      },
    },
    async (request) => {
      return getUser(db, request.params.id);
    },
  );

  fastify.patch(
    '/users/:id/status',
    {
      preHandler: fastify.requirePermission('users', 'write'),
      schema: {
        params: userIdParamSchema,
        body: updateUserStatusSchema,
        response: { 200: adminUserSchema },
      },
    },
    async (request) => {
      return updateUserStatus(db, eventBus, request.params.id, request.body, request.userId);
    },
  );

  // --- Role Management ---
  fastify.post(
    '/roles',
    {
      preHandler: fastify.requirePermission('roles', 'write'),
      schema: {
        body: createRoleSchema,
        response: { 201: roleSchema },
      },
    },
    async (request, reply) => {
      const role = await createRole(db, eventBus, request.body);
      return reply.status(201).send(role);
    },
  );

  fastify.get(
    '/roles',
    {
      preHandler: fastify.requirePermission('roles', 'read'),
      schema: {
        response: { 200: roleListResponseSchema },
      },
    },
    async () => {
      return listRoles(db);
    },
  );

  fastify.put(
    '/roles/:id/permissions',
    {
      preHandler: fastify.requirePermission('roles', 'write'),
      schema: {
        params: roleIdParamSchema,
        body: setRolePermissionsSchema,
        response: { 200: messageResponseSchema },
      },
    },
    async (request) => {
      await setRolePermissions(db, eventBus, request.params.id, request.body.permissionIds);
      return { message: 'Permissions updated' };
    },
  );

  fastify.post(
    '/users/:id/roles',
    {
      preHandler: fastify.requirePermission('roles', 'write'),
      schema: {
        params: userIdParamSchema,
        body: assignRoleSchema,
        response: { 201: messageResponseSchema },
      },
    },
    async (request, reply) => {
      await assignRole(db, eventBus, request.params.id, request.body.roleId, request.userId);
      return reply.status(201).send({ message: 'Role assigned' });
    },
  );

  fastify.delete(
    '/users/:id/roles/:roleId',
    {
      preHandler: fastify.requirePermission('roles', 'write'),
      schema: {
        params: userRoleParamsSchema,
      },
    },
    async (request, reply) => {
      await removeRole(db, eventBus, request.params.id, request.params.roleId, request.userId);
      return reply.status(204).send();
    },
  );

  // --- Session Management ---
  fastify.get(
    '/sessions',
    {
      preHandler: fastify.requirePermission('sessions', 'read'),
      schema: {
        querystring: sessionListQuerySchema,
        response: { 200: sessionListResponseSchema },
      },
    },
    async (request) => {
      return listSessions(db, request.query);
    },
  );

  fastify.delete(
    '/sessions/:id',
    {
      preHandler: fastify.requirePermission('sessions', 'write'),
      schema: {
        params: sessionIdParamSchema,
      },
    },
    async (request, reply) => {
      await revokeSession(db, eventBus, request.params.id, request.userId);
      return reply.status(204).send();
    },
  );

  fastify.delete(
    '/users/:id/sessions',
    {
      preHandler: fastify.requirePermission('sessions', 'write'),
      schema: {
        params: userIdParamSchema,
        response: { 200: messageResponseSchema },
      },
    },
    async (request) => {
      const result = await bulkRevokeSessions(db, eventBus, request.params.id, request.userId);
      return { message: `Revoked ${result.revoked} sessions` };
    },
  );
};
```

- [ ] **Step 3: Create barrel index**

Create `apps/server/src/modules/admin/index.ts`:

```typescript
export { adminRoutes } from './admin.routes.js';
export { ADMIN_EVENTS } from './admin.events.js';
export * from './admin.schemas.js';
export {
  bulkRevokeSessions,
  getUser,
  listSessions,
  listUsers,
  revokeSession,
  updateUserStatus,
} from './admin.service.js';
```

- [ ] **Step 4: Run route unit tests**

```bash
cd apps/server && pnpm vitest run src/modules/admin/__tests__/admin.routes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(admin): add admin routes for user, role, and session management"
```

---

## Task 9: Audit Events + Schemas

**Files:**
- Create: `apps/server/src/modules/audit/audit.schemas.ts`
- Create: `apps/server/src/modules/audit/__tests__/audit.schemas.test.ts`

- [ ] **Step 1: Create audit schemas**

Create `apps/server/src/modules/audit/audit.schemas.ts`:

```typescript
import { z } from 'zod';

export const auditLogSchema = z.object({
  id: z.uuid(),
  actorId: z.uuid().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.uuid().nullable(),
  details: z.record(z.string(), z.unknown()),
  ipAddress: z.string().nullable(),
  createdAt: z.date(),
  prevHash: z.string().nullable(),
});

export type AuditLog = z.infer<typeof auditLogSchema>;

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  actorId: z.uuid().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogListResponseSchema = z.object({
  data: z.array(auditLogSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

export const auditExportQuerySchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  actorId: z.uuid().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
});

export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;

export interface CreateAuditLogInput {
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}
```

- [ ] **Step 2: Write schema validation tests**

Create `apps/server/src/modules/audit/__tests__/audit.schemas.test.ts`:

Test `auditLogQuerySchema`:
- Defaults page=1, limit=20
- Accepts all filter combinations
- Rejects invalid UUID for actorId
- Coerces date strings to Date objects

Test `auditExportQuerySchema`:
- Accepts empty object (all optional)
- Accepts date range filters

- [ ] **Step 3: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/audit/__tests__/audit.schemas.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(audit): add audit log schemas"
```

---

## Task 10: Audit Service

**Files:**
- Create: `apps/server/src/modules/audit/audit.service.ts`
- Create: `apps/server/src/modules/audit/__tests__/audit.factory.ts`
- Create: `apps/server/src/modules/audit/__tests__/audit.service.test.ts`

- [ ] **Step 1: Create audit test factory**

Create `apps/server/src/modules/audit/__tests__/audit.factory.ts`:

```typescript
import { faker } from '@faker-js/faker';
import type { CreateAuditLogInput } from '../audit.schemas.js';

export function makeCreateAuditLogInput(
  overrides?: Partial<CreateAuditLogInput>,
): CreateAuditLogInput {
  return {
    actorId: faker.string.uuid(),
    action: 'auth.login',
    resourceType: 'user',
    resourceId: faker.string.uuid(),
    details: {},
    ipAddress: faker.internet.ipv4(),
    ...overrides,
  };
}
```

- [ ] **Step 2: Write audit service unit tests**

Create `apps/server/src/modules/audit/__tests__/audit.service.test.ts`:

Mock DB. Test cases:

**`createAuditLog(db, input)`:**
- Computes `prevHash` from last entry (SHA-256 of `id + action + created_at`)
- Inserts with all fields
- First entry has `prevHash: null` (no previous)

**`queryAuditLogs(db, query)`:**
- Returns paginated results ordered by `created_at` desc
- Applies filters: `actorId`, `action`, `resourceType`, `resourceId`, date range

**`exportAuditLogs(db, query)`:**
- Returns all matching entries (no pagination, for streaming/export)
- Applies same filters as query

- [ ] **Step 3: Implement audit service**

Create `apps/server/src/modules/audit/audit.service.ts`:

```typescript
import { createHash } from 'node:crypto';
import type { Database } from '@identity-starter/db';
import { auditLogs } from '@identity-starter/db';
import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { AuditExportQuery, AuditLogQuery, CreateAuditLogInput } from './audit.schemas.js';

function computeHash(id: string, action: string, createdAt: Date): string {
  return createHash('sha256')
    .update(`${id}${action}${createdAt.toISOString()}`)
    .digest('hex');
}
```

**`createAuditLog(db, input)`:**
1. Fetch last audit log entry ordered by `created_at` desc, limit 1
2. Compute `prevHash` from last entry (or `null` if first entry)
3. Insert new entry with computed `prevHash`
4. Return inserted row

**`queryAuditLogs(db, query)`:**
1. Build `where` conditions array from filters
2. Run count query
3. Run paginated select ordered by `created_at` desc
4. Return `{ data, total, page, limit }`

**`exportAuditLogs(db, query)`:**
1. Build `where` conditions from export filters
2. Select all matching ordered by `created_at` asc (chronological for export)
3. Return array

Helper for building where conditions:
```typescript
function buildWhereConditions(filters: {
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
}): SQL[] {
  const conditions: SQL[] = [];
  if (filters.actorId) {
    conditions.push(eq(auditLogs.actorId, filters.actorId));
  }
  if (filters.action) {
    conditions.push(eq(auditLogs.action, filters.action));
  }
  if (filters.resourceType) {
    conditions.push(eq(auditLogs.resourceType, filters.resourceType));
  }
  if (filters.resourceId) {
    conditions.push(eq(auditLogs.resourceId, filters.resourceId));
  }
  if (filters.startDate) {
    conditions.push(gte(auditLogs.createdAt, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(auditLogs.createdAt, filters.endDate));
  }
  return conditions;
}
```

- [ ] **Step 4: Run unit tests**

```bash
cd apps/server && pnpm vitest run src/modules/audit/__tests__/audit.service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(audit): add audit service with hash chain and query support"
```

---

## Task 11: Audit Service — Integration Tests

**Files:**
- Create: `apps/server/src/modules/audit/__tests__/audit.service.integration.test.ts`

- [ ] **Step 1: Write audit service integration tests**

Test against real DB using `createTestDb()`.

Test cases:

**`createAuditLog`:**
- First entry has `prevHash: null`
- Second entry has `prevHash` = SHA-256 of first entry's `id + action + created_at`
- Third entry's hash chains from second

**Hash chain verification:**
- Insert 5 entries → for each entry after the first, verify `prevHash` matches computed hash of previous entry

**`queryAuditLogs`:**
- Insert 25 entries → query page 1 limit 10 → returns 10 entries with total 25
- Filter by `actorId` → returns only matching entries
- Filter by `action` → returns only matching entries
- Filter by date range → returns entries within range
- Combined filters work correctly

**`exportAuditLogs`:**
- Returns all matching entries in chronological order (asc)
- Filters work same as query

- [ ] **Step 2: Run integration tests**

```bash
cd apps/server && pnpm vitest run src/modules/audit/__tests__/audit.service.integration.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(audit): add audit service integration tests with hash chain verification"
```

---

## Task 12: Audit Routes

**Files:**
- Create: `apps/server/src/modules/audit/audit.routes.ts`
- Create: `apps/server/src/modules/audit/__tests__/audit.routes.test.ts`
- Create: `apps/server/src/modules/audit/index.ts`

- [ ] **Step 1: Write audit route unit tests**

Create `apps/server/src/modules/audit/__tests__/audit.routes.test.ts`:

Follow pattern from `account.routes.test.ts`. Mock `audit.service.js`.

Test cases:

**`GET /api/admin/audit-logs`:**
- Returns 200 with paginated audit logs
- Passes query filters to service
- Protected by `requirePermission('audit', 'read')`

**`GET /api/admin/audit-logs/export`:**
- Returns 200 with JSON lines (newline-delimited JSON)
- Content-Type is `application/x-ndjson`
- Protected by `requirePermission('audit', 'export')`

- [ ] **Step 2: Implement audit routes**

Create `apps/server/src/modules/audit/audit.routes.ts`:

```typescript
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  auditExportQuerySchema,
  auditLogListResponseSchema,
  auditLogQuerySchema,
} from './audit.schemas.js';
import { exportAuditLogs, queryAuditLogs } from './audit.service.js';

export const auditRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.container;

  fastify.get(
    '/',
    {
      preHandler: fastify.requirePermission('audit', 'read'),
      schema: {
        querystring: auditLogQuerySchema,
        response: { 200: auditLogListResponseSchema },
      },
    },
    async (request) => {
      return queryAuditLogs(db, request.query);
    },
  );

  fastify.get(
    '/export',
    {
      preHandler: fastify.requirePermission('audit', 'export'),
      schema: {
        querystring: auditExportQuerySchema,
      },
    },
    async (request, reply) => {
      const logs = await exportAuditLogs(db, request.query);
      reply.header('content-type', 'application/x-ndjson');
      const ndjson = logs.map((log) => JSON.stringify(log)).join('\n');
      return reply.send(ndjson);
    },
  );
};
```

- [ ] **Step 3: Create barrel index**

Create `apps/server/src/modules/audit/index.ts`:

```typescript
export { auditRoutes } from './audit.routes.js';
export * from './audit.schemas.js';
export { createAuditLog, exportAuditLogs, queryAuditLogs } from './audit.service.js';
```

- [ ] **Step 4: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/audit/__tests__/audit.routes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(audit): add audit log query and export routes"
```

---

## Task 13: Audit Event Listener

**Files:**
- Create: `apps/server/src/modules/audit/audit.listener.ts`
- Create: `apps/server/src/modules/audit/__tests__/audit.listener.test.ts`

- [ ] **Step 1: Write audit listener unit tests**

Create `apps/server/src/modules/audit/__tests__/audit.listener.test.ts`:

Test cases:
1. Auth events (`auth.login`, `auth.registered`, `auth.failed_login`, etc.) → creates audit log entries with correct `action`, `resourceType`, `actorId`
2. Session events (`session.created`, `session.revoked`) → audit entries
3. Admin events (`admin.user_suspended`, `admin.role_assigned`, etc.) → audit entries
4. Account events (`account.profile_updated`, `account.session_revoked`) → audit entries
5. MFA events (`mfa.totp.enrolled`, etc.) → audit entries
6. Passkey events (`passkey.registered`, etc.) → audit entries
7. OAuth events (`oauth.consent_granted`, etc.) → audit entries
8. RBAC events (`admin.role_created`, etc.) → audit entries
9. Unknown/unregistered events → no audit entry (listener only subscribes to known events)

Mock `createAuditLog` from `audit.service.js`.

- [ ] **Step 2: Implement audit listener**

Create `apps/server/src/modules/audit/audit.listener.ts`:

```typescript
import type { Database } from '@identity-starter/db';
import type { DomainEvent, EventBus } from '../../infra/event-bus.js';
import { ACCOUNT_EVENTS } from '../account/account.events.js';
import { ADMIN_EVENTS } from '../admin/admin.events.js';
import { AUTH_EVENTS } from '../auth/auth.events.js';
import { CLIENT_EVENTS } from '../client/client.events.js';
import { MFA_EVENTS } from '../mfa/mfa.events.js';
import { OAUTH_EVENTS } from '../oauth/oauth.events.js';
import { PASSKEY_EVENTS } from '../passkey/passkey.events.js';
import { RBAC_EVENTS } from '../rbac/rbac.events.js';
import { SESSION_EVENTS } from '../session/session.events.js';
import { createAuditLog } from './audit.service.js';

interface EventMapping {
  eventName: string;
  resourceType: string;
  extractActorId: (payload: Record<string, unknown>) => string | null;
  extractResourceId: (payload: Record<string, unknown>) => string | null;
}

const EVENT_MAPPINGS: EventMapping[] = [
  // Auth events
  {
    eventName: AUTH_EVENTS.REGISTERED,
    resourceType: 'user',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: AUTH_EVENTS.LOGIN,
    resourceType: 'session',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: AUTH_EVENTS.LOGOUT,
    resourceType: 'session',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.sessionId as string) ?? null,
  },
  {
    eventName: AUTH_EVENTS.FAILED_LOGIN,
    resourceType: 'auth',
    extractActorId: () => null,
    extractResourceId: () => null,
  },
  {
    eventName: AUTH_EVENTS.PASSWORD_CHANGED,
    resourceType: 'user',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: AUTH_EVENTS.EMAIL_VERIFIED,
    resourceType: 'user',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: AUTH_EVENTS.PASSWORD_RESET_REQUESTED,
    resourceType: 'user',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: AUTH_EVENTS.PASSWORD_RESET_COMPLETED,
    resourceType: 'user',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  // Session events
  {
    eventName: SESSION_EVENTS.CREATED,
    resourceType: 'session',
    extractActorId: (p) => {
      const session = p.session as Record<string, unknown> | undefined;
      return (session?.userId as string) ?? null;
    },
    extractResourceId: (p) => {
      const session = p.session as Record<string, unknown> | undefined;
      return (session?.id as string) ?? null;
    },
  },
  {
    eventName: SESSION_EVENTS.REVOKED,
    resourceType: 'session',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.sessionId as string) ?? null,
  },
  // Admin events
  {
    eventName: ADMIN_EVENTS.USER_SUSPENDED,
    resourceType: 'user',
    extractActorId: (p) => (p.adminId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: ADMIN_EVENTS.USER_ACTIVATED,
    resourceType: 'user',
    extractActorId: (p) => (p.adminId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: ADMIN_EVENTS.SESSION_REVOKED,
    resourceType: 'session',
    extractActorId: (p) => (p.adminId as string) ?? null,
    extractResourceId: (p) => (p.sessionId as string) ?? null,
  },
  {
    eventName: ADMIN_EVENTS.SESSIONS_BULK_REVOKED,
    resourceType: 'session',
    extractActorId: (p) => (p.adminId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  // RBAC events
  {
    eventName: RBAC_EVENTS.ROLE_CREATED,
    resourceType: 'role',
    extractActorId: () => null,
    extractResourceId: (p) => (p.roleId as string) ?? null,
  },
  {
    eventName: RBAC_EVENTS.ROLE_UPDATED,
    resourceType: 'role',
    extractActorId: () => null,
    extractResourceId: (p) => (p.roleId as string) ?? null,
  },
  {
    eventName: RBAC_EVENTS.ROLE_ASSIGNED,
    resourceType: 'user_role',
    extractActorId: (p) => (p.assignedBy as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: RBAC_EVENTS.ROLE_REMOVED,
    resourceType: 'user_role',
    extractActorId: (p) => (p.removedBy as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  // Account events
  {
    eventName: ACCOUNT_EVENTS.PROFILE_UPDATED,
    resourceType: 'user',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: ACCOUNT_EVENTS.SESSION_REVOKED,
    resourceType: 'session',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.sessionId as string) ?? null,
  },
  {
    eventName: ACCOUNT_EVENTS.PASSKEY_RENAMED,
    resourceType: 'passkey',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.passkeyId as string) ?? null,
  },
  {
    eventName: ACCOUNT_EVENTS.PASSKEY_DELETED,
    resourceType: 'passkey',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.passkeyId as string) ?? null,
  },
  // MFA events
  {
    eventName: MFA_EVENTS.TOTP_ENROLLED,
    resourceType: 'mfa',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: MFA_EVENTS.TOTP_DISABLED,
    resourceType: 'mfa',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: MFA_EVENTS.TOTP_VERIFIED,
    resourceType: 'mfa',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: MFA_EVENTS.RECOVERY_CODES_GENERATED,
    resourceType: 'mfa',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: MFA_EVENTS.RECOVERY_CODE_USED,
    resourceType: 'mfa',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  // Passkey events
  {
    eventName: PASSKEY_EVENTS.REGISTERED,
    resourceType: 'passkey',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.passkeyId as string) ?? null,
  },
  {
    eventName: PASSKEY_EVENTS.DELETED,
    resourceType: 'passkey',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.passkeyId as string) ?? null,
  },
  // OAuth events
  {
    eventName: OAUTH_EVENTS.AUTHORIZATION_CODE_ISSUED,
    resourceType: 'oauth',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.clientId as string) ?? null,
  },
  {
    eventName: OAUTH_EVENTS.TOKEN_EXCHANGED,
    resourceType: 'oauth',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.clientId as string) ?? null,
  },
  {
    eventName: OAUTH_EVENTS.CONSENT_GRANTED,
    resourceType: 'consent',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.clientId as string) ?? null,
  },
  {
    eventName: OAUTH_EVENTS.CONSENT_REVOKED,
    resourceType: 'consent',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.clientId as string) ?? null,
  },
  // Client events
  {
    eventName: CLIENT_EVENTS.CREATED,
    resourceType: 'client',
    extractActorId: () => null,
    extractResourceId: (p) => (p.id as string) ?? null,
  },
  {
    eventName: CLIENT_EVENTS.UPDATED,
    resourceType: 'client',
    extractActorId: () => null,
    extractResourceId: (p) => (p.id as string) ?? null,
  },
  {
    eventName: CLIENT_EVENTS.DELETED,
    resourceType: 'client',
    extractActorId: () => null,
    extractResourceId: (p) => (p.id as string) ?? null,
  },
  {
    eventName: CLIENT_EVENTS.SECRET_ROTATED,
    resourceType: 'client',
    extractActorId: () => null,
    extractResourceId: (p) => (p.id as string) ?? null,
  },
];

export function registerAuditListener(db: Database, eventBus: EventBus): void {
  for (const mapping of EVENT_MAPPINGS) {
    eventBus.subscribe(mapping.eventName, async (event: DomainEvent) => {
      const payload = event.payload as Record<string, unknown>;
      await createAuditLog(db, {
        actorId: mapping.extractActorId(payload),
        action: event.eventName,
        resourceType: mapping.resourceType,
        resourceId: mapping.extractResourceId(payload),
        details: payload,
      });
    });
  }
}
```

- [ ] **Step 3: Run listener tests**

```bash
cd apps/server && pnpm vitest run src/modules/audit/__tests__/audit.listener.test.ts
```

- [ ] **Step 4: Export listener from barrel**

Update `apps/server/src/modules/audit/index.ts` to add:

```typescript
export { registerAuditListener } from './audit.listener.js';
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(audit): add event bus listener for automatic audit logging"
```

---

## Task 14: Module Wiring + App Integration

**Files:**
- Modify: `apps/server/src/core/module-loader.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Register new modules in module-loader**

Add to `apps/server/src/core/module-loader.ts`:

Import at top:
```typescript
import { adminRoutes } from '../modules/admin/index.js';
import { auditRoutes } from '../modules/audit/index.js';
```

Add to `modules` array:
```typescript
{ plugin: adminRoutes, prefix: '/api/admin' },
{ plugin: auditRoutes, prefix: '/api/admin/audit-logs' },
```

Place `adminRoutes` after `clientRoutes` and `auditRoutes` after `adminRoutes`.

- [ ] **Step 2: Wire RBAC plugin + audit listener in app.ts**

In `apps/server/src/app.ts`:

Add imports:
```typescript
import { rbacPlugin } from './core/plugins/rbac.js';
import { registerAuditListener } from './modules/audit/audit.listener.js';
import { seedSystemRoles } from './modules/rbac/rbac.service.js';
```

After `await app.register(adminPlugin);`, add:
```typescript
await app.register(rbacPlugin);
```

After `await registerModules(app);`, add:
```typescript
// Seed system roles + permissions (idempotent)
await seedSystemRoles(options.container.db);

// Wire audit listener to event bus
registerAuditListener(options.container.db, options.container.eventBus);
```

- [ ] **Step 3: Build and verify**

```bash
cd apps/server && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: wire RBAC plugin, admin/audit modules, and audit listener into app"
```

---

## Task 15: Admin + Audit Integration Tests

**Files:**
- Create: `apps/server/src/modules/admin/__tests__/admin.routes.integration.test.ts`
- Create: `apps/server/src/modules/admin/__tests__/admin.service.integration.test.ts`
- Create: `apps/server/src/modules/audit/__tests__/audit.routes.integration.test.ts`

- [ ] **Step 1: Write admin service integration tests**

Create `apps/server/src/modules/admin/__tests__/admin.service.integration.test.ts`:

Setup: `createTestDb()`, `InMemoryEventBus`, seed system roles, create test users, assign roles.

Test cases:

**`listUsers`:**
- Returns all users with pagination
- Filters by status
- Filters by email partial match

**`getUser`:**
- Returns user with their roles
- Throws `NotFoundError` for missing user

**`updateUserStatus`:**
- Suspends user + destroys their sessions
- Activates suspended user
- Prevents self-suspension
- Emits correct events

**`listSessions + revokeSession`:**
- Lists all sessions, filters by userId
- Revokes specific session + emits event

- [ ] **Step 2: Write admin routes integration tests**

Create `apps/server/src/modules/admin/__tests__/admin.routes.integration.test.ts`:

Setup: `createTestDb()`, `InMemoryEventBus`, `buildTestApp()`. Seed system roles. Create admin user → assign `admin` role. Create normal user.

Test flows:

**Admin user lifecycle:**
1. `GET /api/admin/users` → 200, includes both users
2. `GET /api/admin/users/:id` → 200, includes roles
3. `PATCH /api/admin/users/:id/status { status: 'suspended' }` → 200, user suspended
4. `PATCH /api/admin/users/:id/status { status: 'active' }` → 200, user reactivated

**Role management:**
1. `POST /api/admin/roles` → 201, custom role created
2. `GET /api/admin/roles` → 200, includes system + custom roles
3. `PUT /api/admin/roles/:id/permissions` → 200, permissions set
4. `POST /api/admin/users/:id/roles` → 201, role assigned
5. `DELETE /api/admin/users/:id/roles/:roleId` → 204, role removed

**Session management:**
1. `GET /api/admin/sessions` → 200, lists sessions
2. `DELETE /api/admin/sessions/:id` → 204, session revoked
3. `DELETE /api/admin/users/:id/sessions` → 200, all sessions for user revoked

**RBAC enforcement:**
1. Non-admin user → 403 on all admin routes
2. Admin without `roles:write` → 403 on role management
3. Super admin → 200 on everything

- [ ] **Step 3: Write audit routes integration tests**

Create `apps/server/src/modules/audit/__tests__/audit.routes.integration.test.ts`:

Setup: same as admin integration. Perform actions that generate audit events.

Test flows:

**Audit trail generation:**
1. Perform admin actions (suspend user, assign role, etc.)
2. `GET /api/admin/audit-logs` → 200, entries exist for each action
3. Filter by `action` → correct subset
4. Filter by `actorId` → correct subset
5. Filter by date range → correct subset

**Audit export:**
1. `GET /api/admin/audit-logs/export` → 200, `application/x-ndjson` content-type
2. Response is valid NDJSON (each line parses as JSON)

**Hash chain integrity:**
1. Create several audit entries via actions
2. Query all entries
3. For each entry after the first, verify `prevHash` matches SHA-256 of previous entry's `id + action + created_at`

**RBAC enforcement:**
1. User without `audit:read` → 403 on query endpoint
2. User without `audit:export` → 403 on export endpoint

- [ ] **Step 4: Run all integration tests**

```bash
cd apps/server && pnpm vitest run src/modules/admin/__tests__/admin.service.integration.test.ts
cd apps/server && pnpm vitest run src/modules/admin/__tests__/admin.routes.integration.test.ts
cd apps/server && pnpm vitest run src/modules/audit/__tests__/audit.routes.integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test: add admin and audit integration tests"
```

---

## Task 16: Backfill isAdmin Users to RBAC Roles

**Files:**
- Modify: `apps/server/src/modules/rbac/rbac.service.ts` — add `backfillAdminRoles`
- Modify: `apps/server/src/app.ts` — call backfill on startup
- Modify: `apps/server/src/modules/admin/__tests__/admin.routes.integration.test.ts` — admin setup via roles

The `users.isAdmin` column and `requireAdmin` plugin are **kept unchanged** — existing `/api/admin/clients` routes continue using them. This task only adds a backfill so existing `isAdmin=true` users also get the `admin` RBAC role (ensuring they work with both the old and new admin systems). Dropping `isAdmin` is deferred to a future cleanup phase.

- [ ] **Step 1: Add backfill function to RBAC service**

Create a startup function that's called after `seedSystemRoles`:

In `apps/server/src/modules/rbac/rbac.service.ts`, add:

```typescript
export async function backfillAdminRoles(db: Database): Promise<void> {
  // Find users with isAdmin=true who don't yet have the admin role
  const adminRole = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, 'admin'))
    .limit(1);

  if (!adminRole[0]) {
    return;
  }

  const adminUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isAdmin, true));

  for (const user of adminUsers) {
    await db
      .insert(userRoles)
      .values({
        userId: user.id,
        roleId: adminRole[0].id,
      })
      .onConflictDoNothing();
  }
}
```

- [ ] **Step 2: Wire backfill into app startup**

In `apps/server/src/app.ts`, after `seedSystemRoles`:

```typescript
await backfillAdminRoles(options.container.db);
```

- [ ] **Step 3: Update admin integration tests**

Update `apps/server/src/modules/admin/__tests__/admin.routes.integration.test.ts` to create admin users via role assignment instead of (or in addition to) `isAdmin: true`, so the tests validate the RBAC path.

Existing `client.routes.integration.test.ts` stays unchanged — it still uses `isAdmin: true` and the `requireAdmin` hook.

- [ ] **Step 4: Run full test suite**

```bash
cd apps/server && pnpm vitest run
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rbac): backfill existing isAdmin users to admin role on startup"
```

---

## Task 17: Audit Log Anonymization on User Deletion (GDPR)

**Files:**
- Modify: `apps/server/src/modules/audit/audit.service.ts` — add `anonymizeActorInAuditLogs`
- Modify: `apps/server/src/modules/audit/audit.listener.ts` — subscribe to user deletion event
- Create: `apps/server/src/modules/audit/__tests__/audit.anonymize.integration.test.ts`

The spec requires that when a user is deleted, `actor_id` in audit logs is set to null (entries are preserved, not deleted).

- [ ] **Step 1: Add anonymization function to audit service**

In `apps/server/src/modules/audit/audit.service.ts`:

```typescript
export async function anonymizeActorInAuditLogs(db: Database, actorId: string): Promise<void> {
  await db
    .update(auditLogs)
    .set({ actorId: null })
    .where(eq(auditLogs.actorId, actorId));
}
```

- [ ] **Step 2: Wire to user deletion event in audit listener**

In `apps/server/src/modules/audit/audit.listener.ts`, check if a user deletion event exists. If the codebase doesn't emit a `user.deleted` event yet, add one:

In `apps/server/src/modules/user/user.events.ts` (or create if not exists):
```typescript
export const USER_EVENTS = {
  DELETED: 'user.deleted',
} as const;
```

Add a subscriber in `registerAuditListener`:
```typescript
eventBus.subscribe('user.deleted', async (event: DomainEvent) => {
  const payload = event.payload as { userId: string };
  await anonymizeActorInAuditLogs(db, payload.userId);
});
```

If user deletion doesn't exist in the codebase yet, this listener is pre-wired for when it does. Add a code comment noting this.

- [ ] **Step 3: Write integration test**

Create `apps/server/src/modules/audit/__tests__/audit.anonymize.integration.test.ts`:

1. Create user → perform actions that generate audit logs with that user as actor
2. Emit `user.deleted` event for that user
3. Query audit logs → verify `actorId` is `null` for that user's entries
4. Verify the entries still exist (not deleted)

- [ ] **Step 4: Run test**

```bash
cd apps/server && pnpm vitest run src/modules/audit/__tests__/audit.anonymize.integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(audit): anonymize actor_id in audit logs on user deletion (GDPR)"
```

---

## Task 18: Audit Chain Verification Endpoint

**Files:**
- Modify: `apps/server/src/modules/audit/audit.service.ts` — add `verifyAuditChain`
- Modify: `apps/server/src/modules/audit/audit.routes.ts` — add verification route
- Modify: `apps/server/src/modules/audit/audit.schemas.ts` — add verification response schema
- Modify: `apps/server/src/modules/audit/__tests__/audit.routes.test.ts` — add test
- Modify: `apps/server/src/modules/audit/__tests__/audit.service.integration.test.ts` — add chain verification test

- [ ] **Step 1: Add verification schema**

In `apps/server/src/modules/audit/audit.schemas.ts`:

```typescript
export const auditChainVerificationResponseSchema = z.object({
  valid: z.boolean(),
  totalEntries: z.number(),
  checkedEntries: z.number(),
  firstInvalidEntryId: z.uuid().nullable(),
});
```

- [ ] **Step 2: Implement chain verification in audit service**

In `apps/server/src/modules/audit/audit.service.ts`:

```typescript
export async function verifyAuditChain(db: Database): Promise<{
  valid: boolean;
  totalEntries: number;
  checkedEntries: number;
  firstInvalidEntryId: string | null;
}> {
  const entries = await db
    .select()
    .from(auditLogs)
    .orderBy(auditLogs.createdAt);

  if (entries.length === 0) {
    return { valid: true, totalEntries: 0, checkedEntries: 0, firstInvalidEntryId: null };
  }

  // First entry should have prevHash = null
  if (entries[0].prevHash !== null) {
    return {
      valid: false,
      totalEntries: entries.length,
      checkedEntries: 1,
      firstInvalidEntryId: entries[0].id,
    };
  }

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const expectedHash = computeHash(prev.id, prev.action, prev.createdAt);
    if (entries[i].prevHash !== expectedHash) {
      return {
        valid: false,
        totalEntries: entries.length,
        checkedEntries: i + 1,
        firstInvalidEntryId: entries[i].id,
      };
    }
  }

  return {
    valid: true,
    totalEntries: entries.length,
    checkedEntries: entries.length,
    firstInvalidEntryId: null,
  };
}
```

- [ ] **Step 3: Add verification route**

In `apps/server/src/modules/audit/audit.routes.ts`:

```typescript
fastify.get(
  '/verify',
  {
    preHandler: fastify.requirePermission('audit', 'read'),
    schema: {
      response: { 200: auditChainVerificationResponseSchema },
    },
  },
  async () => {
    return verifyAuditChain(db);
  },
);
```

- [ ] **Step 4: Add route unit test**

In `audit.routes.test.ts`, add test for `GET /api/admin/audit-logs/verify` → returns 200 with chain verification result.

- [ ] **Step 5: Add integration test for verification**

In `audit.service.integration.test.ts`, add test:
- Insert 5 audit entries → verify chain is valid
- Manually corrupt one entry's `prevHash` → verify chain reports invalid with correct `firstInvalidEntryId`

- [ ] **Step 6: Run tests**

```bash
cd apps/server && pnpm vitest run src/modules/audit/
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(audit): add audit chain verification endpoint"
```

---

## Task 19: Final Verification

- [ ] **Step 1: Run full unit test suite**

```bash
cd apps/server && pnpm test:unit
```

- [ ] **Step 2: Run full integration test suite**

```bash
cd apps/server && pnpm test:integration
```

- [ ] **Step 3: Run biome lint**

```bash
pnpm biome check apps/server/src/modules/admin apps/server/src/modules/audit apps/server/src/modules/rbac apps/server/src/core/plugins/rbac.ts
```

Fix any issues.

- [ ] **Step 4: Build all packages**

```bash
pnpm build
```

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "chore: fix lint and build issues"
```

---

## Task Dependency Graph

```
Task 1 (DB schema) ─── Task 2 (RBAC schemas/events)
                          │
                       Task 3 (RBAC service)
                          │
                       Task 4 (RBAC integration tests)
                          │
                       Task 5 (RBAC middleware plugin)
                          │
                  ┌───────┼───────────────┐
                  │       │               │
               Task 6  Task 9          Task 10
             (admin     (audit         (audit
              schemas)   schemas)       service)
                  │       │               │
               Task 7   Task 11        Task 12
             (admin     (audit          (audit
              service)   integ tests)    routes)
                  │                       │
               Task 8                  Task 13
             (admin                   (audit
              routes)                  listener)
                  │                       │
                  └───────┬───────────────┘
                          │
                       Task 14 (module wiring)
                          │
                       Task 15 (integration tests)
                          │
                  ┌───────┼───────────────┐
                  │       │               │
               Task 16 Task 17        Task 18
             (backfill  (GDPR          (chain
              isAdmin)   anonymize)     verify)
                  │       │               │
                  └───────┼───────────────┘
                          │
                       Task 19 (final verification)
```

Tasks 6+7+8 (admin) and Tasks 9+10+11+12+13 (audit) can run **in parallel** after Task 5.
Task 14 depends on both branches completing.
Tasks 16, 17, 18 can run **in parallel** after Task 15.
Task 19 depends on all previous tasks.
