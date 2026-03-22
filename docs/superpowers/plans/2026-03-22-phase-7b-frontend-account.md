# Phase 7b: Frontend Account Self-Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authenticated account management pages — profile, sessions, passkeys, MFA settings, and password change.

**Architecture:** Dashboard layout with sidebar navigation. Server Components load initial data via `serverFetch`. TanStack Query handles mutations (revoke session, delete passkey, toggle MFA). Passkey registration reuses `@simplewebauthn/browser`. QR code rendering for TOTP enrollment via `qrcode.react`.

**Tech Stack:** Next.js 15, React 19, TanStack Query, React Hook Form + Zod 4, @simplewebauthn/browser, qrcode.react, shadcn/ui

**Prerequisite:** Plan 7a complete (app scaffold, auth middleware, API client, auth pages).
**Phase doc:** `docs/phase-7-frontend.md`

---

## File Map

- Create: `apps/web/src/app/(dashboard)/layout.tsx` — sidebar + nav
- Create: `apps/web/src/app/(dashboard)/account/page.tsx` — profile
- Create: `apps/web/src/app/(dashboard)/account/sessions/page.tsx`
- Create: `apps/web/src/app/(dashboard)/account/passkeys/page.tsx`
- Create: `apps/web/src/app/(dashboard)/account/security/page.tsx` — MFA + password
- Create: `apps/web/src/components/account/profile-form.tsx`
- Create: `apps/web/src/components/account/session-list.tsx`
- Create: `apps/web/src/components/account/passkey-list.tsx`
- Create: `apps/web/src/components/account/passkey-register.tsx`
- Create: `apps/web/src/components/account/totp-enroll.tsx`
- Create: `apps/web/src/components/account/totp-disable.tsx`
- Create: `apps/web/src/components/account/recovery-codes.tsx`
- Create: `apps/web/src/components/account/change-password-form.tsx`
- Create: `apps/web/src/components/shared/confirm-dialog.tsx`
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
| POST | `/api/account/mfa/totp/enroll` | Start TOTP enrollment → `{ otpauthUri, recoveryCodes }` |
| POST | `/api/account/mfa/totp/verify` | Confirm enrollment with `{ otp }` |
| DELETE | `/api/account/mfa/totp` | Disable TOTP with `{ password }` |
| POST | `/api/account/mfa/recovery-codes/regenerate` | Regenerate codes with `{ password }` |
| POST | `/api/auth/change-password` | Change password with `{ currentPassword, newPassword }` |

---

## Task 1: Account Types + Dashboard Layout

**Files:**
- Create: `apps/web/src/types/account.ts`
- Create: `apps/web/src/app/(dashboard)/layout.tsx`

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

- [ ] **Step 2: Install additional shadcn components**

```bash
cd apps/web && pnpm dlx shadcn@latest add dialog table badge dropdown-menu avatar tooltip tabs
```

- [ ] **Step 3: Create dashboard layout**

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
          <Link href="/account" className="text-lg font-semibold">
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

- [ ] **Step 4: Create nav component**

Create `apps/web/src/components/account/dashboard-nav.tsx`:

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

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): add dashboard layout with sidebar navigation"
```

---

## Task 2: Confirm Dialog Component

**Files:**
- Create: `apps/web/src/components/shared/confirm-dialog.tsx`

- [ ] **Step 1: Install alert-dialog**

```bash
cd apps/web && pnpm dlx shadcn@latest add alert-dialog
```

- [ ] **Step 2: Create confirm dialog**

Create `apps/web/src/components/shared/confirm-dialog.tsx`:

```tsx
'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: 'destructive' | 'default';
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'Confirm',
  variant = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={variant === 'destructive' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): add confirm dialog and shared components"
```

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
        {mutation.error && <ApiErrorAlert error={mutation.error} />}

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
      <h1 className="text-2xl font-bold">Profile</h1>
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
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
                  {session.isCurrent && <Badge variant="secondary">Current</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {session.ipAddress ?? 'Unknown IP'} · Last active{' '}
                  {new Date(session.lastActiveAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            {!session.isCurrent && (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon" disabled={revokeMutation.isPending}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                }
                title="Revoke session"
                description="This will sign out the device. The user will need to sign in again."
                confirmLabel="Revoke"
                variant="destructive"
                onConfirm={() => revokeMutation.mutate(session.id)}
              />
            )}
          </CardContent>
        </Card>
      ))}
      {sessions.length === 0 && (
        <p className="text-sm text-muted-foreground">No active sessions.</p>
      )}
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
      <h1 className="text-2xl font-bold">Sessions</h1>
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
git add -A && git commit -m "feat(web): add sessions page with revoke"
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
                      autoFocus
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={editName.trim().length === 0}
                      onClick={() => renameMutation.mutate({ id: passkey.id, name: editName.trim() })}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm font-medium">{passkey.name ?? 'Unnamed passkey'}</p>
                )}
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    {passkey.deviceType} · Added {new Date(passkey.createdAt).toLocaleDateString()}
                  </p>
                  {passkey.backedUp && <Badge variant="outline" className="text-xs">Synced</Badge>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setEditingId(passkey.id);
                  setEditName(passkey.name ?? '');
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                }
                title="Delete passkey"
                description="You won't be able to sign in with this passkey anymore."
                confirmLabel="Delete"
                variant="destructive"
                onConfirm={() => deleteMutation.mutate(passkey.id)}
              />
            </div>
          </CardContent>
        </Card>
      ))}
      {passkeys.length === 0 && (
        <p className="text-sm text-muted-foreground">No passkeys registered yet.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create passkey registration component**

Create `apps/web/src/components/account/passkey-register.tsx`:

```tsx
'use client';

import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch, type ApiRequestError } from '@/lib/api-client';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

export function PasskeyRegister() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  async function handleRegister() {
    setLoading(true);
    setError(null);
    try {
      const options = await clientFetch<PublicKeyCredentialCreationOptionsJSON>(
        '/api/auth/passkeys/register/options',
        { method: 'POST' },
      );

      const credential = await startRegistration({ optionsJSON: options });

      await clientFetch('/api/auth/passkeys/register/verify', {
        method: 'POST',
        body: JSON.stringify(credential),
      });

      toast.success('Passkey registered');
      router.refresh();
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        return;
      }
      setError(err as ApiRequestError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <ApiErrorAlert error={error} />
      <LoadingButton onClick={handleRegister} loading={loading} variant="outline">
        <Plus className="mr-2 h-4 w-4" />
        Register new passkey
      </LoadingButton>
    </div>
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
        <h1 className="text-2xl font-bold">Passkeys</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Your passkeys</CardTitle>
          <CardDescription>Use passkeys to sign in without a password</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <PasskeyList passkeys={passkeys} />
          <PasskeyRegister />
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

## Task 6: Security Page — TOTP Enrollment

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

- [ ] **Step 2: Create TOTP enrollment component**

Create `apps/web/src/components/account/totp-enroll.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { QRCodeSVG } from 'qrcode.react';
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
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch, type ApiRequestError } from '@/lib/api-client';
import type { TotpEnrollResponse } from '@/types/account';
import { toast } from 'sonner';
import { Copy, ShieldCheck } from 'lucide-react';

const otpSchema = z.object({
  otp: z.string().length(6, 'Enter a 6-digit code'),
});

type OtpValues = z.infer<typeof otpSchema>;

export function TotpEnroll() {
  const router = useRouter();
  const [enrollData, setEnrollData] = useState<TotpEnrollResponse | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const enrollMutation = useMutation({
    mutationFn: () =>
      clientFetch<TotpEnrollResponse>('/api/account/mfa/totp/enroll', { method: 'POST' }),
    onSuccess: (data) => setEnrollData(data),
    onError: (err) => setError(err as ApiRequestError),
  });

  const form = useForm<OtpValues>({
    resolver: zodResolver(otpSchema),
    defaultValues: { otp: '' },
  });

  const verifyMutation = useMutation({
    mutationFn: (values: OtpValues) =>
      clientFetch('/api/account/mfa/totp/verify', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      toast.success('TOTP enabled');
      router.refresh();
    },
  });

  if (!enrollData) {
    return (
      <div className="space-y-2">
        <ApiErrorAlert error={error} />
        <LoadingButton onClick={() => enrollMutation.mutate()} loading={enrollMutation.isPending}>
          <ShieldCheck className="mr-2 h-4 w-4" />
          Enable two-factor authentication
        </LoadingButton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4">
        <p className="text-sm text-muted-foreground">
          Scan this QR code with your authenticator app
        </p>
        <div className="rounded-lg border bg-white p-4">
          <QRCodeSVG value={enrollData.otpauthUri} size={200} />
        </div>
      </div>

      <Alert>
        <AlertTitle>Recovery codes</AlertTitle>
        <AlertDescription>
          <p className="mb-2">Save these codes somewhere safe. You can use them if you lose access to your authenticator app.</p>
          <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-3 font-mono text-sm">
            {enrollData.recoveryCodes.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              navigator.clipboard.writeText(enrollData.recoveryCodes.join('\n'));
              toast.success('Copied to clipboard');
            }}
          >
            <Copy className="mr-2 h-3 w-3" />
            Copy codes
          </Button>
        </AlertDescription>
      </Alert>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => verifyMutation.mutate(v))} className="space-y-4">
          {verifyMutation.error && <ApiErrorAlert error={verifyMutation.error} />}

          <FormField
            control={form.control}
            name="otp"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Verification code</FormLabel>
                <FormControl>
                  <Input
                    placeholder="000000"
                    maxLength={6}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <LoadingButton type="submit" loading={verifyMutation.isPending}>
            Verify and enable
          </LoadingButton>
        </form>
      </Form>
    </div>
  );
}
```

- [ ] **Step 3: Create TOTP disable component**

Create `apps/web/src/components/account/totp-disable.tsx`:

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
import { PasswordInput } from '@/components/shared/password-input';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch } from '@/lib/api-client';
import { toast } from 'sonner';

const disableSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

type DisableValues = z.infer<typeof disableSchema>;

export function TotpDisable() {
  const router = useRouter();

  const form = useForm<DisableValues>({
    resolver: zodResolver(disableSchema),
    defaultValues: { password: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: DisableValues) =>
      clientFetch('/api/account/mfa/totp', {
        method: 'DELETE',
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      toast.success('Two-factor authentication disabled');
      router.refresh();
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        {mutation.error && <ApiErrorAlert error={mutation.error} />}

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm password to disable</FormLabel>
              <FormControl>
                <PasswordInput placeholder="Enter your password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" variant="destructive" loading={mutation.isPending}>
          Disable two-factor authentication
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

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
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
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/shared/password-input';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch } from '@/lib/api-client';
import type { RecoveryCodesResponse } from '@/types/account';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';

const regenSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

type RegenValues = z.infer<typeof regenSchema>;

export function RecoveryCodes() {
  const [codes, setCodes] = useState<string[] | null>(null);

  const form = useForm<RegenValues>({
    resolver: zodResolver(regenSchema),
    defaultValues: { password: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: RegenValues) =>
      clientFetch<RecoveryCodesResponse>('/api/account/mfa/recovery-codes/regenerate', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: (data) => {
      setCodes(data.recoveryCodes);
      toast.success('Recovery codes regenerated');
    },
  });

  if (codes) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Save these new recovery codes. Previous codes are now invalid.</p>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-3 font-mono text-sm">
          {codes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(codes.join('\n'));
            toast.success('Copied to clipboard');
          }}
        >
          <Copy className="mr-2 h-3 w-3" />
          Copy codes
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        {mutation.error && <ApiErrorAlert error={mutation.error} />}

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <PasswordInput placeholder="Enter your password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" variant="outline" loading={mutation.isPending}>
          Regenerate recovery codes
        </LoadingButton>
      </form>
    </Form>
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
    newPassword: z.string().min(8, 'Must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
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
        {mutation.error && <ApiErrorAlert error={mutation.error} />}

        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Current password</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="current-password" {...field} />
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
                <PasswordInput autoComplete="new-password" {...field} />
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
                <PasswordInput autoComplete="new-password" {...field} />
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
import { TotpEnroll } from '@/components/account/totp-enroll';
import { TotpDisable } from '@/components/account/totp-disable';
import { RecoveryCodes } from '@/components/account/recovery-codes';
import { ChangePasswordForm } from '@/components/account/change-password-form';
import { serverFetch } from '@/lib/api-client';
import type { Profile } from '@/types/account';
import { Badge } from '@/components/ui/badge';

export default async function SecurityPage() {
  const profile = await serverFetch<Profile>('/api/account/profile');

  // MFA status detection: The server's mfa.service sets metadata.mfaEnabled = true
  // on successful TOTP enrollment and clears it on disable. If this convention
  // isn't in place yet, add it to the server's mfa.service.ts enrollTotp/disableTotp
  // methods. Alternatively, add a dedicated GET /api/account/mfa/status endpoint
  // that checks if user has a TOTP secret row.
  const mfaEnabled = (profile.metadata as Record<string, unknown>)?.mfaEnabled === true;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Security</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Two-factor authentication</CardTitle>
              <CardDescription>
                Add an extra layer of security to your account
              </CardDescription>
            </div>
            <Badge variant={mfaEnabled ? 'default' : 'secondary'}>
              {mfaEnabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {mfaEnabled ? <TotpDisable /> : <TotpEnroll />}
        </CardContent>
      </Card>

      {mfaEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>Recovery codes</CardTitle>
            <CardDescription>
              Generate new recovery codes if you&apos;ve lost access to your existing ones
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecoveryCodes />
          </CardContent>
        </Card>
      )}

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
git add -A && git commit -m "feat(web): add security page with TOTP, recovery codes, and password change"
```

---

## Task 7: Playwright E2E Tests

**Files:**
- Create: `apps/web/e2e/account.spec.ts`

- [ ] **Step 1: Write account E2E tests**

Create `apps/web/e2e/account.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';

test.describe('Account Self-Service', () => {
  test.beforeEach(async ({ page }) => {
    // Register + login a fresh user
    const email = `e2e-account-${Date.now()}@test.example`;
    await page.goto('/register');
    await page.getByLabel(/name/i).fill('E2E Account User');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill('TestPassword123!');
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/(account|verify-email)/);

    // If redirected to verify-email, navigate directly to account
    // (in test mode, email verification may be skipped)
    if (page.url().includes('verify-email')) {
      await page.goto('/login');
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill('TestPassword123!');
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.waitForURL(/\/account/);
    }
  });

  test('shows profile page with user info', async ({ page }) => {
    await page.goto('/account');
    await expect(page.getByText('E2E Account User')).toBeVisible();
  });

  test('updates display name', async ({ page }) => {
    await page.goto('/account');
    await page.getByLabel(/display name/i).clear();
    await page.getByLabel(/display name/i).fill('Updated Name');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText(/updated/i)).toBeVisible();
  });

  test('lists sessions with current badge', async ({ page }) => {
    await page.goto('/account/sessions');
    await expect(page.getByText(/current/i)).toBeVisible();
  });

  test('passkeys page loads', async ({ page }) => {
    await page.goto('/account/passkeys');
    await expect(page.getByText(/passkeys/i)).toBeVisible();
  });

  test('security page shows MFA toggle', async ({ page }) => {
    await page.goto('/account/security');
    await expect(page.getByText(/two-factor/i)).toBeVisible();
    await expect(page.getByText(/change password/i)).toBeVisible();
  });

  test('changes password', async ({ page }) => {
    await page.goto('/account/security');
    await page.getByLabel(/current password/i).fill('TestPassword123!');
    await page.getByLabel(/^new password/i).fill('NewPassword456!');
    await page.getByLabel(/confirm/i).fill('NewPassword456!');
    await page.getByRole('button', { name: /change password/i }).click();
    await expect(page.getByText(/changed/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run E2E tests**

```bash
cd apps/web && pnpm e2e
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(web): add account self-service E2E tests"
```

---

## Task Dependency Graph

```
Task 1 (types + layout) ── Task 2 (shared components)
                                │
                  ┌──────────── ┼ ──────────────┐
                  │             │                │
               Task 3       Task 4           Task 5
             (profile)    (sessions)       (passkeys)
                  │             │                │
                  └──────────── ┼ ──────────────┘
                                │
                           Task 6 (security: TOTP + password)
                                │
                           Task 7 (Playwright E2E)
```

Tasks 3, 4, 5 can run **in parallel** after Task 2.
