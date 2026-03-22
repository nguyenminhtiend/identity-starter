# Phase 7d: Frontend Admin Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin dashboard as a **separate Next.js 15 app** (`apps/admin`) — user management, role management, session management, and audit log viewer, all protected by RBAC.

**Architecture:** Standalone admin app with its own scaffold, middleware, and layout. All routes require authentication + admin role — enforced at the middleware level (no public pages). Server Components load paginated data. TanStack Query mutations for admin actions. Separate from `apps/web` for security isolation, independent deployments, and bundle optimization.

**Tech Stack:** Next.js 15, React 19, TanStack Query, shadcn/ui, Tailwind CSS v4

**Prerequisite:** Phase 7-pre complete (`packages/ui` shared package). Phase 7a Task 4 complete (server cookie auth). Phase 6 Admin API available.
**Phase doc:** `docs/phase-7-frontend.md`
**API spec:** `docs/phase-6-admin-governance.md`
**Related plans:** Phase 7-pre (shared UI package), 7a (Foundation + Auth), 7b (Account), 7c (OAuth Consent)

**Design Direction:** Professional, data-dense, efficient. Think Vercel dashboard meets Linear. Dark-theme-first design with a utilitarian color palette — slate/zinc tones with a sharp accent (e.g., electric blue or amber). Distinctive monospace for data displays (e.g., JetBrains Mono, Fira Code). Dense but readable data tables. Crisp, functional — no unnecessary decoration.

**Vercel Best Practices:**
- `async-parallel`: Parallel fetch of profile + page data in layouts
- `server-serialization`: Minimize data serialized from Server Components to Client Components
- `bundle-dynamic-imports`: Lazy-load audit log export functionality
- `rendering-conditional-render`: Ternary over `&&` for conditional JSX
- `rerender-no-inline-components`: All components defined at module level

**Why a separate app (industry standard):**
- **Security isolation** — admin app can enforce stricter auth (always MFA, IP allowlisting in production)
- **Independent deployments** — ship admin fixes without touching user-facing app
- **Bundle optimization** — admin doesn't ship WebAuthn browser lib; user app doesn't ship data tables
- **Network-level access control** — admin app can be restricted to internal network / VPN

---

## File Map

### New App (`apps/admin/`)

- Create: `apps/admin/package.json` — depends on `@identity-starter/ui`
- Create: `apps/admin/next.config.ts` — API rewrites + `transpilePackages`
- Create: `apps/admin/tsconfig.json` — path aliases pointing shared code to `packages/ui`
- Create: `apps/admin/postcss.config.mjs`
- Create: `apps/admin/src/app/layout.tsx` — root layout with providers from packages/ui
- Create: `apps/admin/src/app/page.tsx` — redirect to /users
- Create: `apps/admin/src/app/globals.css` — Tailwind v4 entry + `@source` for packages/ui
- Create: `apps/admin/src/app/login/page.tsx`
- Create: `apps/admin/src/middleware.ts`
- Create: `apps/admin/src/lib/env.ts` — validated env config (app-specific)
- Create: `apps/admin/src/components/layout/admin-sidebar.tsx`
- Create: `apps/admin/src/app/(dashboard)/layout.tsx`
- Create: `apps/admin/src/app/(dashboard)/users/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/users/[id]/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/roles/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/sessions/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/audit-logs/page.tsx`
- Create: `apps/admin/src/components/users/user-table.tsx`
- Create: `apps/admin/src/components/users/user-filters.tsx`
- Create: `apps/admin/src/components/users/user-detail.tsx`
- Create: `apps/admin/src/components/roles/role-list.tsx`
- Create: `apps/admin/src/components/roles/create-role-dialog.tsx`
- Create: `apps/admin/src/components/sessions/session-table.tsx`
- Create: `apps/admin/src/components/audit/audit-log-table.tsx`
- Create: `apps/admin/src/components/audit/audit-log-filters.tsx`
- Create: `apps/admin/src/types/admin.ts`
- Create: `apps/admin/playwright.config.ts`
- Create: `apps/admin/e2e/admin.spec.ts`

**Shared code from `packages/ui` (via tsconfig path aliases — no local copies):**
- `@/components/ui/*` → `packages/ui/src/components/ui/*` (all shadcn components)
- `@/components/shared/*` → `packages/ui/src/components/shared/*` (LoadingButton, ApiErrorAlert, ConfirmDialog, Pagination)
- `@/components/providers` → `packages/ui/src/components/providers` (TanStack Query Providers)
- `@/lib/utils` → `packages/ui/src/lib/utils.ts` (cn helper)
- `@/lib/api-client` → `packages/ui/src/lib/api-client.ts` (serverFetch, clientFetch, ApiRequestError)

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

## Task 1: Scaffold Admin App

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/next.config.ts`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/postcss.config.mjs`
- Create: `apps/admin/src/app/layout.tsx`
- Create: `apps/admin/src/app/page.tsx`
- Create: `apps/admin/src/app/globals.css`
- Create: `apps/admin/src/lib/env.ts`

- [ ] **Step 1: Create Next.js app**

```bash
cd apps && pnpm create next-app@latest admin \
  --typescript \
  --tailwind \
  --eslint=false \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --turbopack
```

Remove any `.eslintrc*` file (we use Biome).

- [ ] **Step 2: Clean up generated files**

Remove default boilerplate. Delete `public/` SVG files.

Replace `src/app/page.tsx`:

```typescript
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/users');
}
```

- [ ] **Step 3: Update package.json**

```json
{
  "name": "@identity-starter/admin",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3002 --turbopack",
    "build": "next build",
    "start": "next start --port 3002",
    "e2e": "playwright test"
  }
}
```

Note: Port 3002 to avoid conflict with `apps/web` on 3000.

- [ ] **Step 4: Configure next.config.ts with API rewrites**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
    ];
  },
};

export default nextConfig;
```

Admin app only needs `/api/*` rewrites — no `/oauth` or `/.well-known` routes.

- [ ] **Step 5: Create env config**

Create `apps/admin/src/lib/env.ts`:

```typescript
import { z } from 'zod';

const envSchema = z.object({
  API_URL: z.string().default('http://localhost:3001'),
  NEXT_PUBLIC_APP_NAME: z.string().default('Identity Admin'),
});

export const env = envSchema.parse({
  API_URL: process.env.API_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
});
```

- [ ] **Step 6: Install dependencies**

```bash
cd apps/admin && pnpm add zod@^4
```

Note: `clsx`, `tailwind-merge`, `@tanstack/react-query`, and all shadcn component deps come from `@identity-starter/ui` (added in Task 2).

- [ ] **Step 7: Verify build**

```bash
cd apps/admin && pnpm build
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(admin): scaffold Next.js 15 admin app on port 3002"
```

---

## Task 2: Configure Shared Package + Path Aliases

**Files:**
- Modify: `apps/admin/package.json` — add `@identity-starter/ui` dependency
- Modify: `apps/admin/tsconfig.json` — add path aliases for shared code
- Modify: `apps/admin/next.config.ts` — add `transpilePackages`
- Modify: `apps/admin/src/app/globals.css` — add `@source` for shared package

All shadcn components, shared components, API client, and utilities come from `packages/ui` (created in Phase 7-pre). No local copies needed.

- [ ] **Step 1: Add shared package dependency**

```bash
cd apps/admin && pnpm add @identity-starter/ui@workspace:*
```

- [ ] **Step 2: Configure tsconfig path aliases**

Update `apps/admin/tsconfig.json` paths — **specific paths must come before the catch-all `@/*`**:

```json
{
  "compilerOptions": {
    "paths": {
      "@/components/ui/*": ["../../packages/ui/src/components/ui/*"],
      "@/components/shared/*": ["../../packages/ui/src/components/shared/*"],
      "@/components/providers": ["../../packages/ui/src/components/providers"],
      "@/lib/utils": ["../../packages/ui/src/lib/utils"],
      "@/lib/api-client": ["../../packages/ui/src/lib/api-client"],
      "@/*": ["./src/*"]
    }
  }
}
```

This makes `@/components/ui/button` resolve to `packages/ui` while `@/lib/env` and `@/components/layout/*` resolve to local `./src/`.

- [ ] **Step 3: Add transpilePackages to next.config.ts**

Update the existing `next.config.ts` to include:

```typescript
const nextConfig: NextConfig = {
  transpilePackages: ['@identity-starter/ui'],
  async rewrites() {
    // ... existing rewrites
  },
};
```

- [ ] **Step 4: Add @source for Tailwind scanning**

In `apps/admin/src/app/globals.css`, add after the Tailwind import:

```css
@import 'tailwindcss';
@source "../../../../packages/ui/src/**/*.{ts,tsx}";
```

This tells Tailwind v4 to scan the shared package for class names.

- [ ] **Step 5: Verify shared imports work**

```bash
cd apps/admin && pnpm build
```

Expected: Build succeeds with `@/components/ui/*`, `@/lib/utils`, etc. resolving to `packages/ui`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(admin): configure shared UI package with path aliases"
```

---

## Task 3: Admin Types

**Files:**
- Create: `apps/admin/src/types/admin.ts`

- [ ] **Step 1: Define admin types**

Create `apps/admin/src/types/admin.ts`:

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

// Note: PaginatedResponse<T> comes from @/lib/api-client (shared package)

export interface ChainVerification {
  valid: boolean;
  totalEntries: number;
  checkedEntries: number;
  firstInvalidEntryId: string | null;
}

export interface AdminProfile {
  id: string;
  email: string;
  displayName: string;
  roles: Array<{ id: string; name: string }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(admin): add admin dashboard types"
```

---

## Task 4: Middleware + Login Page

**Files:**
- Create: `apps/admin/src/middleware.ts`
- Create: `apps/admin/src/app/login/page.tsx`

- [ ] **Step 1: Create admin middleware**

All routes except `/login` require authentication. The admin role check happens in the dashboard layout (server-side) because middleware can't make async API calls to verify roles.

Create `apps/admin/src/middleware.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get('session');

  // Login page: redirect to dashboard if already logged in
  if (pathname === '/login') {
    if (session) {
      return NextResponse.redirect(new URL('/users', request.url));
    }
    return NextResponse.next();
  }

  // All other pages: require auth
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|api|favicon.ico|.*\\.).*)',],
};
```

- [ ] **Step 2: Create admin login page**

Create `apps/admin/src/app/login/page.tsx`:

The admin login page is intentionally simple — just email + password, no registration, no passkeys.

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch } from '@/lib/api-client';

const loginSchema = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function AdminLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<Error | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginValues) {
    setError(null);
    try {
      await clientFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      router.push('/users');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Login failed'));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Admin Console</CardTitle>
          <CardDescription>Sign in with your admin account</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {error ? <ApiErrorAlert error={error} /> : null}

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="username" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <LoadingButton type="submit" className="w-full" loading={form.formState.isSubmitting}>
                Sign in
              </LoadingButton>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(admin): add middleware and login page"
```

---

## Task 5: Admin Layout + Sidebar

**Files:**
- Create: `apps/admin/src/app/layout.tsx`
- Create: `apps/admin/src/app/(dashboard)/layout.tsx`
- Create: `apps/admin/src/components/layout/admin-sidebar.tsx`

- [ ] **Step 1: Install distinctive fonts + create root layout**

```bash
cd apps/admin && pnpm add @fontsource-variable/outfit @fontsource/jetbrains-mono
```

Create `apps/admin/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';
import { Providers } from '@/components/providers';
import './globals.css';

// Note: Providers comes from packages/ui (via path alias).
// Pass staleTime={30_000} for admin — shorter than the 60s default for user app.

export const metadata: Metadata = {
  title: 'Identity Admin',
  description: 'Admin dashboard for Identity Starter',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers staleTime={30_000}>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
```

Update `apps/admin/src/app/globals.css` — add font imports:

```css
@import '@fontsource-variable/outfit';
@import '@fontsource/jetbrains-mono';
```

Add to theme:

```css
:root {
  --font-sans: 'Outfit Variable', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

Note: Admin app defaults to dark theme (`className="dark"` on html).

- [ ] **Step 2: Create admin sidebar**

Create `apps/admin/src/components/layout/admin-sidebar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { FileText, LogOut, Monitor, ShieldCheck, Users } from 'lucide-react';
import { clientFetch } from '@/lib/api-client';
import { useRouter } from 'next/navigation';

const navItems = [
  { href: '/users', label: 'Users', icon: Users },
  { href: '/roles', label: 'Roles', icon: ShieldCheck },
  { href: '/sessions', label: 'Sessions', icon: Monitor },
  { href: '/audit-logs', label: 'Audit Logs', icon: FileText },
];

interface AdminSidebarProps {
  displayName: string;
  email: string;
}

export function AdminSidebar({ displayName, email }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await clientFetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="hidden w-56 border-r bg-card lg:flex lg:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/users" className="text-sm font-semibold tracking-tight">
          Identity Admin
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {navItems.map((item) => (
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
      </nav>
      <div className="border-t p-3">
        <div className="mb-2 px-3">
          <p className="text-xs font-medium">{displayName}</p>
          <p className="text-xs text-muted-foreground truncate">{email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Create dashboard layout with admin role guard**

Create `apps/admin/src/app/(dashboard)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/api-client';
import { AdminSidebar } from '@/components/layout/admin-sidebar';
import type { AdminProfile } from '@/types/admin';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let profile: AdminProfile;
  try {
    // Fetch profile — if this 401s, cookie is invalid
    const basicProfile = await serverFetch<{ id: string; email: string; displayName: string }>(
      '/api/account/profile',
    );
    // Try admin endpoint — if 403, user is not admin
    const detail = await serverFetch<{ roles: Array<{ id: string; name: string }> }>(
      `/api/admin/users/${basicProfile.id}`,
    );
    profile = { ...basicProfile, roles: detail.roles };
  } catch {
    redirect('/login');
  }

  const isAdmin = profile.roles.some(
    (r) => r.name === 'admin' || r.name === 'super_admin',
  );

  if (!isAdmin) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen">
      <AdminSidebar displayName={profile.displayName} email={profile.email} />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(admin): add root layout, sidebar, and admin role guard"
```

---

## Task 6: User Management Pages

**Files:**
- Create: `apps/admin/src/components/users/user-table.tsx`
- Create: `apps/admin/src/components/users/user-filters.tsx`
- Create: `apps/admin/src/app/(dashboard)/users/page.tsx`
- Create: `apps/admin/src/components/users/user-detail.tsx`
- Create: `apps/admin/src/app/(dashboard)/users/[id]/page.tsx`

- [ ] **Step 1: Create user table component**

Create `apps/admin/src/components/users/user-table.tsx`:

```tsx
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

const statusVariant: Record<string, 'default' | 'destructive' | 'secondary'> = {
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
              <Link href={`/users/${user.id}`} className="font-medium text-primary hover:underline font-mono text-xs">
                {user.email}
              </Link>
            </TableCell>
            <TableCell>{user.displayName}</TableCell>
            <TableCell>
              <Badge variant={statusVariant[user.status] ?? 'default'}>
                {user.status.replace('_', ' ')}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">
              {new Date(user.createdAt).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
        {users.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground">
              No users found.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Create user filters component**

Create `apps/admin/src/components/users/user-filters.tsx`:

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

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  function handleEmailSearch(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParams('email', value), 300);
  }

  function clearFilters() {
    router.push(pathname);
  }

  const hasFilters = searchParams.has('email') || searchParams.has('status');

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by email..."
          defaultValue={searchParams.get('email') ?? ''}
          onChange={(e) => handleEmailSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <Select
        value={searchParams.get('status') ?? ''}
        onValueChange={(v) => updateParams('status', v)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All statuses</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="suspended">Suspended</SelectItem>
          <SelectItem value="pending_verification">Pending</SelectItem>
        </SelectContent>
      </Select>
      {hasFilters ? (
        <Button variant="ghost" size="icon" onClick={clearFilters}>
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Create users list page**

Create `apps/admin/src/app/(dashboard)/users/page.tsx`:

```tsx
import { Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UserTable } from '@/components/users/user-table';
import { UserFilters } from '@/components/users/user-filters';
import { Pagination } from '@/components/shared/pagination';
import { serverFetch } from '@/lib/api-client';
import type { AdminUser } from '@/types/admin';
import type { PaginatedResponse } from '@/lib/api-client';

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
  if (status) query.set('status', status);
  if (email) query.set('email', email);

  const result = await serverFetch<PaginatedResponse<AdminUser>>(
    `/api/admin/users?${query.toString()}`,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <Card>
        <CardHeader>
          <CardTitle>User management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Suspense fallback={null}>
            <UserFilters />
          </Suspense>
          <UserTable users={result.data} />
          <Suspense fallback={null}>
            <Pagination page={result.page} limit={result.limit} total={result.total} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Create user detail component**

Create `apps/admin/src/components/users/user-detail.tsx`:

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { clientFetch } from '@/lib/api-client';
import type { AdminUserDetail, Role } from '@/types/admin';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
    onSuccess: (_, status) => {
      toast.success(`User ${status === 'suspended' ? 'suspended' : 'activated'}`);
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

  const assignableRoles = allRoles.filter(
    (r) => !user.roles.some((ur) => ur.id === r.id),
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>User details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Email</p>
              <p className="font-mono">{user.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Name</p>
              <p>{user.displayName}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <Badge
                variant={user.status === 'active' ? 'default' : 'destructive'}
              >
                {user.status}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground">Email verified</p>
              <p>{user.emailVerified ? 'Yes' : 'No'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Created</p>
              <p className="font-mono text-xs">{new Date(user.createdAt).toLocaleString()}</p>
            </div>
          </div>

          <Separator />

          <div className="flex gap-2">
            {user.status === 'active' ? (
              <Button
                variant="destructive"
                size="sm"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate('suspended')}
              >
                Suspend
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate('active')}
              >
                Activate
              </Button>
            )}
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
              <Badge key={role.id} variant="outline" className="gap-1">
                {role.name}
                <button
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  onClick={() => removeRoleMutation.mutate(role.id)}
                >
                  ×
                </button>
              </Badge>
            ))}
            {user.roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No roles assigned</p>
            ) : null}
          </div>

          {assignableRoles.length > 0 ? (
            <div className="flex items-center gap-2">
              <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                <SelectTrigger className="w-48">
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
                Assign
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Create user detail page**

Create `apps/admin/src/app/(dashboard)/users/[id]/page.tsx`:

Best practice (`async-parallel`): fetch user and roles in parallel.

```tsx
import Link from 'next/link';
import { serverFetch } from '@/lib/api-client';
import { UserDetail } from '@/components/users/user-detail';
import type { AdminUserDetail, Role } from '@/types/admin';
import { ChevronLeft } from 'lucide-react';

interface UserDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  const { id } = await params;

  // Best practice: parallel fetch
  const [user, roles] = await Promise.all([
    serverFetch<AdminUserDetail>(`/api/admin/users/${id}`),
    serverFetch<Role[]>('/api/admin/roles'),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/users" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-semibold">{user.displayName}</h1>
      </div>
      <UserDetail user={user} allRoles={roles} />
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(admin): add user management pages with filters and detail view"
```

---

## Task 7: Role Management Page

**Files:**
- Create: `apps/admin/src/components/roles/role-list.tsx`
- Create: `apps/admin/src/components/roles/create-role-dialog.tsx`
- Create: `apps/admin/src/app/(dashboard)/roles/page.tsx`

- [ ] **Step 1: Create role list component**

Create `apps/admin/src/components/roles/role-list.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Role } from '@/types/admin';

interface RoleListProps {
  roles: Role[];
}

export function RoleList({ roles }: RoleListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Permissions</TableHead>
          <TableHead>Type</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {roles.map((role) => (
          <TableRow key={role.id}>
            <TableCell className="font-medium font-mono text-sm">{role.name}</TableCell>
            <TableCell className="text-muted-foreground">{role.description ?? '—'}</TableCell>
            <TableCell>
              <Badge variant="outline">{role.permissionCount}</Badge>
            </TableCell>
            <TableCell>
              {role.isSystem ? (
                <Badge variant="secondary">System</Badge>
              ) : (
                <Badge variant="outline">Custom</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Create role dialog**

Create `apps/admin/src/components/roles/create-role-dialog.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch } from '@/lib/api-client';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

const createRoleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50),
  description: z.string().max(255).optional(),
});

type CreateRoleValues = z.infer<typeof createRoleSchema>;

export function CreateRoleDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const form = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: '', description: '' },
  });

  async function onSubmit(values: CreateRoleValues) {
    setError(null);
    try {
      await clientFetch('/api/admin/roles', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      toast.success('Role created');
      form.reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to create role'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Create role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create role</DialogTitle>
          <DialogDescription>Add a new role for access control</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {error ? <ApiErrorAlert error={error} /> : null}

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="editor" {...field} />
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
                    <Input placeholder="Can edit content" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <LoadingButton type="submit" loading={form.formState.isSubmitting}>
              Create
            </LoadingButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create roles page**

Create `apps/admin/src/app/(dashboard)/roles/page.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RoleList } from '@/components/roles/role-list';
import { CreateRoleDialog } from '@/components/roles/create-role-dialog';
import { serverFetch } from '@/lib/api-client';
import type { Role } from '@/types/admin';

export default async function RolesPage() {
  const roles = await serverFetch<Role[]>('/api/admin/roles');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Roles</h1>
        <CreateRoleDialog />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Role management</CardTitle>
        </CardHeader>
        <CardContent>
          <RoleList roles={roles} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(admin): add role management page with create dialog"
```

---

## Task 8: Session Management Page

**Files:**
- Create: `apps/admin/src/components/sessions/session-table.tsx`
- Create: `apps/admin/src/app/(dashboard)/sessions/page.tsx`

- [ ] **Step 1: Create session table component**

Create `apps/admin/src/components/sessions/session-table.tsx`:

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
    mutationFn: (sessionId: string) =>
      clientFetch(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' }),
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
          <TableHead>IP Address</TableHead>
          <TableHead>User Agent</TableHead>
          <TableHead>Last Active</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.id}>
            <TableCell className="font-mono text-xs">{session.userId.slice(0, 8)}...</TableCell>
            <TableCell className="font-mono text-xs">{session.ipAddress ?? '—'}</TableCell>
            <TableCell className="max-w-48 truncate text-xs">
              {session.userAgent ?? '—'}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {new Date(session.lastActiveAt).toLocaleString()}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {new Date(session.createdAt).toLocaleString()}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                disabled={revokeMutation.isPending}
                onClick={() => revokeMutation.mutate(session.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
        {sessions.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground">
              No sessions found.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Create sessions page**

Create `apps/admin/src/app/(dashboard)/sessions/page.tsx`:

```tsx
import { Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SessionTable } from '@/components/sessions/session-table';
import { Pagination } from '@/components/shared/pagination';
import { serverFetch } from '@/lib/api-client';
import type { AdminSession } from '@/types/admin';
import type { PaginatedResponse } from '@/lib/api-client';

interface SessionsPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function SessionsPage({ searchParams }: SessionsPageProps) {
  const params = await searchParams;
  const page = Number(params.page ?? '1');
  const limit = Number(params.limit ?? '20');

  const query = new URLSearchParams();
  query.set('page', String(page));
  query.set('limit', String(limit));

  const result = await serverFetch<PaginatedResponse<AdminSession>>(
    `/api/admin/sessions?${query.toString()}`,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Sessions</h1>
      <Card>
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SessionTable sessions={result.data} />
          <Suspense fallback={null}>
            <Pagination page={result.page} limit={result.limit} total={result.total} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(admin): add session management page"
```

---

## Task 9: Audit Log Viewer

**Files:**
- Create: `apps/admin/src/components/audit/audit-log-table.tsx`
- Create: `apps/admin/src/components/audit/audit-log-filters.tsx`
- Create: `apps/admin/src/app/(dashboard)/audit-logs/page.tsx`

- [ ] **Step 1: Create audit log table component**

Create `apps/admin/src/components/audit/audit-log-table.tsx`:

```tsx
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
            <TableCell className="font-mono text-xs whitespace-nowrap">
              {new Date(entry.createdAt).toLocaleString()}
            </TableCell>
            <TableCell>
              <Badge variant="outline" className="font-mono text-xs">
                {entry.action}
              </Badge>
            </TableCell>
            <TableCell className="text-xs">
              <span className="text-muted-foreground">{entry.resourceType}</span>
              {entry.resourceId ? (
                <span className="ml-1 font-mono">{entry.resourceId.slice(0, 8)}...</span>
              ) : null}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {entry.actorId ? `${entry.actorId.slice(0, 8)}...` : 'system'}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {entry.ipAddress ?? '—'}
            </TableCell>
          </TableRow>
        ))}
        {entries.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              No audit log entries found.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Create audit log filters**

Create `apps/admin/src/components/audit/audit-log-filters.tsx`:

```tsx
'use client';

import { useCallback, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X, Download } from 'lucide-react';
import { toast } from 'sonner';

export function AuditLogFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  function handleActionSearch(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParams('action', value), 300);
  }

  function clearFilters() {
    router.push(pathname);
  }

  async function handleExport() {
    try {
      const params = new URLSearchParams(searchParams.toString());
      const response = await fetch(`/api/admin/audit-logs/export?${params.toString()}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.ndjson`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to export audit logs');
    }
  }

  const hasFilters = searchParams.has('action') || searchParams.has('resourceType');

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter by action..."
          defaultValue={searchParams.get('action') ?? ''}
          onChange={(e) => handleActionSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <Select
        value={searchParams.get('resourceType') ?? ''}
        onValueChange={(v) => updateParams('resourceType', v)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="All resources" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All resources</SelectItem>
          <SelectItem value="user">User</SelectItem>
          <SelectItem value="session">Session</SelectItem>
          <SelectItem value="role">Role</SelectItem>
          <SelectItem value="client">OAuth Client</SelectItem>
        </SelectContent>
      </Select>
      {hasFilters ? (
        <Button variant="ghost" size="icon" onClick={clearFilters}>
          <X className="h-4 w-4" />
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={handleExport}>
        <Download className="mr-2 h-4 w-4" />
        Export
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Create audit logs page**

Create `apps/admin/src/app/(dashboard)/audit-logs/page.tsx`:

```tsx
import { Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AuditLogTable } from '@/components/audit/audit-log-table';
import { AuditLogFilters } from '@/components/audit/audit-log-filters';
import { Pagination } from '@/components/shared/pagination';
import { serverFetch } from '@/lib/api-client';
import type { AuditLogEntry, ChainVerification } from '@/types/admin';
import type { PaginatedResponse } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

interface AuditLogsPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AuditLogsPage({ searchParams }: AuditLogsPageProps) {
  const params = await searchParams;
  const page = Number(params.page ?? '1');
  const limit = Number(params.limit ?? '50');
  const action = params.action ?? '';
  const resourceType = params.resourceType ?? '';

  const query = new URLSearchParams();
  query.set('page', String(page));
  query.set('limit', String(limit));
  if (action) query.set('action', action);
  if (resourceType) query.set('resourceType', resourceType);

  // Best practice (async-parallel): fetch logs and chain verification in parallel
  const [result, verification] = await Promise.all([
    serverFetch<PaginatedResponse<AuditLogEntry>>(
      `/api/admin/audit-logs?${query.toString()}`,
    ),
    serverFetch<ChainVerification>('/api/admin/audit-logs/verify'),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Audit Logs</h1>
        <div className="flex items-center gap-2">
          {verification.valid ? (
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              Chain valid ({verification.checkedEntries} entries)
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Chain broken
            </Badge>
          )}
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Activity log</CardTitle>
          <CardDescription>All administrative actions are recorded here</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Suspense fallback={null}>
            <AuditLogFilters />
          </Suspense>
          <AuditLogTable entries={result.data} />
          <Suspense fallback={null}>
            <Pagination page={result.page} limit={result.limit} total={result.total} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(admin): add audit log viewer with filters, export, and chain verification"
```

---

## Task 10: Playwright E2E Tests

**Files:**
- Create: `apps/admin/playwright.config.ts`
- Create: `apps/admin/e2e/admin.spec.ts`

- [ ] **Step 1: Install Playwright**

```bash
cd apps/admin && pnpm add -D @playwright/test
```

- [ ] **Step 2: Create Playwright config**

Create `apps/admin/playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3002',
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 3: Write admin E2E tests**

Create `apps/admin/e2e/admin.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';

test.describe('Admin Dashboard', () => {
  test.skip(
    !process.env.TEST_ADMIN_EMAIL || !process.env.TEST_ADMIN_PASSWORD,
    'Requires TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD env vars',
  );

  const adminEmail = process.env.TEST_ADMIN_EMAIL ?? '';
  const adminPassword = process.env.TEST_ADMIN_PASSWORD ?? '';

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(adminEmail);
    await page.getByLabel(/password/i).fill(adminPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/users');
  });

  test('shows users page', async ({ page }) => {
    await expect(page.getByText(/user management/i)).toBeVisible();
  });

  test('shows roles page', async ({ page }) => {
    await page.goto('/roles');
    await expect(page.getByText(/role management/i)).toBeVisible();
  });

  test('shows sessions page', async ({ page }) => {
    await page.goto('/sessions');
    await expect(page.getByText(/active sessions/i)).toBeVisible();
  });

  test('shows audit logs page', async ({ page }) => {
    await page.goto('/audit-logs');
    await expect(page.getByText(/activity log/i)).toBeVisible();
  });

  test('redirects non-admin to login', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/users');
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(admin): add Playwright E2E setup and admin flow tests"
```

---

## Task 11: Build Verification + Lint

- [ ] **Step 1: Run full build**

```bash
pnpm turbo build
```

- [ ] **Step 2: Run Biome lint**

```bash
pnpm biome check apps/admin/
```

Fix any issues.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "chore(admin): fix lint issues and verify build"
```

---

## Task 12: Update Root Turbo Config

- [ ] **Step 1: Add dev:admin script to root**

In root `package.json`, add convenience scripts:

```json
"dev:web": "pnpm --filter @identity-starter/web dev",
"dev:admin": "pnpm --filter @identity-starter/admin dev",
"dev:all": "turbo run dev"
```

- [ ] **Step 2: Verify all apps start together**

```bash
pnpm dev:all
```

This should start:
- Server on port 3001
- Web app on port 3000
- Admin app on port 3002

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: add convenience dev scripts for all apps"
```

---

## Task Dependency Graph

```
Task 1 (scaffold) ─── Task 2 (shared pkg) ─── Task 3 (types) ─┬─ Task 6 (users)
                                                                 ├─ Task 7 (roles)
Task 4 (middleware + login) ──────────────────────────────────┘  ├─ Task 8 (sessions)
Task 5 (layout + sidebar) ──────────────────────────────────────┘  └─ Task 9 (audit)

Task 10 (E2E) ─── depends on Tasks 6-9
Task 11 (lint) ─── depends on all
Task 12 (root config) ─── independent
```
