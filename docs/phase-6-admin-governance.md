# Identity Starter — Phase 6: Admin & Governance

**Status: NOT STARTED**

## Overview

Add admin user management, role-based access control (RBAC), and audit logging. The admin API provides a management plane for the identity system — user lifecycle, role assignment, session management, and a tamper-proof audit trail.

---

## Scope

### New Modules
- **Admin module** — Admin-only user management, session management, role management
- **RBAC module** — Roles, permissions, and assignment logic
- **Audit module** — Append-only audit log for security-relevant actions

### New DB Tables
- `roles` — Role definitions (system + custom)
- `permissions` — Resource + action pairs
- `role_permissions` — Many-to-many role ↔ permission
- `user_roles` — Many-to-many user ↔ role with assignment tracking
- `audit_logs` — Append-only audit trail

### Explicitly Deferred
- Admin dashboard UI → Phase 7

---

## Architecture Decisions

### RBAC Model: Role → Permission → Resource:Action
- Permissions are `resource:action` pairs (e.g., `users:read`, `clients:delete`)
- Roles aggregate permissions (e.g., `admin` has `users:read`, `users:write`, `sessions:revoke`)
- Users are assigned roles, checked via middleware
- System roles (`super_admin`, `admin`, `user`) cannot be deleted

### Audit Log: Append-Only
- No UPDATE or DELETE on `audit_logs` — insert only
- Records actor, action, resource, before/after snapshots, IP address
- Hooks into event bus — auth, session, user, OAuth events all generate audit entries
- Queryable with filters (actor, action, resource, date range) + pagination

### Admin Auth: Session + Role Check
- Admin routes require a valid session AND a role with the required permission
- Replaces the Phase 5 "bridge auth" pattern with proper RBAC middleware

---

## Features

### Admin User Management
- List users (paginated, filterable by status/email)
- Get user detail (includes roles)
- Suspend / activate user
- Force-revoke all user sessions

### Role Management
- Create custom roles
- List roles (with permission counts)
- Set permissions for a role
- Assign / remove roles from users
- System roles are read-only

### Session Management (Admin)
- List all active sessions (paginated)
- Revoke any session
- Bulk revoke sessions by user

### Audit Logging
- Auto-capture all security-relevant events via event bus listener
- Query audit logs with filters: actor, action, resource type, resource ID, date range
- Paginated results, ordered by timestamp descending

---

## DB Schema

### roles

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `name` | `varchar(100)` | UNIQUE, NOT NULL | — |
| `description` | `text` | NULLABLE | — |
| `is_system` | `boolean` | NOT NULL | `false` |
| `created_at` | `timestamp` | NOT NULL | `now()` |

### permissions

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `resource` | `varchar(100)` | NOT NULL | — |
| `action` | `varchar(100)` | NOT NULL | — |
| UNIQUE | | `(resource, action)` | — |

### role_permissions

| Column | Type | Constraints |
|--------|------|-------------|
| `role_id` | `uuid` | FK → `roles.id`, PK |
| `permission_id` | `uuid` | FK → `permissions.id`, PK |

### user_roles

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `user_id` | `uuid` | FK → `users.id`, PK | — |
| `role_id` | `uuid` | FK → `roles.id`, PK | — |
| `assigned_at` | `timestamp` | NOT NULL | `now()` |
| `assigned_by` | `uuid` | FK → `users.id` | — |

### audit_logs

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| `id` | `uuid` | PK | `uuidv7()` |
| `actor_id` | `uuid` | NULLABLE (no FK — survives user deletion) | — |
| `action` | `varchar(100)` | NOT NULL | — |
| `resource_type` | `varchar(100)` | NOT NULL | — |
| `resource_id` | `uuid` | NULLABLE | — |
| `details` | `jsonb` | NOT NULL | `{}` |
| `ip_address` | `varchar(45)` | NULLABLE | — |
| `created_at` | `timestamp` | NOT NULL | `now()` |
| `prev_hash` | `varchar(64)` | NULLABLE | — |

**Note**: `audit_logs` has no UPDATE/DELETE — append-only by design.

---

## API Routes

### Admin User Routes (`/api/admin/users/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/users` | Admin (`users:read`) | List users (paginated) |
| GET | `/api/admin/users/:id` | Admin (`users:read`) | Get user detail |
| PATCH | `/api/admin/users/:id/status` | Admin (`users:write`) | Suspend / activate user |

### Admin Role Routes (`/api/admin/roles/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/roles` | Admin (`roles:write`) | Create role |
| GET | `/api/admin/roles` | Admin (`roles:read`) | List roles |
| PUT | `/api/admin/roles/:id/permissions` | Admin (`roles:write`) | Set role permissions |
| POST | `/api/admin/users/:id/roles` | Admin (`roles:write`) | Assign role to user |
| DELETE | `/api/admin/users/:id/roles/:roleId` | Admin (`roles:write`) | Remove role from user |

### Admin Session Routes (`/api/admin/sessions/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/sessions` | Admin (`sessions:read`) | List active sessions |
| DELETE | `/api/admin/sessions/:id` | Admin (`sessions:write`) | Revoke session |

### Audit Log Routes (`/api/admin/audit-logs/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/audit-logs` | Admin (`audit:read`) | Query audit logs (filtered, paginated) |
| GET | `/api/admin/audit-logs/export` | Admin (`audit:export`) | Export audit logs (JSON lines) |

---

## Events

### Admin Events
- `admin.user_suspended`, `admin.user_activated`
- `admin.session_revoked`
- `admin.role_created`, `admin.role_updated`
- `admin.role_assigned`, `admin.role_removed`

All events are automatically captured by the audit module listener.

---

## Cross-Module Dependencies

- **Admin module** → `@identity-starter/db` (users, sessions tables), RBAC middleware
- **RBAC module** → `@identity-starter/db` (roles, permissions, role_permissions, user_roles tables)
- **Audit module** → `@identity-starter/db` (audit_logs table), Event bus (listens to all events)

---

## Testing Strategy

### Unit Tests
- **Admin service**: user list/suspend/activate, session revoke
- **RBAC service**: role CRUD, permission check, role assignment
- **Audit service**: log creation, query with filters
- **RBAC middleware**: permission check logic, role resolution

### Integration Tests
- Admin user lifecycle: create user → assign role → suspend → activate
- RBAC enforcement: user without required role gets 403
- Audit trail: perform actions → query audit logs → verify entries
- System role protection: cannot delete system roles
- Audit log hash chain: create entries → verify chain integrity
- User deletion: audit logs anonymized (actor_id set to null), entries preserved

---

## Seed Data

System roles seeded on first migration:
- `super_admin` — all permissions
- `admin` — user management + session management + audit read
- `user` — no admin permissions (default role for new users)

---

## Data Retention & Compliance

### Audit Log Retention
- Default retention: 90 days for non-critical events, 1 year for auth/security events
- Configurable via `AUDIT_RETENTION_DAYS` env var
- Pruning: scheduled job deletes entries older than retention period
- Export before deletion: `GET /api/admin/audit-logs/export` with date range filter

### Audit Log Integrity
- Each entry includes `prev_hash` — SHA-256 of the previous entry's `id + action + created_at`
- Enables tamper detection: verify chain integrity via admin endpoint
- Not a blockchain — simple hash chain for basic tamper evidence

### GDPR / Privacy Considerations
- **Right to be forgotten**: user deletion anonymizes `actor_id` in audit logs (set to null), does not delete entries (legal requirement to retain security logs)
- **Data portability**: `GET /api/account/export` (Phase 4) returns user profile + sessions + passkeys + consent grants as JSON
- **Consent records**: consent grants are retained even after revocation (audit trail)
- **Data minimization**: audit log `details` field should not contain PII beyond what's necessary for security investigation

### Audit Log Export
- `GET /api/admin/audit-logs/export` — returns JSON lines format
- Filterable by: date range, actor, action, resource type
- Protected by `audit:export` permission

---

## Prerequisites

- Phase 2-4 complete (auth + sessions + accounts)
- Phase 5 complete (OAuth2 — client management routes need RBAC)
