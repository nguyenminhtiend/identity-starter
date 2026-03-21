# Identity Starter — Phase 4: Admin & Governance

**Status: NOT STARTED**

## Overview

Add administrative capabilities, role-based access control, audit logging, and an admin dashboard. This phase makes the IdP production-observable and manageable.

---

## Scope

### New Modules
- **RBAC module** (`apps/server/src/modules/rbac/`) — Roles, permissions, role assignments
- **Audit module** (`apps/server/src/modules/audit/`) — Audit log capture and querying
- **Admin module** (`apps/server/src/modules/admin/`) — Admin API endpoints (aggregates other modules)

### New App
- **Admin dashboard** (`apps/admin/`) — Separate Next.js admin UI

### New DB Tables
- `roles` — Role definitions (id, name, description, isSystem, createdAt, updatedAt)
- `permissions` — Permission definitions (id, resource, action, description, createdAt)
- `role_permissions` — Many-to-many: roles ↔ permissions
- `user_roles` — Many-to-many: users ↔ roles
- `audit_logs` — Append-only audit trail (id, actorId, actorType, action, resource, resourceId, metadata, ipAddress, timestamp)

---

## Architecture Decisions

### RBAC Model
- **Role-based** — Users are assigned roles, roles have permissions
- **Permission format**: `resource:action` (e.g., `users:read`, `clients:delete`, `audit:read`)
- **Built-in system roles** (non-deletable):
  - `super_admin` — All permissions, cannot be removed
  - `admin` — User management, client management, audit viewing
  - `user` — Default role assigned on registration (basic self-service)
- Custom roles can be created with any subset of permissions
- Permission check middleware: `requirePermission('users:write')` Fastify hook

### Audit Log Design
- **Append-only** — No updates or deletes on audit_logs table (enforced at repository level)
- **Event-driven capture** — Audit module subscribes to events from all other modules via the event bus
- **No separate audit service calls** — Other modules don't need to know about audit logging
- **Structured entries** with: actor (who), action (what), resource (on what), metadata (context)
- **Same PostgreSQL database** — Append-only table, indexed by timestamp + actorId + action
- **Retention** — Not enforced in Phase 4 (can add partitioning/archival later)

### Admin Module as Aggregator
- The Admin module doesn't own data — it aggregates existing module services behind admin-only routes
- Admin routes require `admin` or `super_admin` role
- Provides admin-specific views (e.g., user detail with sessions + passkeys + roles) that span multiple modules

### Separate Admin Dashboard (`apps/admin/`)
- Separate from the user-facing `apps/web/` — different security posture and audience
- Can be deployed to a different subdomain (e.g., `admin.example.com`)
- Shares the same API server but uses admin-only endpoints

---

## Features

### RBAC
- Role CRUD (create, read, update, delete — system roles cannot be deleted)
- Permission CRUD (define available permissions)
- Assign/revoke roles to users
- Permission check middleware for route-level authorization
- Built-in roles seeded on first run (super_admin, admin, user)
- Users can have multiple roles — permissions are unioned

### Audit Logging
- Automatic capture from event bus:
  - `user.*` events → audit entries
  - `auth.*` events → audit entries (login, logout, failed login, password change)
  - `session.*` events → audit entries
  - `client.*` events → audit entries
  - `oauth.*` events → audit entries
  - `rbac.*` events → audit entries (role assignments, permission changes)
- Structured log entries: `{ actorId, actorType, action, resource, resourceId, metadata, ipAddress, timestamp }`
- Query API with filtering: by actorId, action, resource, date range, with pagination
- Append-only — repository exposes only `create()` and `find*()`

### Admin API
- **User management**: search users (with filters), view user detail (sessions, passkeys, roles), suspend/activate, delete
- **Client management**: list clients, view client detail, create/update/delete clients
- **Session management**: list active sessions (by user or all), revoke sessions
- **Role/permission management**: full CRUD, assign/revoke roles
- **Audit log viewer**: query with filters, export (JSON)
- **System stats**: user count, active sessions, client count (simple aggregates)

### Admin Dashboard (Next.js)
- Login (uses same auth system, requires admin role)
- User list with search, status filters, and pagination
- User detail view (profile, sessions, passkeys, roles)
- OAuth client list and management
- Role and permission management
- Audit log viewer with date range, actor, and action filters
- Simple system overview dashboard (counts and recent activity)

---

## Module File Structure

### RBAC Module
```
apps/server/src/modules/rbac/
├── rbac.schemas.ts         # Zod: createRole, createPermission, assignRole
├── rbac.types.ts           # Role, Permission, UserRole types
├── rbac.repository.ts      # DB CRUD for roles, permissions, role_permissions, user_roles
├── rbac.service.ts         # createRole(), assignRole(), checkPermission(), getUserPermissions()
├── rbac.middleware.ts      # requirePermission() Fastify hook
├── rbac.routes.ts          # CRUD routes for roles/permissions
├── rbac.seed.ts            # Seed built-in roles and permissions
├── rbac.events.ts          # RbacEvents type
├── index.ts                # Public API barrel
└── __tests__/
    ├── rbac.service.test.ts
    ├── rbac.middleware.test.ts
    └── rbac.routes.test.ts
```

### Audit Module
```
apps/server/src/modules/audit/
├── audit.schemas.ts        # Zod: auditQuery (filters, pagination)
├── audit.types.ts          # AuditEntry type
├── audit.repository.ts     # Append-only: create(), findByQuery()
├── audit.service.ts        # log(), query() — subscribes to event bus
├── audit.subscriber.ts     # Event bus subscriptions, maps events → audit entries
├── audit.routes.ts         # GET /audit-logs (admin-only)
├── audit.events.ts         # AuditEvents type (if needed)
├── index.ts                # Public API barrel
└── __tests__/
    ├── audit.service.test.ts
    ├── audit.subscriber.test.ts
    └── audit.routes.test.ts
```

### Admin Module
```
apps/server/src/modules/admin/
├── admin.schemas.ts        # Zod: admin search/filter schemas
├── admin.types.ts          # Admin-specific aggregate types (UserDetail, SystemStats)
├── admin.service.ts        # Aggregates other module services
├── admin.routes.ts         # Admin-only routes
├── index.ts                # Public API barrel
└── __tests__/
    └── admin.routes.test.ts
```

### DB Schema Additions
```
packages/db/src/schema/
├── user.ts                 # (existing)
├── session.ts              # (Phase 2)
├── passkey.ts              # (Phase 2)
├── oauth-client.ts         # (Phase 3)
├── authorization-code.ts   # (Phase 3)
├── refresh-token.ts        # (Phase 3)
├── consent-grant.ts        # (Phase 3)
├── role.ts                 # roles table
├── permission.ts           # permissions table
├── role-permission.ts      # role_permissions join table
├── user-role.ts            # user_roles join table
├── audit-log.ts            # audit_logs append-only table
└── index.ts                # Updated barrel export
```

---

## API Routes

### RBAC Routes (Admin-Only)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/roles` | Admin | Create role |
| GET | `/api/roles` | Admin | List roles |
| GET | `/api/roles/:id` | Admin | Get role with permissions |
| PATCH | `/api/roles/:id` | Admin | Update role |
| DELETE | `/api/roles/:id` | Admin | Delete role (non-system only) |
| POST | `/api/roles/:id/permissions` | Admin | Add permissions to role |
| DELETE | `/api/roles/:roleId/permissions/:permissionId` | Admin | Remove permission from role |
| GET | `/api/permissions` | Admin | List all permissions |
| POST | `/api/users/:id/roles` | Admin | Assign role to user |
| DELETE | `/api/users/:userId/roles/:roleId` | Admin | Revoke role from user |

### Audit Routes (Admin-Only)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/audit-logs` | Admin | Query audit logs with filters |
| GET | `/api/audit-logs/export` | Admin | Export audit logs as JSON |

### Admin Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/users` | Admin | Search users with filters |
| GET | `/api/admin/users/:id` | Admin | User detail (sessions, passkeys, roles) |
| GET | `/api/admin/stats` | Admin | System stats (counts) |

---

## Events

```typescript
type RbacEvents = {
  'rbac.role_created': { roleId: string; name: string }
  'rbac.role_updated': { roleId: string }
  'rbac.role_deleted': { roleId: string }
  'rbac.role_assigned': { userId: string; roleId: string }
  'rbac.role_revoked': { userId: string; roleId: string }
  'rbac.permission_created': { permissionId: string; resource: string; action: string }
}

type AuditEvents = {
  'audit.entry_created': { entryId: string; action: string }
}
```

---

## DB Schema Design

### roles
```typescript
{
  id: string              // nanoid
  name: string            // unique — e.g., 'admin', 'user'
  description: string | null
  isSystem: boolean       // true for built-in roles (cannot be deleted)
  createdAt: Date
  updatedAt: Date
}
```

### permissions
```typescript
{
  id: string              // nanoid
  resource: string        // e.g., 'users', 'clients', 'audit'
  action: string          // e.g., 'read', 'write', 'delete'
  description: string | null
  createdAt: Date
}
// unique constraint on (resource, action)
```

### role_permissions
```typescript
{
  roleId: string          // FK → roles.id
  permissionId: string    // FK → permissions.id
  // composite PK: (roleId, permissionId)
}
```

### user_roles
```typescript
{
  userId: string          // FK → users.id
  roleId: string          // FK → roles.id
  assignedAt: Date
  // composite PK: (userId, roleId)
}
```

### audit_logs
```typescript
{
  id: string              // nanoid
  actorId: string | null  // who performed the action (null for system actions)
  actorType: string       // 'user' | 'system' | 'client'
  action: string          // e.g., 'user.created', 'auth.login', 'rbac.role_assigned'
  resource: string        // e.g., 'user', 'session', 'client'
  resourceId: string | null // ID of the affected resource
  metadata: Record<string, unknown>  // JSONB — additional context
  ipAddress: string | null
  timestamp: Date         // indexed
}
// Indexes: timestamp, actorId, action, resource
```

---

## Cross-Module Dependencies

```
RBAC module
  └── depends on: User module (user existence check for role assignment)

Audit module
  └── depends on: Event bus (subscribes to all module events)
  └── standalone for data — no module dependencies

Admin module
  ├── depends on: User module (user search, detail)
  ├── depends on: Session module (list/revoke sessions)
  ├── depends on: Passkey module (list user passkeys)
  ├── depends on: Client module (client management)
  ├── depends on: RBAC module (role management, permission checks)
  └── depends on: Audit module (audit log queries)
```

---

## Seeding / Bootstrap

On first run (or via a seed script):
1. Create built-in permissions:
   - `users:read`, `users:write`, `users:delete`
   - `clients:read`, `clients:write`, `clients:delete`
   - `sessions:read`, `sessions:revoke`
   - `roles:read`, `roles:write`, `roles:delete`
   - `audit:read`, `audit:export`
2. Create built-in roles:
   - `super_admin` — all permissions
   - `admin` — all except `roles:delete`
   - `user` — no admin permissions (self-service only via Phase 2 routes)
3. Assign `super_admin` to the first created user (or via env var `ADMIN_EMAIL`)

---

## Testing Strategy

### Unit Tests
- **RBAC service**: Mock repository, test role/permission CRUD, assignment, permission checking
- **RBAC middleware**: Mock service, test route-level permission enforcement
- **Audit service**: Mock repository, test event-to-audit mapping
- **Audit subscriber**: Mock service, test all event subscriptions produce correct audit entries
- **Admin service**: Mock all dependent services, test aggregation logic

### Route Tests
- All admin routes require admin role — test 403 for non-admin users
- Test RBAC routes with various role/permission combinations
- Test audit log query with filters and pagination
- Test admin aggregate endpoints

### Integration Tests
- Full flow: create user → assign admin role → access admin routes
- Audit trail verification: perform actions → query audit log → verify entries
- Permission enforcement: attempt operations without required permissions → verify 403

---

## Prerequisites

- Phase 1 complete ✅
- Phase 2 complete (authentication + session middleware required)
- Phase 3 complete (OAuth clients to manage via admin)
