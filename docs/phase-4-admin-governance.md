# Identity Starter — Phase 4: Admin & Governance

**Status: NOT STARTED**

## Overview

Add administrative capabilities, role-based access control, audit logging, and an admin dashboard. This phase makes the IdP production-observable and manageable.

---

## Scope

### New Modules
- **RBAC module** — Roles, permissions, role assignments
- **Audit module** — Audit log capture and querying
- **Admin module** — Admin API endpoints (aggregates other modules)

### New App
- **Admin dashboard** (`apps/admin/`) — Separate Next.js admin UI

### New DB Tables
- `roles` — Role definitions
- `permissions` — Permission definitions
- `role_permissions` — Many-to-many: roles ↔ permissions
- `user_roles` — Many-to-many: users ↔ roles
- `audit_logs` — Append-only audit trail

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
- The Admin module doesn't own data — it aggregates existing module services behind admin-only routes under `/api/admin/*`
- All routes require RBAC permissions (e.g., `users:read`, `clients:write`, `audit:read`)
- Provides admin-specific views (e.g., user detail with sessions + passkeys + roles) that span multiple modules
- User CRUD routes (`/api/admin/users/*`) appear here — this is the first time user management is exposed over HTTP
- Retrofits Phase 3's client management routes with proper RBAC permission checks

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
- Automatic capture from event bus (user, auth, session, client, oauth, rbac events)
- Structured log entries: actorId, actorType, action, resource, resourceId, metadata, ipAddress, timestamp
- Query API with filtering: by actorId, action, resource, date range, with pagination
- Append-only — repository exposes only `create()` and `find*()`

### Admin API (`/api/admin/*`)
- **User management**: create, search (with filters), view detail (sessions, passkeys, roles), update, suspend/activate, delete
- **Client management**: retrofits Phase 3's client routes (`/api/admin/clients/*`) with proper RBAC permissions
- **Session management**: list all active sessions (filterable by user), revoke any session
- **Role/permission management**: full CRUD, assign/revoke roles to users
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

## DB Schema

### roles
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | nanoid |
| name | text | unique — e.g., 'admin', 'user' |
| description | text | nullable |
| isSystem | boolean | true for built-in roles (cannot be deleted) |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### permissions
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | nanoid |
| resource | text | e.g., 'users', 'clients', 'audit' |
| action | text | e.g., 'read', 'write', 'delete' |
| description | text | nullable |
| createdAt | timestamp | |

Unique constraint on (resource, action).

### role_permissions
| Column | Type | Notes |
|--------|------|-------|
| roleId | text FK | → roles.id |
| permissionId | text FK | → permissions.id |

Composite PK: (roleId, permissionId).

### user_roles
| Column | Type | Notes |
|--------|------|-------|
| userId | text FK | → users.id |
| roleId | text FK | → roles.id |
| assignedAt | timestamp | |

Composite PK: (userId, roleId).

### audit_logs
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | nanoid |
| actorId | text | nullable — null for system actions (no FK, intentional) |
| actorType | text | 'user' / 'system' / 'client' |
| action | text | e.g., 'user.created', 'auth.login' |
| resource | text | e.g., 'user', 'session', 'client' |
| resourceId | text | nullable — ID of affected resource |
| metadata | jsonb | additional context |
| ipAddress | text | nullable |
| timestamp | timestamp | indexed |

Indexes: timestamp, actorId, action, resource.

---

## API Routes

All admin routes live under `/api/admin/*` and require RBAC permissions. Phase 4 also retrofits Phase 3's client routes (`/api/admin/clients/*`) with proper RBAC.

### User Management (`/api/admin/users/*`)
| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| POST | `/api/admin/users` | `users:write` | Create user (optional password, hashed server-side) |
| GET | `/api/admin/users` | `users:read` | List/search users (paginated, filterable) |
| GET | `/api/admin/users/:id` | `users:read` | User detail (+ sessions, roles, passkeys) |
| PATCH | `/api/admin/users/:id` | `users:write` | Update user |
| DELETE | `/api/admin/users/:id` | `users:delete` | Delete user |
| POST | `/api/admin/users/:id/suspend` | `users:write` | Suspend user |
| POST | `/api/admin/users/:id/activate` | `users:write` | Activate user |
| POST | `/api/admin/users/:id/roles` | `roles:write` | Assign role to user |
| DELETE | `/api/admin/users/:id/roles/:roleId` | `roles:write` | Revoke role from user |

### Roles & Permissions (`/api/admin/roles/*`, `/api/admin/permissions`)
| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| POST | `/api/admin/roles` | `roles:write` | Create role |
| GET | `/api/admin/roles` | `roles:read` | List roles |
| GET | `/api/admin/roles/:id` | `roles:read` | Get role with permissions |
| PATCH | `/api/admin/roles/:id` | `roles:write` | Update role |
| DELETE | `/api/admin/roles/:id` | `roles:delete` | Delete role (non-system only) |
| POST | `/api/admin/roles/:id/permissions` | `roles:write` | Add permissions to role |
| DELETE | `/api/admin/roles/:id/permissions/:pid` | `roles:write` | Remove permission from role |
| GET | `/api/admin/permissions` | `roles:read` | List all permissions |

### Sessions (`/api/admin/sessions/*`)
| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/admin/sessions` | `sessions:read` | List all active sessions (filterable) |
| DELETE | `/api/admin/sessions/:id` | `sessions:revoke` | Revoke any session |

### Audit Logs (`/api/admin/audit-logs/*`)
| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/admin/audit-logs` | `audit:read` | Query audit logs with filters |
| GET | `/api/admin/audit-logs/export` | `audit:export` | Export audit logs as JSON |

### System Stats
| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/admin/stats` | `audit:read` | System overview (user count, active sessions, client count) |

---

## Events

### RBAC Events
- `rbac.role_created`, `rbac.role_updated`, `rbac.role_deleted`
- `rbac.role_assigned`, `rbac.role_revoked`
- `rbac.permission_created`

### Audit Events
- `audit.entry_created`

---

## Cross-Module Dependencies

- **RBAC module** → User module (user existence check for role assignment)
- **Audit module** → Event bus (subscribes to all module events); standalone for data
- **Admin module** → User, Session, Passkey, Client, RBAC, Audit modules

---

## Seeding / Bootstrap

On first run (or via a seed script):
1. Create built-in permissions: `users:read/write/delete`, `clients:read/write/delete`, `sessions:read/revoke`, `roles:read/write/delete`, `audit:read/export`
2. Create built-in roles: `super_admin` (all), `admin` (all except `roles:delete`), `user` (self-service only)
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
- All `/api/admin/*` routes require RBAC permissions — test 403 for missing permissions
- Test user management routes (CRUD, suspend/activate, role assignment)
- Test RBAC routes with various role/permission combinations
- Test audit log query with filters and pagination
- Test admin stats endpoint
- Verify Phase 3 client routes now enforced with RBAC

### Integration Tests
- Full flow: create user → assign admin role → access admin routes
- Admin user management flow: create user via admin → suspend → activate → delete
- Audit trail verification: perform actions → query audit log → verify entries
- Permission enforcement: attempt operations without required permissions → verify 403

---

## Prerequisites

- Phase 1 complete ✅
- Phase 2 complete (authentication + session middleware required)
- Phase 3 complete (OAuth clients to manage via admin)
