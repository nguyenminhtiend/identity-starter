# Phase 7b: Frontend Account Self-Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authenticated account management pages — profile, sessions, passkeys, MFA settings, and password change.

**Architecture:** Dashboard layout with sidebar navigation. Server Components load initial data via `serverFetch`. TanStack Query handles mutations (revoke session, delete passkey, toggle MFA). Passkey registration reuses `@simplewebauthn/browser`. QR code rendering for TOTP enrollment via `qrcode.react`. No admin nav — admin is a separate app (`apps/admin`, see Plan 7d).

**Tech Stack:** Next.js 15, React 19, TanStack Query, React Hook Form + Zod 4, @simplewebauthn/browser, qrcode.react, shadcn/ui

**Prerequisite:** Plan 7a complete (app scaffold, auth middleware, API client, auth pages).
**Phase doc:** `docs/phase-7-frontend.md`

**Vercel Best Practices:**
- `bundle-dynamic-imports`: Lazy-load `qrcode.react` (only needed on MFA settings page)
- `server-serialization`: Only pass needed profile fields to Client Components
- `async-parallel`: Parallel fetch of profile + sessions in dashboard layout
- `rerender-no-inline-components`: All components defined at module level

---

## File Map

- Create: `apps/web/src/app/(dashboard)/layout.tsx` — sidebar + nav
- Create: `apps/web/src/app/(dashboard)/account/page.tsx` — profile
- Create: `apps/web/src/app/(dashboard)/account/sessions/page.tsx`
- Create: `apps/web/src/app/(dashboard)/account/passkeys/page.tsx`
- Create: `apps/web/src/app/(dashboard)/account/security/page.tsx` — MFA + password
- Create: `apps/web/src/components/account/dashboard-nav.tsx`
- Create: `apps/web/src/components/account/profile-form.tsx`
- Create: `apps/web/src/components/account/session-list.tsx`
- Create: `apps/web/src/components/account/passkey-list.tsx`
- Create: `apps/web/src/components/account/passkey-register.tsx`
- Create: `apps/web/src/components/account/totp-enroll.tsx`
- Create: `apps/web/src/components/account/totp-disable.tsx`
- Create: `apps/web/src/components/account/recovery-codes.tsx`
- Create: `apps/web/src/components/account/change-password-form.tsx`
- Create: `apps/web/src/types/account.ts`
- Create: `apps/web/e2e/account.spec.ts`

---

## API Reference (from server)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/account/profile` | Get current user profile |
| PATCH | `/api/account/profile` | Update displayName, metadata |
| GET | `/api/account/sessions` | List sessions (includes `isCurrent`) |
| DELETE | `/api/account/sessions/:id` | Revoke own session |
| GET | `/api/account/passkeys` | List passkeys |
| PATCH | `/api/account/passkeys/:id` | Rename passkey |
| DELETE | `/api/account/passkeys/:id` | Delete passkey |
| POST | `/api/auth/passkeys/register/options` | Get registration options (authed) |
| POST | `/api/auth/passkeys/register/verify` | Verify registration (authed) |
| POST | `/api/account/mfa/totp/enroll` | Start TOTP enrollment |
| POST | `/api/account/mfa/totp/verify` | Confirm enrollment with `{ otp }` |
| DELETE | `/api/account/mfa/totp` | Disable TOTP with `{ password }` |
| POST | `/api/account/mfa/recovery-codes/regenerate` | Regenerate codes with `{ password }` |
| POST | `/api/auth/change-password` | Change password |

---

## Task 1: Account Types + Dashboard Layout

**Files:**
- Create: `apps/web/src/types/account.ts`
- Create: `apps/web/src/app/(dashboard)/layout.tsx`
- Create: `apps/web/src/components/account/dashboard-nav.tsx`

- [ ] **Step 1: Define account types**

Create `apps/web/src/types/account.ts`:

```typescript
export interface Profile {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  status: 'active' | 'suspended' | 'pending_verification';
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SessionItem {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface PasskeyItem {
  id: string;
  credentialId: string;
  deviceType: string;
  backedUp: boolean;
  name: string | null;
  aaguid: string | null;
  createdAt: string;
}

export interface TotpEnrollResponse {
  otpauthUri: string;
  recoveryCodes: string[];
}

export interface RecoveryCodesResponse {
  recoveryCodes: string[];
}
```

Note: All shadcn components (dialog, table, badge, dropdown-menu, avatar, tooltip, tabs) come from `packages/ui` via path aliases — no local install needed.

- [ ] **Step 2: Create dashboard layout**

Create `apps/web/src/app/(dashboard)/layout.tsx`:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/api-client';
import type { Profile } from '@/types/account';
import { DashboardNav } from '@/components/account/dashboard-nav';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let profile: Profile;
  try {
    profile = await serverFetch<Profile>('/api/account/profile');
  } catch {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 border-r bg-muted/30 lg:block">
        <div className="flex h-14 items-center border-b px-6">
          <Link href="/account" className="font-display text-lg font-semibold">
            Identity
          </Link>
        </div>
        <DashboardNav displayName={profile.displayName} email={profile.email} />
      </aside>
      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Create nav component**

Create `apps/web/src/components/account/dashboard-nav.tsx`:

No admin nav items — admin dashboard is a separate app (`apps/admin`).

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { KeyRound, LogOut, Monitor, Shield, User } from 'lucide-react';
import { clientFetch } from '@/lib/api-client';
import { useRouter } from 'next/navigation';

const navItems = [
  { href: '/account', label: 'Profile', icon: User },
  { href: '/account/sessions', label: 'Sessions', icon: Monitor },
  { href: '/account/passkeys', label: 'Passkeys', icon: KeyRound },
  { href: '/account/security', label: 'Security', icon: Shield },
];

interface DashboardNavProps {
  displayName: string;
  email: string;
}

export function DashboardNav({ displayName, email }: DashboardNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await clientFetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <nav className="flex flex-col gap-1 p-4">
      <div className="mb-4 px-2">
        <p className="text-sm font-medium">{displayName}</p>
        <p className="text-xs text-muted-foreground">{email}</p>
      </div>
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
            pathname === item.href
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
          )}
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </Link>
      ))}
      <button
        onClick={handleLogout}
        className="mt-auto flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </nav>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): add dashboard layout with sidebar navigation"
```

---

## ~~Task 2: Confirm Dialog Component~~ — REMOVED

ConfirmDialog is in `packages/ui` (Phase 7-pre). Available via path alias `@/components/shared/confirm-dialog` — no local copy needed.

---

## Task 3: Profile Page

**Files:**
- Create: `apps/web/src/components/account/profile-form.tsx`
- Create: `apps/web/src/app/(dashboard)/account/page.tsx`

- [ ] **Step 1: Create profile form**

Create `apps/web/src/components/account/profile-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { LoadingButton } from '@/components/shared/loading-button';
import { clientFetch } from '@/lib/api-client';
import type { Profile } from '@/types/account';
import { toast } from 'sonner';

const updateProfileSchema = z.object({
  displayName: z.string().min(1, 'Name is required').max(255),
});

type UpdateProfileValues = z.infer<typeof updateProfileSchema>;

interface ProfileFormProps {
  profile: Profile;
}

export function ProfileForm({ profile }: ProfileFormProps) {
  const router = useRouter();

  const form = useForm<UpdateProfileValues>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { displayName: profile.displayName },
  });

  const mutation = useMutation({
    mutationFn: (values: UpdateProfileValues) =>
      clientFetch<Profile>('/api/account/profile', {
        method: 'PATCH',
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      toast.success('Profile updated');
      router.refresh();
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        {mutation.error ? <ApiErrorAlert error={mutation.error} /> : null}

        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">Email</label>
          <p className="text-sm">{profile.email}</p>
        </div>

        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" loading={mutation.isPending}>
          Save changes
        </LoadingButton>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Create profile page**

Create `apps/web/src/app/(dashboard)/account/page.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ProfileForm } from '@/components/account/profile-form';
import { serverFetch } from '@/lib/api-client';
import type { Profile } from '@/types/account';

export default async function ProfilePage() {
  const profile = await serverFetch<Profile>('/api/account/profile');

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Profile</h1>
      <Card>
        <CardHeader>
          <CardTitle>Personal information</CardTitle>
          <CardDescription>Manage your account details</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm profile={profile} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): add profile page with edit form"
```

---

## Task 4: Sessions Page

**Files:**
- Create: `apps/web/src/components/account/session-list.tsx`
- Create: `apps/web/src/app/(dashboard)/account/sessions/page.tsx`

- [ ] **Step 1: Create session list component**

Create `apps/web/src/components/account/session-list.tsx`:

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { clientFetch } from '@/lib/api-client';
import type { SessionItem } from '@/types/account';
import { Monitor, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface SessionListProps {
  sessions: SessionItem[];
}

export function SessionList({ sessions }: SessionListProps) {
  const router = useRouter();

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) =>
      clientFetch(`/api/account/sessions/${sessionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Session revoked');
      router.refresh();
    },
  });

  return (
    <div className="space-y-3">
      {sessions.map((session) => (
        <Card key={session.id}>
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Monitor className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">
                    {session.userAgent ?? 'Unknown device'}
                  </p>
                  {session.isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {session.ipAddress ?? 'Unknown IP'} · Last active{' '}
                  {new Date(session.lastActiveAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            {!session.isCurrent ? (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon" disabled={revokeMutation.isPending}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                }
                title="Revoke session"
                description="This will sign out the device. You cannot undo this."
                confirmLabel="Revoke"
                variant="destructive"
                onConfirm={() => revokeMutation.mutate(session.id)}
              />
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create sessions page**

Create `apps/web/src/app/(dashboard)/account/sessions/page.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SessionList } from '@/components/account/session-list';
import { serverFetch } from '@/lib/api-client';
import type { SessionItem } from '@/types/account';

export default async function SessionsPage() {
  const sessions = await serverFetch<SessionItem[]>('/api/account/sessions');

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Sessions</h1>
      <Card>
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>Manage your signed-in devices</CardDescription>
        </CardHeader>
        <CardContent>
          <SessionList sessions={sessions} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): add sessions page with revoke support"
```

---

## Task 5: Passkeys Page

**Files:**
- Create: `apps/web/src/components/account/passkey-list.tsx`
- Create: `apps/web/src/components/account/passkey-register.tsx`
- Create: `apps/web/src/app/(dashboard)/account/passkeys/page.tsx`

- [ ] **Step 1: Create passkey list component**

Create `apps/web/src/components/account/passkey-list.tsx`:

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { clientFetch } from '@/lib/api-client';
import type { PasskeyItem } from '@/types/account';
import { KeyRound, Pencil, Trash2, X, Check } from 'lucide-react';
import { toast } from 'sonner';

interface PasskeyListProps {
  passkeys: PasskeyItem[];
}

export function PasskeyList({ passkeys }: PasskeyListProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      clientFetch(`/api/account/passkeys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Passkey deleted');
      router.refresh();
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      clientFetch(`/api/account/passkeys/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      toast.success('Passkey renamed');
      setEditingId(null);
      router.refresh();
    },
  });

  function startEdit(passkey: PasskeyItem) {
    setEditingId(passkey.id);
    setEditName(passkey.name ?? '');
  }

  return (
    <div className="space-y-3">
      {passkeys.map((passkey) => (
        <Card key={passkey.id}>
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <KeyRound className="h-5 w-5 text-muted-foreground" />
              <div>
                {editingId === passkey.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-7 w-48"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => renameMutation.mutate({ id: passkey.id, name: editName })}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm font-medium">
                    {passkey.name ?? 'Unnamed passkey'}
                  </p>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{passkey.deviceType}</span>
                  {passkey.backedUp ? <Badge variant="outline">Backed up</Badge> : null}
                  <span>Added {new Date(passkey.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => startEdit(passkey)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                }
                title="Delete passkey"
                description="You will no longer be able to sign in with this passkey."
                confirmLabel="Delete"
                variant="destructive"
                onConfirm={() => deleteMutation.mutate(passkey.id)}
              />
            </div>
          </CardContent>
        </Card>
      ))}
      {passkeys.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">
          No passkeys registered. Add one below.
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create passkey register component**

Create `apps/web/src/components/account/passkey-register.tsx`:

Best practice (`bundle-dynamic-imports`): `@simplewebauthn/browser` is dynamically imported.

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { clientFetch } from '@/lib/api-client';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function PasskeyRegister() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    setLoading(true);
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');

      const options = await clientFetch<{ publicKey: unknown }>(
        '/api/auth/passkeys/register/options',
        { method: 'POST' },
      );

      const credential = await startRegistration({
        optionsJSON: options.publicKey as Parameters<typeof startRegistration>[0]['optionsJSON'],
      });

      await clientFetch('/api/auth/passkeys/register/verify', {
        method: 'POST',
        body: JSON.stringify(credential),
      });

      toast.success('Passkey registered');
      router.refresh();
    } catch (err) {
      if (err instanceof Error && err.name !== 'NotAllowedError') {
        toast.error(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleRegister} disabled={loading}>
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
      Add passkey
    </Button>
  );
}
```

- [ ] **Step 3: Create passkeys page**

Create `apps/web/src/app/(dashboard)/account/passkeys/page.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PasskeyList } from '@/components/account/passkey-list';
import { PasskeyRegister } from '@/components/account/passkey-register';
import { serverFetch } from '@/lib/api-client';
import type { PasskeyItem } from '@/types/account';

export default async function PasskeysPage() {
  const passkeys = await serverFetch<PasskeyItem[]>('/api/account/passkeys');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Passkeys</h1>
        <PasskeyRegister />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Your passkeys</CardTitle>
          <CardDescription>
            Passkeys let you sign in without a password using biometrics or a security key
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasskeyList passkeys={passkeys} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): add passkeys page with register, rename, and delete"
```

---

## Task 6: Security Page (MFA + Password Change)

**Files:**
- Create: `apps/web/src/components/account/totp-enroll.tsx`
- Create: `apps/web/src/components/account/totp-disable.tsx`
- Create: `apps/web/src/components/account/recovery-codes.tsx`
- Create: `apps/web/src/components/account/change-password-form.tsx`
- Create: `apps/web/src/app/(dashboard)/account/security/page.tsx`

- [ ] **Step 1: Install qrcode.react**

```bash
cd apps/web && pnpm add qrcode.react
```

- [ ] **Step 2: Create TOTP enroll component**

Best practice (`bundle-dynamic-imports`): QR code component is dynamically imported since it's only needed during TOTP enrollment.

Create `apps/web/src/components/account/totp-enroll.tsx`:

```tsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
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
import { clientFetch, ApiRequestError } from '@/lib/api-client';
import type { TotpEnrollResponse } from '@/types/account';
import { toast } from 'sonner';

const QRCodeSVG = dynamic(
  () => import('qrcode.react').then((m) => ({ default: m.QRCodeSVG })),
  { ssr: false, loading: () => <div className="h-48 w-48 animate-pulse bg-muted rounded" /> },
);

const verifySchema = z.object({
  otp: z.string().length(6, 'Enter the 6-digit code'),
});

type VerifyValues = z.infer<typeof verifySchema>;

export function TotpEnroll() {
  const router = useRouter();
  const [enrollData, setEnrollData] = useState<TotpEnrollResponse | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const form = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    defaultValues: { otp: '' },
  });

  async function startEnroll() {
    setEnrolling(true);
    setError(null);
    try {
      const data = await clientFetch<TotpEnrollResponse>('/api/account/mfa/totp/enroll', {
        method: 'POST',
      });
      setEnrollData(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to start enrollment'));
    } finally {
      setEnrolling(false);
    }
  }

  async function handleVerify(values: VerifyValues) {
    try {
      await clientFetch('/api/account/mfa/totp/verify', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      toast.success('Two-factor authentication enabled');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err);
      }
    }
  }

  if (!enrollData) {
    return (
      <div className="space-y-4">
        {error ? <ApiErrorAlert error={error} /> : null}
        <LoadingButton onClick={startEnroll} loading={enrolling}>
          Enable two-factor authentication
        </LoadingButton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4">
        <QRCodeSVG value={enrollData.otpauthUri} size={192} />
        <p className="text-sm text-muted-foreground text-center">
          Scan with your authenticator app, then enter the code below
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleVerify)} className="space-y-4">
          {error ? <ApiErrorAlert error={error} /> : null}

          <FormField
            control={form.control}
            name="otp"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Verification code</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" maxLength={6} placeholder="000000" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <LoadingButton type="submit" loading={form.formState.isSubmitting}>
            Verify and enable
          </LoadingButton>
        </form>
      </Form>

      <div className="rounded-md border p-4">
        <p className="text-sm font-medium mb-2">Recovery codes</p>
        <p className="text-xs text-muted-foreground mb-3">
          Save these codes in a safe place. Each can be used once if you lose your authenticator.
        </p>
        <div className="grid grid-cols-2 gap-1 font-mono text-sm">
          {enrollData.recoveryCodes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create TOTP disable component**

Create `apps/web/src/components/account/totp-disable.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { PasswordInput } from '@/components/shared/password-input';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch, ApiRequestError } from '@/lib/api-client';
import { toast } from 'sonner';
import { useState } from 'react';

const disableSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

type DisableValues = z.infer<typeof disableSchema>;

export function TotpDisable() {
  const router = useRouter();
  const [error, setError] = useState<Error | null>(null);

  const form = useForm<DisableValues>({
    resolver: zodResolver(disableSchema),
    defaultValues: { password: '' },
  });

  async function handleDisable(values: DisableValues) {
    setError(null);
    try {
      await clientFetch('/api/account/mfa/totp', {
        method: 'DELETE',
        body: JSON.stringify(values),
      });
      toast.success('Two-factor authentication disabled');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err);
      }
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleDisable)} className="space-y-4">
        {error ? <ApiErrorAlert error={error} /> : null}
        <p className="text-sm text-muted-foreground">
          Enter your password to disable two-factor authentication.
        </p>
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <PasswordInput {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <LoadingButton type="submit" variant="destructive" loading={form.formState.isSubmitting}>
          Disable 2FA
        </LoadingButton>
      </form>
    </Form>
  );
}
```

- [ ] **Step 4: Create recovery codes component**

Create `apps/web/src/components/account/recovery-codes.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { PasswordInput } from '@/components/shared/password-input';
import { LoadingButton } from '@/components/shared/loading-button';
import { clientFetch } from '@/lib/api-client';
import type { RecoveryCodesResponse } from '@/types/account';
import { toast } from 'sonner';

const regenerateSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

type RegenerateValues = z.infer<typeof regenerateSchema>;

export function RecoveryCodes() {
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [showForm, setShowForm] = useState(false);

  const form = useForm<RegenerateValues>({
    resolver: zodResolver(regenerateSchema),
    defaultValues: { password: '' },
  });

  async function handleRegenerate(values: RegenerateValues) {
    const result = await clientFetch<RecoveryCodesResponse>(
      '/api/account/mfa/recovery-codes/regenerate',
      {
        method: 'POST',
        body: JSON.stringify(values),
      },
    );
    setCodes(result.recoveryCodes);
    setShowForm(false);
    toast.success('Recovery codes regenerated');
    router.refresh();
  }

  if (codes) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Save these codes. Your previous codes are no longer valid.
        </p>
        <div className="grid grid-cols-2 gap-1 rounded-md border p-4 font-mono text-sm">
          {codes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>
        <Button variant="outline" onClick={() => setCodes(null)}>
          Done
        </Button>
      </div>
    );
  }

  if (showForm) {
    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleRegenerate)} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This will invalidate your existing recovery codes.
          </p>
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex gap-2">
            <LoadingButton type="submit" variant="destructive" loading={form.formState.isSubmitting}>
              Regenerate
            </LoadingButton>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Form>
    );
  }

  return (
    <Button variant="outline" onClick={() => setShowForm(true)}>
      Regenerate recovery codes
    </Button>
  );
}
```

- [ ] **Step 5: Create change password form**

Create `apps/web/src/components/account/change-password-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { PasswordInput } from '@/components/shared/password-input';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch } from '@/lib/api-client';
import { toast } from 'sonner';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export function ChangePasswordForm() {
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: ChangePasswordValues) =>
      clientFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      }),
    onSuccess: () => {
      toast.success('Password changed');
      form.reset();
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        {mutation.error ? <ApiErrorAlert error={mutation.error} /> : null}

        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Current password</FormLabel>
              <FormControl>
                <PasswordInput {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <PasswordInput {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <FormControl>
                <PasswordInput {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" loading={mutation.isPending}>
          Change password
        </LoadingButton>
      </form>
    </Form>
  );
}
```

- [ ] **Step 6: Create security page**

Create `apps/web/src/app/(dashboard)/account/security/page.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { serverFetch } from '@/lib/api-client';
import type { Profile } from '@/types/account';
import { TotpEnroll } from '@/components/account/totp-enroll';
import { TotpDisable } from '@/components/account/totp-disable';
import { RecoveryCodes } from '@/components/account/recovery-codes';
import { ChangePasswordForm } from '@/components/account/change-password-form';

export default async function SecurityPage() {
  const profile = await serverFetch<Profile>('/api/account/profile');
  const hasMfa = profile.metadata?.mfaEnabled === true;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Security</h1>

      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Add an extra layer of security with a TOTP authenticator app
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasMfa ? (
            <>
              <p className="text-sm text-green-600 font-medium">2FA is enabled</p>
              <Separator />
              <TotpDisable />
              <Separator />
              <RecoveryCodes />
            </>
          ) : (
            <TotpEnroll />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Update your password</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(web): add security page with MFA enrollment and password change"
```

---

## Task 7: Account E2E Tests

**Files:**
- Create: `apps/web/e2e/account.spec.ts`

- [ ] **Step 1: Write account E2E tests**

Create `apps/web/e2e/account.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';

test.describe('Account Management', () => {
  const email = `e2e-account-${Date.now()}@test.example`;

  test.beforeEach(async ({ page }) => {
    // Register + login
    await page.goto('/register');
    await page.getByLabel(/name/i).fill('Account User');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill('TestPassword123!');
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/(account|verify-email)/);
  });

  test('shows profile page', async ({ page }) => {
    await page.goto('/account');
    await expect(page.getByText(/profile/i)).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  test('shows sessions page', async ({ page }) => {
    await page.goto('/account/sessions');
    await expect(page.getByText(/current/i)).toBeVisible();
  });

  test('shows passkeys page', async ({ page }) => {
    await page.goto('/account/passkeys');
    await expect(page.getByText(/passkeys/i)).toBeVisible();
  });

  test('shows security page', async ({ page }) => {
    await page.goto('/account/security');
    await expect(page.getByText(/two-factor/i)).toBeVisible();
    await expect(page.getByText(/change password/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run E2E tests**

```bash
cd apps/web && pnpm e2e
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(web): add account management E2E tests"
```

---

## Task Dependency Graph

```
Task 1 (types + layout + nav) ─┬─ Task 3 (profile) ─── can run after Task 1
                                ├─ Task 4 (sessions) ─── can run after Task 2
                                ├─ Task 5 (passkeys) ─── can run after Task 2
                                └─ Task 6 (security) ─── can run after Task 2
Task 2 (confirm dialog) ────────┘
Task 7 (E2E tests) ──── depends on all above
```
