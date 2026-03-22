# Phase 7-pre: Shared UI Package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `packages/ui` — a shared workspace package containing all code reused between `apps/web` and `apps/admin`. Eliminates duplication of shadcn components, API client, utility functions, and shared UI components.

**Architecture:** Single shared package consumed by both Next.js apps via workspace dependency (`workspace:*`). Each app configures **tsconfig path aliases** so that `@/components/ui/*`, `@/components/shared/*`, `@/lib/utils`, and `@/lib/api-client` resolve to the shared package. This means **all component code in Plans 7a–7d works with zero import changes** — `@/components/ui/button` resolves to `packages/ui/src/components/ui/button.tsx` instead of the local `src/` directory.

**Tech Stack:** React 19, Tailwind CSS v4, shadcn/ui, TanStack Query, clsx, tailwind-merge, lucide-react

**Prerequisite:** None — this is the first Phase 7 task.

**What goes in `packages/ui`:**
- All shadcn base components (`button`, `input`, `card`, `table`, `dialog`, etc.)
- Custom shared components: `LoadingButton`, `ApiErrorAlert`, `Pagination`, `ConfirmDialog`, `PasswordInput`
- `Providers` — TanStack Query client wrapper
- `cn()` utility
- API client — `serverFetch`, `clientFetch`, `ApiRequestError`
- Shared types — `ApiErrorBody`, `PaginatedResponse`

**What stays per-app:**
- `lib/env.ts` — different env vars per app
- `middleware.ts` — different auth logic
- `next.config.ts` — different rewrites/ports
- `app/layout.tsx` — different fonts, themes, metadata
- `app/globals.css` — different theme variables and font imports
- All page components and domain-specific components
- Domain-specific types (`types/account.ts`, `types/admin.ts`, `types/oauth.ts`)

---

## File Map

### New Package (`packages/ui/`)

- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/components.json` — shadcn config
- Create: `packages/ui/src/lib/utils.ts` — cn() helper
- Create: `packages/ui/src/lib/api-client.ts` — serverFetch, clientFetch, ApiRequestError
- Create: `packages/ui/src/types/api.ts` — shared types
- Create: `packages/ui/src/components/ui/*.tsx` — shadcn components
- Create: `packages/ui/src/components/shared/loading-button.tsx`
- Create: `packages/ui/src/components/shared/api-error-alert.tsx`
- Create: `packages/ui/src/components/shared/password-input.tsx`
- Create: `packages/ui/src/components/shared/confirm-dialog.tsx`
- Create: `packages/ui/src/components/shared/pagination.tsx`
- Create: `packages/ui/src/components/providers.tsx`

---

## Task 1: Scaffold packages/ui

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`

- [ ] **Step 1: Create package directory**

```bash
mkdir -p packages/ui/src/{lib,types,components/{ui,shared}}
```

- [ ] **Step 2: Create package.json**

Create `packages/ui/package.json`:

```json
{
  "name": "@identity-starter/ui",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "clsx": "^2.1.0",
    "tailwind-merge": "^3.0.0",
    "lucide-react": "^0.500.0",
    "@tanstack/react-query": "^5.0.0"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "^5.9.3"
  }
}
```

Note: Radix UI dependencies will be added automatically when shadcn components are installed.

- [ ] **Step 3: Create tsconfig.json**

Create `packages/ui/tsconfig.json`:

```json
{
  "extends": "../config/tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "outDir": "dist",
    "rootDir": "src",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

The `@/*` path alias within the package maps to its own `src/` so shadcn-generated components can import from each other (e.g., `@/lib/utils` inside shadcn component files).

- [ ] **Step 4: Install dependencies**

```bash
cd packages/ui && pnpm install
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): scaffold shared UI package"
```

---

## Task 2: shadcn/ui Setup + Base Components

**Files:**
- Create: `packages/ui/components.json`
- Create: `packages/ui/src/lib/utils.ts`
- Create: `packages/ui/src/components/ui/*.tsx`

- [ ] **Step 1: Create cn() utility**

Create `packages/ui/src/lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Initialize shadcn**

```bash
cd packages/ui && pnpm dlx shadcn@latest init
```

When prompted:
- Style: `new-york`
- Base color: `neutral`
- CSS variables: `yes`
- Components path: `src/components/ui`
- Utils path: `src/lib/utils`

This creates `components.json`. Verify it points to the correct paths.

- [ ] **Step 3: Install ALL shadcn components needed by both apps**

Install the union of components needed by `apps/web` and `apps/admin`:

```bash
cd packages/ui && pnpm dlx shadcn@latest add \
  button input label card alert separator form sonner \
  dialog table badge dropdown-menu select alert-dialog \
  avatar tooltip tabs
```

- [ ] **Step 4: Verify build**

```bash
cd packages/ui && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): add shadcn/ui with all shared components"
```

---

## Task 3: API Client + Shared Types

**Files:**
- Create: `packages/ui/src/lib/api-client.ts`
- Create: `packages/ui/src/types/api.ts`

- [ ] **Step 1: Create shared types**

Create `packages/ui/src/types/api.ts`:

```typescript
/**
 * Matches the server's error handler output shape (see error-handler.ts).
 */
export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: unknown;
  fields?: Record<string, string>;
}

/**
 * Standard paginated response from admin API endpoints.
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 2: Create API client**

Create `packages/ui/src/lib/api-client.ts`:

The API client reads `process.env.API_URL` directly (resolved at runtime by the consuming Next.js app). Each app sets its own `API_URL` env var. Validation still happens in each app's `env.ts`.

```typescript
import type { ApiErrorBody } from '../types/api.js';

export class ApiRequestError extends Error {
  constructor(
    public statusCode: number,
    public body: ApiErrorBody,
  ) {
    super(body.error);
    this.name = 'ApiRequestError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json()) as ApiErrorBody;
    throw new ApiRequestError(response.status, body);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

/**
 * Server-side fetch — reads session cookie and forwards as Bearer token.
 * Use in Server Components and Route Handlers.
 *
 * Reads API_URL from process.env (set by the consuming Next.js app).
 */
export async function serverFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const session = cookieStore.get('session');

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.value}` } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });

  return handleResponse<T>(response);
}

/**
 * Client-side fetch — browser sends cookies automatically via same-origin rewrites.
 * Use in Client Components with TanStack Query mutations.
 */
export async function clientFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  return handleResponse<T>(response);
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(ui): add shared API client and types"
```

---

## Task 4: Shared Custom Components

**Files:**
- Create: `packages/ui/src/components/shared/loading-button.tsx`
- Create: `packages/ui/src/components/shared/api-error-alert.tsx`
- Create: `packages/ui/src/components/shared/password-input.tsx`
- Create: `packages/ui/src/components/shared/confirm-dialog.tsx`
- Create: `packages/ui/src/components/shared/pagination.tsx`
- Create: `packages/ui/src/components/providers.tsx`

- [ ] **Step 1: Create loading button**

Create `packages/ui/src/components/shared/loading-button.tsx`:

```tsx
import { Button, type ButtonProps } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingButtonProps extends ButtonProps {
  loading?: boolean;
}

export function LoadingButton({ loading, children, className, disabled, ...props }: LoadingButtonProps) {
  return (
    <Button className={cn(className)} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      {children}
    </Button>
  );
}
```

- [ ] **Step 2: Create API error alert**

Create `packages/ui/src/components/shared/api-error-alert.tsx`:

```tsx
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { ApiRequestError } from '@/lib/api-client';

interface ApiErrorAlertProps {
  error: Error | null;
}

export function ApiErrorAlert({ error }: ApiErrorAlertProps) {
  if (!error) return null;

  const message = error instanceof ApiRequestError
    ? error.body.error
    : error.message;

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 3: Create password input**

Create `packages/ui/src/components/shared/password-input.tsx`:

```tsx
'use client';

import { forwardRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export const PasswordInput = forwardRef<HTMLInputElement, React.ComponentProps<typeof Input>>(
  ({ className, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={showPassword ? 'text' : 'password'}
          className={cn('pr-10', className)}
          {...props}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
          onClick={() => setShowPassword((prev) => !prev)}
          tabIndex={-1}
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
    );
  },
);

PasswordInput.displayName = 'PasswordInput';
```

- [ ] **Step 4: Create confirm dialog**

Create `packages/ui/src/components/shared/confirm-dialog.tsx`:

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

- [ ] **Step 5: Create pagination**

Create `packages/ui/src/components/shared/pagination.tsx`:

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

  if (totalPages <= 1) return null;

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

- [ ] **Step 6: Create providers**

Create `packages/ui/src/components/providers.tsx`:

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

interface ProvidersProps {
  children: ReactNode;
  staleTime?: number;
}

export function Providers({ children, staleTime = 60 * 1000 }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime,
            retry: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

The `staleTime` is configurable per app (web: 60s default, admin can pass `staleTime={30_000}` if desired).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(ui): add shared custom components and providers"
```

---

## Task 5: Path Alias Configuration Guide

This task documents how each consuming app configures tsconfig path aliases so that `@/components/ui/*`, `@/components/shared/*`, `@/lib/utils`, and `@/lib/api-client` resolve to `packages/ui` instead of the local `src/` directory.

**This is the key mechanism that eliminates duplication without changing any component imports in Plans 7a–7d.**

- [ ] **Step 1: Document the tsconfig pattern for consuming apps**

Each app's `tsconfig.json` must have path aliases in this **exact order** (more specific paths before the catch-all `@/*`):

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

**How this works:**
- `@/components/ui/button` → matches first pattern → resolves to `packages/ui/src/components/ui/button.tsx`
- `@/components/shared/loading-button` → matches second pattern → resolves to `packages/ui/src/components/shared/loading-button.tsx`
- `@/lib/utils` → matches specific pattern → resolves to `packages/ui/src/lib/utils.ts`
- `@/lib/api-client` → matches specific pattern → resolves to `packages/ui/src/lib/api-client.ts`
- `@/lib/env` → doesn't match specific patterns → falls through to `@/*` → resolves to local `./src/lib/env.ts`
- `@/components/auth/login-form` → doesn't match specific patterns → falls through to `@/*` → resolves to local `./src/components/auth/login-form.tsx`
- `@/types/account` → falls through to `@/*` → resolves to local `./src/types/account.ts`

**Result: All imports in Plan 7a–7d component code work unchanged.**

- [ ] **Step 2: Document next.config.ts transpile requirement**

Each app's `next.config.ts` must include:

```typescript
const nextConfig: NextConfig = {
  transpilePackages: ['@identity-starter/ui'],
  // ... other config
};
```

This tells Next.js to transpile the workspace package's TSX/JSX files.

- [ ] **Step 3: Document Tailwind v4 source scanning**

Each app's `globals.css` must include a `@source` directive to scan the shared package for Tailwind classes:

```css
@import "tailwindcss";
@source "../../packages/ui/src";
```

This ensures Tailwind generates classes used by shared components.

- [ ] **Step 4: Document package.json dependency**

Each app's `package.json` must include:

```json
{
  "dependencies": {
    "@identity-starter/ui": "workspace:*"
  }
}
```

- [ ] **Step 5: Commit documentation**

No code to commit in this task — the configuration is applied in Plans 7a and 7d when each app is scaffolded.

---

## Task Dependency Graph

```
Task 1 (scaffold) ── Task 2 (shadcn) ── Task 3 (api-client + types) ── Task 4 (custom components)
                                                                           │
                                                                     Task 5 (config guide)
```

Strictly sequential — 5 tasks, must be completed before Plans 7a and 7d begin their scaffold tasks.

---

## What This Eliminates from Other Plans

**From Plan 7a (apps/web):**
- ~~Task 2: shadcn/ui Setup~~ → replaced by: `pnpm add @identity-starter/ui` + tsconfig paths
- ~~Task 3: API client creation~~ → removed (keep only env.ts)
- ~~Task 5: Providers component~~ → import from shared
- ~~Task 7: Shared components (LoadingButton, ApiErrorAlert, PasswordInput)~~ → all in packages/ui

**From Plan 7b (apps/web):**
- ~~Task 2: ConfirmDialog~~ → already in packages/ui

**From Plan 7d (apps/admin):**
- ~~Task 2: shadcn + API client + shared components~~ → replaced by: `pnpm add @identity-starter/ui` + tsconfig paths
- ~~Pagination component~~ → already in packages/ui
