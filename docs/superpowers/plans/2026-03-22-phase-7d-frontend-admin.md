# Phase 7d: Frontend Admin Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin dashboard — user management, role management, session management, and audit log viewer, all protected by RBAC.

**Architecture:** Admin pages extend the dashboard layout from Plan 7b with admin-specific nav items. Server Components load paginated data with URL search params. TanStack Query mutations for actions (revoke, suspend, role assignment). Admin route guard checks user roles via a profile+roles API call. Tables use shadcn `<Table>` components; add `@tanstack/react-table` later if sorting/column-resize is needed.

**Tech Stack:** Next.js 15, React 19, TanStack Query, shadcn/ui

**Prerequisite:** Plan 7b complete (dashboard layout). Phase 6 Admin API available.
**Phase doc:** `docs/phase-7-frontend.md`
**API spec:** `docs/phase-6-admin-governance.md`

> **BLOCKED:** This plan requires Phase 6 admin routes to be implemented on the server. As of writing, Phase 6 is NOT STARTED. The current server uses a simple `isAdmin` boolean flag (via `apps/server/src/core/plugins/admin.ts`). Phase 6 will replace this with proper RBAC (roles table, permissions, `requirePermission` middleware). **Do not start this plan until Phase 6 routes return 200 for admin users.** If implementing incrementally before full RBAC, the admin layout guard can temporarily check the `isAdmin` flag instead of role names.

---

## File Map

- Modify: `apps/web/src/components/account/dashboard-nav.tsx` — add admin nav items
- Create: `apps/web/src/app/(dashboard)/admin/layout.tsx` — admin route guard
- Create: `apps/web/src/app/(dashboard)/admin/page.tsx` — overview redirect
- Create: `apps/web/src/app/(dashboard)/admin/users/page.tsx`
- Create: `apps/web/src/app/(dashboard)/admin/users/[id]/page.tsx`
- Create: `apps/web/src/app/(dashboard)/admin/roles/page.tsx`
- Create: `apps/web/src/app/(dashboard)/admin/sessions/page.tsx`
- Create: `apps/web/src/app/(dashboard)/admin/audit-logs/page.tsx`
- Create: `apps/web/src/components/admin/user-table.tsx`
- Create: `apps/web/src/components/admin/user-detail.tsx`
- Create: `apps/web/src/components/admin/role-list.tsx`
- Create: `apps/web/src/components/admin/create-role-dialog.tsx`
- Create: `apps/web/src/components/admin/session-table.tsx`
- Create: `apps/web/src/components/admin/audit-log-table.tsx`
- Create: `apps/web/src/components/admin/pagination.tsx`
- Create: `apps/web/src/types/admin.ts`
- Create: `apps/web/e2e/admin.spec.ts`

---

## API Reference (from Phase 6)

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/api/admin/users` | `users:read` | List users (paginated, filterable) |
| GET | `/api/admin/users/:id` | `users:read` | User detail with roles |
| PATCH | `/api/admin/users/:id/status` | `users:write` | Suspend/activate |
| POST | `/api/admin/roles` | `roles:write` | Create role |
| GET | `/api/admin/roles` | `roles:read` | List roles with permission counts |
| PUT | `/api/admin/roles/:id/permissions` | `roles:write` | Set role permissions |
| POST | `/api/admin/users/:id/roles` | `roles:write` | Assign role |
| DELETE | `/api/admin/users/:id/roles/:roleId` | `roles:write` | Remove role |
| GET | `/api/admin/sessions` | `sessions:read` | List all sessions (paginated) |
| DELETE | `/api/admin/sessions/:id` | `sessions:write` | Revoke session |
| DELETE | `/api/admin/users/:id/sessions` | `sessions:write` | Bulk revoke user sessions |
| GET | `/api/admin/audit-logs` | `audit:read` | Query audit logs (filterable, paginated) |
| GET | `/api/admin/audit-logs/export` | `audit:export` | Export as NDJSON |
| GET | `/api/admin/audit-logs/verify` | `audit:read` | Verify hash chain integrity |

---

## Task 1: Admin Types + Dependencies

**Files:**
- Create: `apps/web/src/types/admin.ts`

- [ ] **Step 1: Define admin types**

Create `apps/web/src/types/admin.ts`:

```typescript
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'suspended' | 'pending_verification';
  createdAt: string;
}

export interface AdminUserDetail extends AdminUser {
  emailVerified: boolean;
  roles: Array<{ id: string; name: string }>;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  permissionCount: number;
}

export interface Permission {
  id: string;
  resource: string;
  action: string;
}

export interface AdminSession {
  id: string;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
  prevHash: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ChainVerification {
  valid: boolean;
  totalEntries: number;
  checkedEntries: number;
  firstInvalidEntryId: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(web): add admin dashboard types"
```

---

## Task 2: Pagination Component

**Files:**
- Create: `apps/web/src/components/admin/pagination.tsx`

- [ ] **Step 1: Create pagination component**

Create `apps/web/src/components/admin/pagination.tsx`:

```tsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  limit: number;
  total: number;
}

export function Pagination({ page, limit, total }: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const totalPages = Math.ceil(total / limit);

  function goToPage(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(newPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          disabled={page <= 1}
          onClick={() => goToPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="icon"
          disabled={page >= totalPages}
          onClick={() => goToPage(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(web): add reusable pagination component"
```

---

## Task 3: Admin Route Guard + Layout

**Files:**
- Create: `apps/web/src/app/(dashboard)/admin/layout.tsx`
- Create: `apps/web/src/app/(dashboard)/admin/page.tsx`
- Modify: `apps/web/src/components/account/dashboard-nav.tsx`

- [ ] **Step 1: Create admin layout with role guard**

Create `apps/web/src/app/(dashboard)/admin/layout.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/api-client';
import type { AdminUserDetail } from '@/types/admin';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Phase 6 RBAC approach: fetch user detail with roles from admin endpoint.
  // The admin endpoint itself requires the `users:read` permission — if the
  // user lacks it, the server returns 403, caught below.
  //
  // Pre-Phase 6 fallback: if the server still uses the simple `isAdmin` boolean,
  // replace this with a profile fetch that includes `isAdmin` and check that flag.
  let user: AdminUserDetail;
  try {
    const profile = await serverFetch<{ id: string }>('/api/account/profile');
    user = await serverFetch<AdminUserDetail>(`/api/admin/users/${profile.id}`);
  } catch {
    redirect('/account');
  }

  const isAdmin = user.roles.some(
    (r) => r.name === 'admin' || r.name === 'super_admin',
  );

  if (!isAdmin) {
    redirect('/account');
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: Create admin index redirect**

Create `apps/web/src/app/(dashboard)/admin/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

export default function AdminPage() {
  redirect('/admin/users');
}
```

- [ ] **Step 3: Add admin nav items to dashboard nav**

In `apps/web/src/components/account/dashboard-nav.tsx`, add admin nav items after the account items. Conditionally show them based on a prop:

Add to the component props:

```typescript
interface DashboardNavProps {
  displayName: string;
  email: string;
  isAdmin?: boolean;
}
```

Add admin nav items array:

```typescript
const adminNavItems = [
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/roles', label: 'Roles', icon: ShieldCheck },
  { href: '/admin/sessions', label: 'All Sessions', icon: Monitor },
  { href: '/admin/audit-logs', label: 'Audit Logs', icon: FileText },
];
```

Import new icons: `Users, ShieldCheck, FileText` from lucide-react.

Import `Separator` from `@/components/ui/separator` (already installed by shadcn in Plan 7a).

Render admin section with separator:

```tsx
{isAdmin && (
  <>
    <Separator className="my-3" />
    <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      Admin
    </p>
    {adminNavItems.map((item) => (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          pathname.startsWith(item.href)
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
        )}
      >
        <item.icon className="h-4 w-4" />
        {item.label}
      </Link>
    ))}
  </>
)}
```

Update the dashboard layout to pass `isAdmin` — determine from the profile's roles or a separate admin check API call. The simplest approach: try fetching `/api/admin/users?limit=1` — if it succeeds (200), user is admin; if 403, not admin. Cache this in the layout.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): add admin route guard and admin nav items"
```

---

## Task 4: User List Page

**Files:**
- Create: `apps/web/src/components/admin/user-table.tsx`
- Create: `apps/web/src/app/(dashboard)/admin/users/page.tsx`

- [ ] **Step 1: Create user table component**

Create `apps/web/src/components/admin/user-table.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AdminUser } from '@/types/admin';

interface UserTableProps {
  users: AdminUser[];
}

const statusColors: Record<string, string> = {
  active: 'default',
  suspended: 'destructive',
  pending_verification: 'secondary',
};

export function UserTable({ users }: UserTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell>
              <Link href={`/admin/users/${user.id}`} className="font-medium text-primary hover:underline">
                {user.email}
              </Link>
            </TableCell>
            <TableCell>{user.displayName}</TableCell>
            <TableCell>
              <Badge variant={statusColors[user.status] as 'default' | 'destructive' | 'secondary'}>
                {user.status.replace('_', ' ')}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {new Date(user.createdAt).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
        {users.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground">
              No users found.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Create users page with filters**

Create `apps/web/src/app/(dashboard)/admin/users/page.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UserTable } from '@/components/admin/user-table';
import { Pagination } from '@/components/admin/pagination';
import { UserFilters } from '@/components/admin/user-filters';
import { serverFetch } from '@/lib/api-client';
import type { AdminUser, PaginatedResponse } from '@/types/admin';
import { Suspense } from 'react';

interface UsersPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const params = await searchParams;
  const page = Number(params.page ?? '1');
  const limit = Number(params.limit ?? '20');
  const status = params.status ?? '';
  const email = params.email ?? '';

  const query = new URLSearchParams();
  query.set('page', String(page));
  query.set('limit', String(limit));
  if (status) {
    query.set('status', status);
  }
  if (email) {
    query.set('email', email);
  }

  const result = await serverFetch<PaginatedResponse<AdminUser>>(
    `/api/admin/users?${query.toString()}`,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Users</h1>
      <Card>
        <CardHeader>
          <CardTitle>User management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Suspense fallback={null}>
            <UserFilters />
          </Suspense>
          <UserTable users={result.data} />
          <Pagination page={result.page} limit={result.limit} total={result.total} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Create user filters component**

Create `apps/web/src/components/admin/user-filters.tsx`:

```tsx
'use client';

import { useCallback, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X } from 'lucide-react';

export function UserFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  }

  const debouncedUpdate = useCallback(
    (key: string, value: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => updateFilter(key, value), 300);
    },
    [searchParams, pathname],
  );

  function clearFilters() {
    router.push(pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by email..."
          defaultValue={searchParams.get('email') ?? ''}
          className="pl-9"
          onChange={(e) => debouncedUpdate('email', e.target.value)}
        />
      </div>
      <Select
        defaultValue={searchParams.get('status') ?? ''}
        onValueChange={(v) => updateFilter('status', v === 'all' ? '' : v)}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="suspended">Suspended</SelectItem>
          <SelectItem value="pending_verification">Pending</SelectItem>
        </SelectContent>
      </Select>
      {(searchParams.get('email') || searchParams.get('status')) && (
        <Button variant="ghost" size="icon" onClick={clearFilters}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Install select component**

```bash
cd apps/web && pnpm dlx shadcn@latest add select
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): add admin user list page with filters and pagination"
```

---

## Task 5: User Detail Page

**Files:**
- Create: `apps/web/src/components/admin/user-detail.tsx`
- Create: `apps/web/src/app/(dashboard)/admin/users/[id]/page.tsx`

- [ ] **Step 1: Create user detail component**

Create `apps/web/src/components/admin/user-detail.tsx`:

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { clientFetch } from '@/lib/api-client';
import type { AdminUserDetail, Role } from '@/types/admin';
import { Ban, CheckCircle2, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState } from 'react';

interface UserDetailProps {
  user: AdminUserDetail;
  allRoles: Role[];
}

export function UserDetail({ user, allRoles }: UserDetailProps) {
  const router = useRouter();
  const [selectedRoleId, setSelectedRoleId] = useState('');

  const statusMutation = useMutation({
    mutationFn: (status: 'active' | 'suspended') =>
      clientFetch(`/api/admin/users/${user.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      toast.success('User status updated');
      router.refresh();
    },
  });

  const assignRoleMutation = useMutation({
    mutationFn: (roleId: string) =>
      clientFetch(`/api/admin/users/${user.id}/roles`, {
        method: 'POST',
        body: JSON.stringify({ roleId }),
      }),
    onSuccess: () => {
      toast.success('Role assigned');
      setSelectedRoleId('');
      router.refresh();
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: (roleId: string) =>
      clientFetch(`/api/admin/users/${user.id}/roles/${roleId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Role removed');
      router.refresh();
    },
  });

  const bulkRevokeMutation = useMutation({
    mutationFn: () =>
      clientFetch(`/api/admin/users/${user.id}/sessions`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('All sessions revoked');
      router.refresh();
    },
  });

  const assignableRoles = allRoles.filter(
    (r) => !user.roles.some((ur) => ur.id === r.id),
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{user.displayName}</CardTitle>
            <Badge variant={user.status === 'active' ? 'default' : 'destructive'}>
              {user.status.replace('_', ' ')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="text-sm">{user.email}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Created</p>
              <p className="text-sm">{new Date(user.createdAt).toLocaleString()}</p>
            </div>
          </div>
          <Separator />
          <div className="flex gap-2">
            {user.status === 'active' ? (
              <ConfirmDialog
                trigger={
                  <Button variant="destructive" size="sm">
                    <Ban className="mr-2 h-4 w-4" /> Suspend
                  </Button>
                }
                title="Suspend user"
                description="This will suspend the user and revoke all their sessions."
                confirmLabel="Suspend"
                variant="destructive"
                onConfirm={() => statusMutation.mutate('suspended')}
              />
            ) : (
              <Button
                size="sm"
                onClick={() => statusMutation.mutate('active')}
                disabled={statusMutation.isPending}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> Activate
              </Button>
            )}
            <ConfirmDialog
              trigger={
                <Button variant="outline" size="sm">
                  Revoke all sessions
                </Button>
              }
              title="Revoke all sessions"
              description="This will sign the user out of all devices."
              confirmLabel="Revoke all"
              variant="destructive"
              onConfirm={() => bulkRevokeMutation.mutate()}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {user.roles.map((role) => (
              <div key={role.id} className="flex items-center gap-1">
                <Badge variant="outline">{role.name}</Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => removeRoleMutation.mutate(role.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {user.roles.length === 0 && (
              <p className="text-sm text-muted-foreground">No roles assigned.</p>
            )}
          </div>
          {assignableRoles.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select role..." />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!selectedRoleId || assignRoleMutation.isPending}
                onClick={() => assignRoleMutation.mutate(selectedRoleId)}
              >
                <UserPlus className="mr-2 h-4 w-4" /> Assign
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Create user detail page**

Create `apps/web/src/app/(dashboard)/admin/users/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { UserDetail } from '@/components/admin/user-detail';
import { serverFetch } from '@/lib/api-client';
import { ApiRequestError } from '@/lib/api-client';
import type { AdminUserDetail, Role } from '@/types/admin';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface UserDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  const { id } = await params;

  let user: AdminUserDetail;
  let roles: Role[];
  try {
    [user, roles] = await Promise.all([
      serverFetch<AdminUserDetail>(`/api/admin/users/${id}`),
      serverFetch<Role[]>('/api/admin/roles'),
    ]);
  } catch (err) {
    if (err instanceof ApiRequestError && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/users"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="text-2xl font-bold">User detail</h1>
      </div>
      <UserDetail user={user} allRoles={roles} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): add admin user detail page with status/role management"
```

---

## Task 6: Role Management Page

**Files:**
- Create: `apps/web/src/components/admin/role-list.tsx`
- Create: `apps/web/src/components/admin/create-role-dialog.tsx`
- Create: `apps/web/src/app/(dashboard)/admin/roles/page.tsx`

- [ ] **Step 1: Create role list component**

Create `apps/web/src/components/admin/role-list.tsx`:

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { Role } from '@/types/admin';

interface RoleListProps {
  roles: Role[];
}

export function RoleList({ roles }: RoleListProps) {
  return (
    <div className="space-y-3">
      {roles.map((role) => (
        <Card key={role.id}>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{role.name}</p>
                {role.isSystem && <Badge variant="outline">System</Badge>}
              </div>
              {role.description && (
                <p className="text-xs text-muted-foreground">{role.description}</p>
              )}
            </div>
            <Badge variant="secondary">{role.permissionCount} permissions</Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create role dialog**

Create `apps/web/src/components/admin/create-role-dialog.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch } from '@/lib/api-client';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

type CreateRoleValues = z.infer<typeof createRoleSchema>;

export function CreateRoleDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: '', description: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateRoleValues) =>
      clientFetch('/api/admin/roles', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      toast.success('Role created');
      setOpen(false);
      form.reset();
      router.refresh();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" /> Create role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create role</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            {mutation.error && <ApiErrorAlert error={mutation.error} />}

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="moderator" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="What this role can do..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <LoadingButton type="submit" className="w-full" loading={mutation.isPending}>
              Create
            </LoadingButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Install textarea**

```bash
cd apps/web && pnpm dlx shadcn@latest add textarea
```

- [ ] **Step 4: Create roles page**

Create `apps/web/src/app/(dashboard)/admin/roles/page.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RoleList } from '@/components/admin/role-list';
import { CreateRoleDialog } from '@/components/admin/create-role-dialog';
import { serverFetch } from '@/lib/api-client';
import type { Role } from '@/types/admin';

export default async function RolesPage() {
  const roles = await serverFetch<Role[]>('/api/admin/roles');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Roles</h1>
        <CreateRoleDialog />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All roles</CardTitle>
        </CardHeader>
        <CardContent>
          <RoleList roles={roles} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): add admin role management page"
```

---

## Task 7: Session Management Page

**Files:**
- Create: `apps/web/src/components/admin/session-table.tsx`
- Create: `apps/web/src/app/(dashboard)/admin/sessions/page.tsx`

- [ ] **Step 1: Create session table component**

Create `apps/web/src/components/admin/session-table.tsx`:

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { clientFetch } from '@/lib/api-client';
import type { AdminSession } from '@/types/admin';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface SessionTableProps {
  sessions: AdminSession[];
}

export function SessionTable({ sessions }: SessionTableProps) {
  const router = useRouter();

  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      clientFetch(`/api/admin/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Session revoked');
      router.refresh();
    },
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User ID</TableHead>
          <TableHead>IP</TableHead>
          <TableHead>User Agent</TableHead>
          <TableHead>Last Active</TableHead>
          <TableHead className="w-[50px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.id}>
            <TableCell className="font-mono text-xs">{session.userId.slice(0, 8)}...</TableCell>
            <TableCell>{session.ipAddress ?? '—'}</TableCell>
            <TableCell className="max-w-[200px] truncate text-xs">
              {session.userAgent ?? '—'}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {new Date(session.lastActiveAt).toLocaleString()}
            </TableCell>
            <TableCell>
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                }
                title="Revoke session"
                description="This will immediately sign out this session."
                confirmLabel="Revoke"
                variant="destructive"
                onConfirm={() => revokeMutation.mutate(session.id)}
              />
            </TableCell>
          </TableRow>
        ))}
        {sessions.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              No sessions found.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Create sessions page**

Create `apps/web/src/app/(dashboard)/admin/sessions/page.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SessionTable } from '@/components/admin/session-table';
import { Pagination } from '@/components/admin/pagination';
import { serverFetch } from '@/lib/api-client';
import type { AdminSession, PaginatedResponse } from '@/types/admin';

interface SessionsPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AdminSessionsPage({ searchParams }: SessionsPageProps) {
  const params = await searchParams;
  const page = Number(params.page ?? '1');
  const limit = Number(params.limit ?? '20');
  const userId = params.userId ?? '';

  const query = new URLSearchParams();
  query.set('page', String(page));
  query.set('limit', String(limit));
  if (userId) {
    query.set('userId', userId);
  }

  const result = await serverFetch<PaginatedResponse<AdminSession>>(
    `/api/admin/sessions?${query.toString()}`,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Sessions</h1>
      <Card>
        <CardHeader>
          <CardTitle>All active sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SessionTable sessions={result.data} />
          <Pagination page={result.page} limit={result.limit} total={result.total} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): add admin session management page"
```

---

## Task 8: Audit Log Viewer

**Files:**
- Create: `apps/web/src/components/admin/audit-log-table.tsx`
- Create: `apps/web/src/components/admin/audit-filters.tsx`
- Create: `apps/web/src/app/(dashboard)/admin/audit-logs/page.tsx`

- [ ] **Step 1: Create audit log table**

Create `apps/web/src/components/admin/audit-log-table.tsx`:

```tsx
'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { AuditLogEntry } from '@/types/admin';

interface AuditLogTableProps {
  entries: AuditLogEntry[];
}

export function AuditLogTable({ entries }: AuditLogTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Resource</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>IP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
              {new Date(entry.createdAt).toLocaleString()}
            </TableCell>
            <TableCell>
              <Badge variant="outline" className="font-mono text-xs">
                {entry.action}
              </Badge>
            </TableCell>
            <TableCell className="text-xs">
              {entry.resourceType}
              {entry.resourceId && (
                <span className="ml-1 font-mono text-muted-foreground">
                  {entry.resourceId.slice(0, 8)}
                </span>
              )}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {entry.actorId ? entry.actorId.slice(0, 8) : '—'}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {entry.ipAddress ?? '—'}
            </TableCell>
          </TableRow>
        ))}
        {entries.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              No audit logs found.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Create audit filters**

Create `apps/web/src/components/admin/audit-filters.tsx`:

```tsx
'use client';

import { useCallback, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, X } from 'lucide-react';
import { toast } from 'sonner';

const RESOURCE_TYPES = ['user', 'session', 'auth', 'mfa', 'passkey', 'oauth', 'consent', 'client', 'role', 'user_role'];

export function AuditFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  }

  const debouncedUpdate = useCallback(
    (key: string, value: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => updateFilter(key, value), 300);
    },
    [searchParams, pathname],
  );

  function clearFilters() {
    router.push(pathname);
  }

  async function handleExport() {
    const exportParams = new URLSearchParams();
    const action = searchParams.get('action');
    const resourceType = searchParams.get('resourceType');
    if (action) {
      exportParams.set('action', action);
    }
    if (resourceType) {
      exportParams.set('resourceType', resourceType);
    }

    const response = await fetch(`/api/admin/audit-logs/export?${exportParams.toString()}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      toast.error('Export failed');
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.ndjson`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Export downloaded');
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        placeholder="Filter by action..."
        defaultValue={searchParams.get('action') ?? ''}
        className="w-[200px]"
        onChange={(e) => debouncedUpdate('action', e.target.value)}
      />
      <Select
        defaultValue={searchParams.get('resourceType') ?? ''}
        onValueChange={(v) => updateFilter('resourceType', v === 'all' ? '' : v)}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All resources" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All resources</SelectItem>
          {RESOURCE_TYPES.map((type) => (
            <SelectItem key={type} value={type}>{type}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(searchParams.get('action') || searchParams.get('resourceType')) && (
        <Button variant="ghost" size="icon" onClick={clearFilters}>
          <X className="h-4 w-4" />
        </Button>
      )}
      <Button variant="outline" size="sm" className="ml-auto" onClick={handleExport}>
        <Download className="mr-2 h-4 w-4" />
        Export NDJSON
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Create audit logs page**

Create `apps/web/src/app/(dashboard)/admin/audit-logs/page.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AuditLogTable } from '@/components/admin/audit-log-table';
import { AuditFilters } from '@/components/admin/audit-filters';
import { Pagination } from '@/components/admin/pagination';
import { serverFetch } from '@/lib/api-client';
import type { AuditLogEntry, PaginatedResponse } from '@/types/admin';
import { Suspense } from 'react';

interface AuditLogsPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AuditLogsPage({ searchParams }: AuditLogsPageProps) {
  const params = await searchParams;
  const page = Number(params.page ?? '1');
  const limit = Number(params.limit ?? '20');
  const action = params.action ?? '';
  const resourceType = params.resourceType ?? '';
  const actorId = params.actorId ?? '';

  const query = new URLSearchParams();
  query.set('page', String(page));
  query.set('limit', String(limit));
  if (action) {
    query.set('action', action);
  }
  if (resourceType) {
    query.set('resourceType', resourceType);
  }
  if (actorId) {
    query.set('actorId', actorId);
  }

  const result = await serverFetch<PaginatedResponse<AuditLogEntry>>(
    `/api/admin/audit-logs?${query.toString()}`,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Audit Logs</h1>
      <Card>
        <CardHeader>
          <CardTitle>Event history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Suspense fallback={null}>
            <AuditFilters />
          </Suspense>
          <AuditLogTable entries={result.data} />
          <Pagination page={result.page} limit={result.limit} total={result.total} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): add audit log viewer with filters and NDJSON export"
```

---

## Task 9: Playwright E2E Tests

**Files:**
- Create: `apps/web/e2e/admin.spec.ts`

- [ ] **Step 1: Write admin E2E tests**

Create `apps/web/e2e/admin.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';

// Admin E2E tests require:
// 1. A running server with DB
// 2. An admin user seeded (via RBAC seed + role assignment)
// Set ADMIN_EMAIL and ADMIN_PASSWORD env vars for the test admin user.

test.describe('Admin Dashboard', () => {
  test.skip(
    !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD,
    'Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars',
  );

  const adminEmail = process.env.ADMIN_EMAIL ?? '';
  const adminPassword = process.env.ADMIN_PASSWORD ?? '';

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(adminEmail);
    await page.getByLabel(/password/i).fill(adminPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/account/);
  });

  test('admin nav items visible for admin user', async ({ page }) => {
    await expect(page.getByRole('link', { name: /users/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /roles/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /audit/i })).toBeVisible();
  });

  test('user list page loads', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByText(/user management/i)).toBeVisible();
  });

  test('roles page loads', async ({ page }) => {
    await page.goto('/admin/roles');
    await expect(page.getByText(/all roles/i)).toBeVisible();
    await expect(page.getByText(/super_admin/i)).toBeVisible();
  });

  test('sessions page loads', async ({ page }) => {
    await page.goto('/admin/sessions');
    await expect(page.getByText(/all active sessions/i)).toBeVisible();
  });

  test('audit logs page loads', async ({ page }) => {
    await page.goto('/admin/audit-logs');
    await expect(page.getByText(/event history/i)).toBeVisible();
  });

  test('non-admin redirected away from admin pages', async ({ page, browser }) => {
    // Create a new context with a non-admin user
    const context = await browser.newContext();
    const newPage = await context.newPage();

    const email = `e2e-nonadmin-${Date.now()}@test.example`;
    await newPage.goto('/register');
    await newPage.getByLabel(/name/i).fill('Non Admin');
    await newPage.getByLabel(/email/i).fill(email);
    await newPage.getByLabel(/password/i).fill('TestPassword123!');
    await newPage.getByRole('button', { name: /create account/i }).click();
    await newPage.waitForURL(/\/(account|verify-email)/);

    await newPage.goto('/admin/users');
    await expect(newPage).toHaveURL(/\/account/);

    await context.close();
  });
});
```

- [ ] **Step 2: Run all E2E tests**

```bash
cd apps/web && pnpm e2e
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(web): add admin dashboard E2E tests"
```

---

## Task Dependency Graph

```
Task 1 (types + deps) ── Task 2 (pagination)
                              │
                         Task 3 (admin guard + layout)
                              │
               ┌──────────────┼──────────────┬──────────────┐
               │              │              │              │
            Task 4         Task 6         Task 7         Task 8
          (user list)    (roles page)   (sessions)    (audit logs)
               │
            Task 5
          (user detail)
               │
               └──────────────┼──────────────┴──────────────┘
                              │
                         Task 9 (Playwright E2E)
```

Tasks 4, 6, 7, 8 can run **in parallel** after Task 3.
Task 5 depends on Task 4 (user table links to detail).
