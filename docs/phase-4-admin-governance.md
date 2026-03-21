# Identity Starter — Phase 4: Admin & Governance

**Status: NOT STARTED**

## Overview

Add administrative capabilities, role-based access control, audit logging, and an admin dashboard. This phase makes the IdP production-observable and manageable.

---

## Scope

### New Modules
- **RBAC module** (`apps/server/src/modules/rbac/`) — Roles, permissions, role assignments
- **Audit module** (`apps/server/src/modules/audit/`) — Audit log capture and querying
- **Admin module** (`apps/server/src/modules/admin/`) — Admin API endpoints

### New App
- **Admin dashboard** (`apps/admin/`) — Next.js admin UI

### New DB Tables
- `roles` — Role definitions (name, description)
- `permissions` — Permission definitions (resource, action)
- `role_permissions` — Many-to-many: roles ↔ permissions
- `user_roles` — Many-to-many: users ↔ roles
- `audit_logs` — Immutable audit trail (actor, action, resource, metadata, timestamp)

---

## Features (Planned)

### RBAC
- Role CRUD
- Permission CRUD
- Assign/revoke roles to users
- Permission checks middleware
- Built-in roles (admin, user)

### Audit Logging
- Automatic capture from event bus (user.created, auth.login, etc.)
- Structured log entries with actor, action, resource, metadata
- Query API with filtering (by actor, action, date range)
- Immutable — no updates or deletes

### Admin API
- User management (search, suspend, activate, delete)
- Client management (create, update, revoke)
- Session management (list active, revoke)
- Role/permission management
- Audit log viewer

### Admin Dashboard
- User list with search and filters
- User detail view (sessions, passkeys, roles)
- OAuth client management
- Audit log viewer with filtering
- System health overview

---

## Prerequisites

- Phase 1 complete ✅
- Phase 2 complete (authentication required)
- Phase 3 complete (OAuth clients to manage)
