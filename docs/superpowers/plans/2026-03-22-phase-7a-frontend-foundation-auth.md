# Phase 7a: Frontend Foundation + Auth Flows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Next.js 15 web app with all authentication pages — login, registration, MFA verification, email verification, password reset, and passkey conditional UI.

**Architecture:** Next.js 15 App Router with a hybrid data strategy — Server Components for reads, TanStack Query for interactive forms. Custom auth middleware (no next-auth). Server-side cookie support added to the Fastify API so the browser gets httpOnly session cookies. Next.js rewrites proxy `/api/*` to the server for same-origin cookie flow.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS v4, shadcn/ui, React Hook Form + Zod 4, TanStack Query, @simplewebauthn/browser, Playwright

**Prerequisite:** Phases 2-3 complete (auth + MFA + passkey APIs, including passkey routes from Phase 3).
**Phase doc:** `docs/phase-7-frontend.md`
**Related plans:** Phase 7b (Account), 7c (OAuth Consent), 7d (Admin Dashboard)

---

## File Map

### New App (`apps/web/`)

- Create: `apps/web/package.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/components.json` — shadcn config
- Create: `apps/web/src/app/layout.tsx` — root layout with providers
- Create: `apps/web/src/app/page.tsx` — redirect to /account or /login
- Create: `apps/web/src/app/globals.css` — Tailwind v4 entry
- Create: `apps/web/src/middleware.ts` — auth route protection
- Create: `apps/web/src/lib/api-client.ts` — server + client fetch utilities
- Create: `apps/web/src/lib/env.ts` — validated env config
- Create: `apps/web/src/lib/utils.ts` — cn() helper
- Create: `apps/web/src/components/providers.tsx` — TanStack Query provider
- Create: `apps/web/src/components/ui/` — shadcn base components
- Create: `apps/web/src/app/(auth)/layout.tsx` — centered card auth layout
- Create: `apps/web/src/app/(auth)/login/page.tsx`
- Create: `apps/web/src/app/(auth)/register/page.tsx`
- Create: `apps/web/src/app/(auth)/mfa/page.tsx`
- Create: `apps/web/src/app/(auth)/verify-email/page.tsx`
- Create: `apps/web/src/app/(auth)/forgot-password/page.tsx`
- Create: `apps/web/src/app/(auth)/reset-password/page.tsx`
- Create: `apps/web/src/components/auth/login-form.tsx`
- Create: `apps/web/src/components/auth/register-form.tsx`
- Create: `apps/web/src/components/auth/mfa-form.tsx`
- Create: `apps/web/src/components/auth/forgot-password-form.tsx`
- Create: `apps/web/src/components/auth/reset-password-form.tsx`
- Create: `apps/web/src/components/auth/passkey-autofill.tsx`
- Create: `apps/web/src/components/shared/password-input.tsx`
- Create: `apps/web/src/components/shared/loading-button.tsx`
- Create: `apps/web/src/components/shared/api-error-alert.tsx`
- Create: `apps/web/src/types/api.ts` — API response types
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/auth.spec.ts`

### Server Changes

- Modify: `apps/server/package.json` — add `@fastify/cookie`
- Modify: `apps/server/src/app.ts` — register cookie plugin
- Modify: `apps/server/src/core/plugins/auth.ts` — read token from cookie too
- Modify: `apps/server/src/modules/auth/auth.routes.ts` — set/clear session cookie
- Modify: `apps/server/src/modules/mfa/mfa.auth-routes.ts` — set session cookie on MFA verify
- Modify: `apps/server/src/modules/passkey/passkey.routes.ts` — set session cookie on passkey login
- Modify: `.env.example` — update PORT, add COOKIE_SECRET

### Root Config

- Modify: `turbo.json` — add `e2e` task (optional)

---

## Task 1: Scaffold Next.js 15 App

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/lib/utils.ts`

- [ ] **Step 1: Create Next.js app**

```bash
cd apps && pnpm create next-app@latest web \
  --typescript \
  --tailwind \
  --eslint=false \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --turbopack
```

After creation, remove any `.eslintrc*` file that was generated (we use Biome).

- [ ] **Step 2: Clean up generated files**

Remove default boilerplate from `page.tsx` and `layout.tsx`. Delete `public/` SVG files, `src/app/favicon.ico` if present.

Replace `src/app/page.tsx` with a session-aware redirect:

```typescript
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Home() {
  const cookieStore = await cookies();
  const session = cookieStore.get('session');
  redirect(session ? '/account' : '/login');
}
```

- [ ] **Step 3: Update package.json**

Ensure `apps/web/package.json` has:
- `"name": "@identity-starter/web"`
- `"private": true`
- `"type": "module"`
- Scripts: `dev`, `build`, `start`, `lint` (remove the eslint lint script)

No workspace dependencies needed for 7a — `@identity-starter/core` can be added in 7b when shared error types or `PaginatedResult` are needed.

- [ ] **Step 4: Configure next.config.ts with API rewrites**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/oauth/:path*', destination: `${apiUrl}/oauth/:path*` },
      { source: '/.well-known/:path*', destination: `${apiUrl}/.well-known/:path*` },
    ];
  },
};

export default nextConfig;
```

This proxies all API requests through Next.js, making cookies same-origin.

- [ ] **Step 5: Update tsconfig.json**

Ensure `apps/web/tsconfig.json` has path aliases:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

Keep Next.js defaults for the rest (it manages its own tsconfig).

- [ ] **Step 6: Create utility helper**

Create `apps/web/src/lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 7: Install utility dependencies**

```bash
cd apps/web && pnpm add clsx tailwind-merge
```

- [ ] **Step 8: Update turbo.json for Next.js outputs**

In `turbo.json`, the `build` task outputs `dist/**`. Next.js outputs to `.next/**`. Update to include both:

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    }
  }
}
```

- [ ] **Step 9: Verify build**

```bash
cd apps/web && pnpm build
```

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(web): scaffold Next.js 15 app with API rewrites"
```

---

## Task 2: shadcn/ui Setup + Base Components

**Files:**
- Create: `apps/web/components.json`
- Create: `apps/web/src/components/ui/*.tsx` (button, input, label, card, alert, separator, form)

- [ ] **Step 1: Initialize shadcn**

```bash
cd apps/web && pnpm dlx shadcn@latest init
```

When prompted:
- Style: `new-york`
- Base color: `neutral`
- CSS variables: `yes`
- `src/components/ui` path

This creates `components.json` and updates `globals.css` with CSS variables.

- [ ] **Step 2: Install base components**

```bash
cd apps/web && pnpm dlx shadcn@latest add button input label card alert separator form sonner
```

The `form` component includes React Hook Form + Zod resolver integration.

- [ ] **Step 3: Verify imports resolve**

```bash
cd apps/web && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): add shadcn/ui with base components"
```

---

## Task 3: Environment Config + API Client

**Files:**
- Create: `apps/web/src/lib/env.ts`
- Create: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/types/api.ts`

- [ ] **Step 1: Create env config**

Create `apps/web/src/lib/env.ts`:

```typescript
import { z } from 'zod';

const envSchema = z.object({
  API_URL: z.string().default('http://localhost:3001'),
  NEXT_PUBLIC_APP_NAME: z.string().default('Identity Starter'),
});

export const env = envSchema.parse({
  API_URL: process.env.API_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
});
```

- [ ] **Step 2: Install Zod**

```bash
cd apps/web && pnpm add zod@^4
```

- [ ] **Step 3: Define API response types**

Create `apps/web/src/types/api.ts`:

```typescript
export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'suspended' | 'pending_verification';
}

export interface AuthResponse {
  token: string;
  verificationToken?: string;
  user: ApiUser;
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  mfaToken: string;
}

export type LoginResponse = AuthResponse | MfaChallengeResponse;

export interface MfaVerifyResponse {
  token: string;
  user: ApiUser;
}

/**
 * Matches the server's error handler output shape (see error-handler.ts).
 * DomainError: { error: message, code: ERROR_CODE }
 * ValidationError: { error: message, code: 'VALIDATION_ERROR', details?: issues[], fields?: Record }
 */
export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: unknown;
  fields?: Record<string, string>;
}

export function isMfaChallenge(response: LoginResponse): response is MfaChallengeResponse {
  return 'mfaRequired' in response && response.mfaRequired === true;
}
```

- [ ] **Step 4: Create API client**

Create `apps/web/src/lib/api-client.ts`:

```typescript
import { env } from './env';
import type { ApiErrorBody } from '@/types/api';

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
 */
export async function serverFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const session = cookieStore.get('session');

  const response = await fetch(`${env.API_URL}${path}`, {
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

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): add environment config, API types, and fetch utilities"
```

---

## Task 4: Server-Side Cookie Authentication Support

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/core/plugins/auth.ts`
- Modify: `apps/server/src/modules/auth/auth.routes.ts`
- Modify: `apps/server/src/modules/mfa/mfa.auth-routes.ts`
- Modify: `apps/server/src/modules/passkey/passkey.routes.ts`
- Modify: `.env.example`

**⚠️ Coordination note:** This task modifies server files. If Phase 5b/6 work is on a separate branch, merge those first or apply these changes to the main branch after they land.

- [ ] **Step 1: Install @fastify/cookie**

```bash
cd apps/server && pnpm add @fastify/cookie
```

- [ ] **Step 2: Add COOKIE_SECRET to env**

In `apps/server/src/core/env.ts`, add:

```typescript
COOKIE_SECRET: z.string().default('change-me-in-production'),
```

In `.env.example`, add:

```env
# Cookie
COOKIE_SECRET=change-me-in-production

# Server (use 3001 when running alongside Next.js frontend on 3000)
PORT=3001
```

- [ ] **Step 3: Register cookie plugin in app.ts**

In `apps/server/src/app.ts`, add import:

```typescript
import cookie from '@fastify/cookie';
```

After `await app.register(formbody);`, add:

```typescript
await app.register(cookie, {
  secret: env.COOKIE_SECRET,
  parseOptions: {},
});
```

- [ ] **Step 4: Update auth plugin to read token from cookie**

In `apps/server/src/core/plugins/auth.ts`, modify the `requireSession` decorator to also check cookies:

```typescript
fastify.decorate('requireSession', async (request: FastifyRequest) => {
  let rawToken: string | undefined;

  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    rawToken = authHeader.slice(7);
  } else if (request.cookies?.session) {
    rawToken = request.cookies.session;
  }

  if (!rawToken) {
    throw new UnauthorizedError('Missing or invalid authentication credentials');
  }

  const session = await opts.validateSession(db, rawToken);
  if (!session) {
    throw new UnauthorizedError('Invalid or expired session');
  }

  request.session = session;
  request.userId = session.userId;
});
```

- [ ] **Step 5: Create cookie helper**

Add to `apps/server/src/core/plugins/auth.ts`:

```typescript
import type { FastifyReply } from 'fastify';

export function setSessionCookie(reply: FastifyReply, token: string, maxAge: number): void {
  reply.setCookie('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie('session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}
```

Note: `sameSite: 'lax'` instead of `'strict'` — strict blocks the cookie on OAuth redirect flows (user coming back from external IdP). Lax still prevents CSRF on POST requests.

- [ ] **Step 6: Set cookie on login**

In `apps/server/src/modules/auth/auth.routes.ts`, import the helpers:

```typescript
import { setSessionCookie, clearSessionCookie } from '../../core/plugins/auth.js';
import { env } from '../../core/env.js';
```

In the login route handler, after getting the result:

```typescript
async (request, reply) => {
  const result = await authService.login(request.body, {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  });
  if ('token' in result && !('mfaRequired' in result)) {
    setSessionCookie(reply, result.token, env.SESSION_TTL_SECONDS);
  }
  return reply.status(200).send(result);
},
```

- [ ] **Step 7: Set cookie on register**

In the register route handler:

```typescript
async (request, reply) => {
  const result = await authService.register(request.body);
  setSessionCookie(reply, result.token, env.SESSION_TTL_SECONDS);
  return reply.status(201).send(result);
},
```

- [ ] **Step 8: Clear cookie on logout**

In the logout route handler:

```typescript
async (request, reply) => {
  await authService.logout(request.session.id, request.userId);
  clearSessionCookie(reply);
  return reply.status(204).send();
},
```

- [ ] **Step 9: Set cookie on MFA verify**

In `apps/server/src/modules/mfa/mfa.auth-routes.ts`, import and use:

```typescript
import { setSessionCookie } from '../../core/plugins/auth.js';
import { env } from '../../core/env.js';
```

```typescript
async (request, reply) => {
  const result = await mfaService.verifyMfaChallenge(request.body, {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  });
  setSessionCookie(reply, result.token, env.SESSION_TTL_SECONDS);
  return reply.send(result);
},
```

- [ ] **Step 10: Set cookie on passkey login**

In `apps/server/src/modules/passkey/passkey.routes.ts`, in the `login/verify` handler:

```typescript
import { setSessionCookie } from '../../core/plugins/auth.js';
import { env } from '../../core/env.js';
```

```typescript
async (request, reply) => {
  const body = request.body as unknown as AuthenticationResponseJSON;
  const result = await passkeyService.verifyAuthentication(body, {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  });
  setSessionCookie(reply, result.token, env.SESSION_TTL_SECONDS);
  return reply.send(result);
},
```

- [ ] **Step 11: Run server tests to verify no regressions**

```bash
cd apps/server && pnpm test
```

Existing tests use Bearer tokens — they should still pass. Cookie reading is a fallback.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "feat(server): add httpOnly session cookie support alongside Bearer tokens"
```

---

## Task 5: TanStack Query Provider + Root Layout

**Files:**
- Create: `apps/web/src/components/providers.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Install TanStack Query**

```bash
cd apps/web && pnpm add @tanstack/react-query
```

- [ ] **Step 2: Create providers component**

Create `apps/web/src/components/providers.tsx`:

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 3: Create root layout**

Update `apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Identity Starter',
  description: 'Identity and access management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
cd apps/web && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): add TanStack Query provider and root layout"
```

---

## Task 6: Next.js Auth Middleware

**Files:**
- Create: `apps/web/src/middleware.ts`

- [ ] **Step 1: Create middleware**

Create `apps/web/src/middleware.ts`:

```typescript
import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/mfa',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get('session');

  if (!session && !isPublicPath(pathname)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session && isPublicPath(pathname) && pathname !== '/mfa') {
    return NextResponse.redirect(new URL('/account', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|oauth|.well-known).*)'],
};
```

The `/mfa` page is public but only accessible with a valid `mfaToken` search param (checked in the page component, not middleware). Logged-in users aren't redirected away from `/mfa` because the login flow may have just set a partial session.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(web): add auth middleware with route protection"
```

---

## Task 7: Auth Layout Shell

**Files:**
- Create: `apps/web/src/app/(auth)/layout.tsx`

- [ ] **Step 1: Create auth layout**

Create `apps/web/src/app/(auth)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
```

This centers all auth pages in a max-width container.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(web): add centered auth page layout"
```

---

## Task 8: Shared Auth Components

**Files:**
- Create: `apps/web/src/components/shared/password-input.tsx`
- Create: `apps/web/src/components/shared/loading-button.tsx`
- Create: `apps/web/src/components/shared/api-error-alert.tsx`

- [ ] **Step 1: Create password input with visibility toggle**

Create `apps/web/src/components/shared/password-input.tsx`:

```tsx
'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState, type ComponentProps } from 'react';

export const PasswordInput = forwardRef<HTMLInputElement, ComponentProps<'input'>>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-10', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          tabIndex={-1}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);

PasswordInput.displayName = 'PasswordInput';
```

- [ ] **Step 2: Install lucide-react**

```bash
cd apps/web && pnpm add lucide-react
```

(May already be installed by shadcn — check first.)

- [ ] **Step 3: Create loading button**

Create `apps/web/src/components/shared/loading-button.tsx`:

```tsx
import { Button, type ButtonProps } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface LoadingButtonProps extends ButtonProps {
  loading?: boolean;
}

export function LoadingButton({ loading, disabled, children, ...props }: LoadingButtonProps) {
  return (
    <Button disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  );
}
```

- [ ] **Step 4: Create API error alert**

Create `apps/web/src/components/shared/api-error-alert.tsx`:

```tsx
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { ApiRequestError } from '@/lib/api-client';

interface ApiErrorAlertProps {
  error: ApiRequestError | Error | null;
}

export function ApiErrorAlert({ error }: ApiErrorAlertProps) {
  if (!error) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): add shared auth components (password input, loading button, error alert)"
```

---

## Task 9: Login Page

**Files:**
- Create: `apps/web/src/components/auth/login-form.tsx`
- Create: `apps/web/src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Create login form component**

Create `apps/web/src/components/auth/login-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { Input } from '@/components/ui/input';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { LoadingButton } from '@/components/shared/loading-button';
import { PasswordInput } from '@/components/shared/password-input';
import { type ApiRequestError, clientFetch } from '@/lib/api-client';
import { isMfaChallenge, type LoginResponse } from '@/types/api';

const loginSchema = z.object({
  email: z.email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/account';
  const [error, setError] = useState<ApiRequestError | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginValues) {
    setError(null);
    try {
      const result = await clientFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });

      if (isMfaChallenge(result)) {
        router.push(`/mfa?token=${encodeURIComponent(result.mfaToken)}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch (err) {
      setError(err as ApiRequestError);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <ApiErrorAlert error={error} />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="you@example.com" autoComplete="username webauthn" {...field} />
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
              <div className="flex items-center justify-between">
                <FormLabel>Password</FormLabel>
                <Link href="/forgot-password" className="text-sm text-muted-foreground hover:underline">
                  Forgot password?
                </Link>
              </div>
              <FormControl>
                <PasswordInput placeholder="••••••••" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </LoadingButton>

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </form>
    </Form>
  );
}
```

Key behaviors:
- `autoComplete="username webauthn"` on the email field enables passkey conditional UI (autofill) in supporting browsers. Task 13 adds the JS wiring.
- On MFA challenge, redirects to `/mfa` with the temporary token.
- On success, `router.refresh()` triggers middleware re-evaluation with the new cookie.

- [ ] **Step 2: Create login page**

Create `apps/web/src/app/(auth)/login/page.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from '@/components/auth/login-form';
import { Suspense } from 'react';

export default function LoginPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>Sign in to your account</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
```

`Suspense` wraps `LoginForm` because it uses `useSearchParams()` which requires a Suspense boundary.

- [ ] **Step 3: Verify build**

```bash
cd apps/web && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): add login page with email/password form"
```

---

## Task 10: Registration Page

**Files:**
- Create: `apps/web/src/components/auth/register-form.tsx`
- Create: `apps/web/src/app/(auth)/register/page.tsx`

- [ ] **Step 1: Create register form component**

Create `apps/web/src/components/auth/register-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { Input } from '@/components/ui/input';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { LoadingButton } from '@/components/shared/loading-button';
import { PasswordInput } from '@/components/shared/password-input';
import { type ApiRequestError, clientFetch } from '@/lib/api-client';
import type { AuthResponse } from '@/types/api';

const registerSchema = z.object({
  displayName: z.string().min(1, 'Name is required').max(255),
  email: z.email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<ApiRequestError | null>(null);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '' },
  });

  async function onSubmit(values: RegisterValues) {
    setError(null);
    try {
      const result = await clientFetch<AuthResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(values),
      });

      if (result.verificationToken) {
        router.push(`/verify-email?token=${encodeURIComponent(result.verificationToken)}`);
      } else {
        router.push('/account');
        router.refresh();
      }
    } catch (err) {
      setError(err as ApiRequestError);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <ApiErrorAlert error={error} />

        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Jane Doe" autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="you@example.com" autoComplete="email" {...field} />
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
                <PasswordInput
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Create account
        </LoadingButton>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Create register page**

Create `apps/web/src/app/(auth)/register/page.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RegisterForm } from '@/components/auth/register-form';

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Create an account</CardTitle>
        <CardDescription>Enter your details to get started</CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): add registration page"
```

---

## Task 11: MFA Verification Page

**Files:**
- Create: `apps/web/src/components/auth/mfa-form.tsx`
- Create: `apps/web/src/app/(auth)/mfa/page.tsx`

- [ ] **Step 1: Create MFA form component**

Create `apps/web/src/components/auth/mfa-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
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
import { Button } from '@/components/ui/button';
import { type ApiRequestError, clientFetch } from '@/lib/api-client';
import type { MfaVerifyResponse } from '@/types/api';

const totpSchema = z.object({
  otp: z.string().length(6, 'Enter a 6-digit code'),
});

const recoverySchema = z.object({
  recoveryCode: z.string().min(1, 'Enter a recovery code'),
});

type TotpValues = z.infer<typeof totpSchema>;
type RecoveryValues = z.infer<typeof recoverySchema>;

export function MfaForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mfaToken = searchParams.get('token') ?? '';
  const callbackUrl = searchParams.get('callbackUrl') ?? '/account';
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const totpForm = useForm<TotpValues>({
    resolver: zodResolver(totpSchema),
    defaultValues: { otp: '' },
  });

  const recoveryForm = useForm<RecoveryValues>({
    resolver: zodResolver(recoverySchema),
    defaultValues: { recoveryCode: '' },
  });

  useEffect(() => {
    if (!mfaToken) {
      router.replace('/login');
    }
  }, [mfaToken, router]);

  async function submitMfa(body: Record<string, string>) {
    setError(null);
    try {
      await clientFetch<MfaVerifyResponse>('/api/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ mfaToken, ...body }),
      });
      router.push(callbackUrl);
      router.refresh();
    } catch (err) {
      setError(err as ApiRequestError);
    }
  }

  if (!mfaToken) {
    return null;
  }

  if (useRecovery) {
    return (
      <Form {...recoveryForm}>
        <form onSubmit={recoveryForm.handleSubmit((v) => submitMfa(v))} className="space-y-4">
          <ApiErrorAlert error={error} />

          <FormField
            control={recoveryForm.control}
            name="recoveryCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Recovery code</FormLabel>
                <FormControl>
                  <Input placeholder="xxxx-xxxx-xxxx" autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <LoadingButton
            type="submit"
            className="w-full"
            loading={recoveryForm.formState.isSubmitting}
          >
            Verify
          </LoadingButton>

          <Button
            type="button"
            variant="link"
            className="w-full"
            onClick={() => setUseRecovery(false)}
          >
            Use authenticator app instead
          </Button>
        </form>
      </Form>
    );
  }

  return (
    <Form {...totpForm}>
      <form onSubmit={totpForm.handleSubmit((v) => submitMfa(v))} className="space-y-4">
        <ApiErrorAlert error={error} />

        <FormField
          control={totpForm.control}
          name="otp"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Authentication code</FormLabel>
              <FormControl>
                <Input
                  placeholder="000000"
                  maxLength={6}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" className="w-full" loading={totpForm.formState.isSubmitting}>
          Verify
        </LoadingButton>

        <Button
          type="button"
          variant="link"
          className="w-full"
          onClick={() => setUseRecovery(true)}
        >
          Use a recovery code instead
        </Button>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Create MFA page**

Create `apps/web/src/app/(auth)/mfa/page.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MfaForm } from '@/components/auth/mfa-form';
import { Suspense } from 'react';

export default function MfaPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Two-factor authentication</CardTitle>
        <CardDescription>Enter the code from your authenticator app</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense>
          <MfaForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): add MFA verification page with TOTP and recovery code support"
```

---

## Task 12: Email Verification Page

**Files:**
- Create: `apps/web/src/app/(auth)/verify-email/page.tsx`

- [ ] **Step 1: Create email verification page**

Create `apps/web/src/app/(auth)/verify-email/page.tsx`:

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { type ApiRequestError, clientFetch } from '@/lib/api-client';
import { CheckCircle2, Loader2 } from 'lucide-react';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }

    clientFetch('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then(() => setStatus('success'))
      .catch((err) => {
        setError(err as ApiRequestError);
        setStatus('error');
      });
  }, [token]);

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Email verification</CardTitle>
        <CardDescription>
          {status === 'verifying' && 'Verifying your email address...'}
          {status === 'success' && 'Your email has been verified'}
          {status === 'error' && 'Verification failed'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'verifying' && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {status === 'success' && (
          <>
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Your email address has been verified. You can now sign in.
              </AlertDescription>
            </Alert>
            <LoadingButton className="w-full" onClick={() => router.push('/login')}>
              Go to login
            </LoadingButton>
          </>
        )}

        {status === 'error' && (
          <>
            <ApiErrorAlert error={error} />
            <LoadingButton className="w-full" variant="outline" onClick={() => router.push('/login')}>
              Back to login
            </LoadingButton>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(web): add email verification page"
```

---

## Task 13: Password Reset Flow

**Files:**
- Create: `apps/web/src/components/auth/forgot-password-form.tsx`
- Create: `apps/web/src/components/auth/reset-password-form.tsx`
- Create: `apps/web/src/app/(auth)/forgot-password/page.tsx`
- Create: `apps/web/src/app/(auth)/reset-password/page.tsx`

- [ ] **Step 1: Create forgot password form**

Create `apps/web/src/components/auth/forgot-password-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
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
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { LoadingButton } from '@/components/shared/loading-button';
import { type ApiRequestError, clientFetch } from '@/lib/api-client';
import { CheckCircle2 } from 'lucide-react';

const forgotPasswordSchema = z.object({
  email: z.email('Please enter a valid email address'),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: ForgotPasswordValues) {
    setError(null);
    try {
      await clientFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setSubmitted(true);
    } catch (err) {
      setError(err as ApiRequestError);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-4">
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            If an account exists for that email, you will receive password reset instructions.
          </AlertDescription>
        </Alert>
        <Link href="/login" className="block text-center text-sm text-primary hover:underline">
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <ApiErrorAlert error={error} />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="you@example.com" autoComplete="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Send reset link
        </LoadingButton>

        <Link href="/login" className="block text-center text-sm text-muted-foreground hover:underline">
          Back to login
        </Link>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Create reset password form**

Create `apps/web/src/components/auth/reset-password-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { LoadingButton } from '@/components/shared/loading-button';
import { PasswordInput } from '@/components/shared/password-input';
import { type ApiRequestError, clientFetch } from '@/lib/api-client';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: ResetPasswordValues) {
    setError(null);
    try {
      await clientFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: values.newPassword }),
      });
      setSuccess(true);
    } catch (err) {
      setError(err as ApiRequestError);
    }
  }

  if (!token) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Invalid reset link. Please request a new password reset.
        </AlertDescription>
      </Alert>
    );
  }

  if (success) {
    return (
      <div className="space-y-4">
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            Your password has been reset. You can now sign in with your new password.
          </AlertDescription>
        </Alert>
        <LoadingButton className="w-full" onClick={() => router.push('/login')}>
          Go to login
        </LoadingButton>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <ApiErrorAlert error={error} />

        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <PasswordInput placeholder="At least 8 characters" autoComplete="new-password" {...field} />
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
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <PasswordInput placeholder="Repeat your password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Reset password
        </LoadingButton>
      </form>
    </Form>
  );
}
```

- [ ] **Step 3: Create forgot password page**

Create `apps/web/src/app/(auth)/forgot-password/page.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Forgot your password?</CardTitle>
        <CardDescription>Enter your email and we&apos;ll send you a reset link</CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Create reset password page**

Create `apps/web/src/app/(auth)/reset-password/page.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { Suspense } from 'react';

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Reset your password</CardTitle>
        <CardDescription>Choose a new password for your account</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): add forgot password and reset password pages"
```

---

## Task 14: Passkey Conditional UI

**Files:**
- Create: `apps/web/src/components/auth/passkey-autofill.tsx`
- Modify: `apps/web/src/components/auth/login-form.tsx`

Passkey conditional UI (WebAuthn autofill) lets the browser offer stored passkeys in the email field's autofill dropdown. When the user selects a passkey, the browser performs the WebAuthn ceremony automatically.

- [ ] **Step 1: Install @simplewebauthn/browser**

```bash
cd apps/web && pnpm add @simplewebauthn/browser
```

- [ ] **Step 2: Create passkey autofill hook**

Create `apps/web/src/components/auth/passkey-autofill.tsx`:

```tsx
'use client';

import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
} from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { clientFetch } from '@/lib/api-client';
import type { AuthResponse } from '@/types/api';

interface PasskeyAutofillProps {
  callbackUrl: string;
}

export function PasskeyAutofill({ callbackUrl }: PasskeyAutofillProps) {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initConditionalUI() {
      const supported = await browserSupportsWebAuthnAutofill();
      if (!supported || cancelled) {
        return;
      }

      try {
        const options = await clientFetch<PublicKeyCredentialRequestOptionsJSON>(
          '/api/auth/passkeys/login/options',
          { method: 'POST' },
        );

        abortRef.current = new AbortController();

        const credential = await startAuthentication({
          optionsJSON: options,
          useBrowserAutofill: true,
        });

        if (cancelled) {
          return;
        }

        await clientFetch<AuthResponse>('/api/auth/passkeys/login/verify', {
          method: 'POST',
          body: JSON.stringify(credential),
        });

        router.push(callbackUrl);
        router.refresh();
      } catch {
        // Conditional UI was cancelled or failed — user can still use password
      }
    }

    initConditionalUI();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [callbackUrl, router]);

  return null;
}
```

This component renders nothing visually. It starts the WebAuthn conditional UI ceremony on mount. If the user picks a passkey from autofill, it completes login. If not, it silently aborts.

- [ ] **Step 3: Wire into login form**

In `apps/web/src/components/auth/login-form.tsx`, add the imports:

```typescript
import { PasskeyAutofill } from './passkey-autofill';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Fingerprint } from 'lucide-react';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
```

Add the `PasskeyAutofill` component inside the form, before the `ApiErrorAlert`:

```tsx
<PasskeyAutofill callbackUrl={callbackUrl} />
```

After the submit button, add a visible passkey fallback button for browsers that don't support conditional UI (autofill):

```tsx
<Separator className="my-4" />

<Button
  type="button"
  variant="outline"
  className="w-full"
  onClick={async () => {
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const options = await clientFetch<PublicKeyCredentialRequestOptionsJSON>(
        '/api/auth/passkeys/login/options',
        { method: 'POST' },
      );
      const credential = await startAuthentication({ optionsJSON: options });
      await clientFetch('/api/auth/passkeys/login/verify', {
        method: 'POST',
        body: JSON.stringify(credential),
      });
      router.push(callbackUrl);
      router.refresh();
    } catch {
      // User cancelled or WebAuthn not available
    }
  }}
>
  <Fingerprint className="mr-2 h-4 w-4" />
  Sign in with passkey
</Button>
```

The email `<Input>` already has `autoComplete="username webauthn"` from Task 9, which is required for the browser to show passkey suggestions in the conditional UI path.

- [ ] **Step 4: Verify build**

```bash
cd apps/web && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): add passkey conditional UI (WebAuthn autofill) to login"
```

---

## Task 15: Security Headers

**Files:**
- Modify: `apps/web/next.config.ts`

- [ ] **Step 1: Add security headers**

Update `apps/web/next.config.ts` to add headers:

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/oauth/:path*', destination: `${apiUrl}/oauth/:path*` },
      { source: '/.well-known/:path*', destination: `${apiUrl}/.well-known/:path*` },
    ];
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
      {
        source: '/(login|register|mfa|verify-email|forgot-password|reset-password|oauth)(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
```

CSP with nonce requires `next.config.ts` + middleware coordination. For now, start with these headers. A nonce-based CSP can be layered in later — Next.js's built-in CSP support via `next.config.experimental.serverActions` is evolving.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(web): add security headers (X-Frame-Options, Referrer-Policy, no-cache on auth)"
```

---

## Task 16: Playwright Setup + Auth E2E Tests

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/auth.spec.ts`

- [ ] **Step 1: Install Playwright**

```bash
cd apps/web && pnpm add -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Create Playwright config**

Create `apps/web/playwright.config.ts`:

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
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'pnpm --filter @identity-starter/server dev',
      port: 3001,
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
    },
    {
      command: 'pnpm dev',
      port: 3000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
```

- [ ] **Step 3: Add e2e script to package.json**

In `apps/web/package.json`, add:

```json
{
  "scripts": {
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui"
  }
}
```

- [ ] **Step 4: Write auth E2E tests**

Create `apps/web/e2e/auth.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';

const TEST_USER = {
  email: `e2e-${Date.now()}@test.example`,
  password: 'TestPassword123!',
  displayName: 'E2E Test User',
};

test.describe('Authentication Flows', () => {
  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows login page with form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test('shows validation errors on empty submit', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/valid email/i)).toBeVisible();
  });

  test('shows error on wrong credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('nonexistent@example.com');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/invalid|unauthorized|not found/i)).toBeVisible();
  });

  test('registers a new user', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /create an account/i })).toBeVisible();
    await page.getByLabel(/name/i).fill(TEST_USER.displayName);
    await page.getByLabel(/email/i).fill(TEST_USER.email);
    await page.getByLabel(/password/i).fill(TEST_USER.password);
    await page.getByRole('button', { name: /create account/i }).click();

    // Should redirect to verify-email or account depending on server config
    await expect(page).toHaveURL(/\/(verify-email|account)/);
  });

  test('forgot password flow shows success message', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel(/email/i).fill('test@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByText(/reset instructions/i)).toBeVisible();
  });

  test('navigates between login and register', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /sign up/i }).click();
    await expect(page).toHaveURL(/\/register/);
    await page.getByRole('link', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
```

- [ ] **Step 5: Run E2E tests**

E2E tests need a real database. Ensure your `.env` has a valid `DATABASE_URL` pointing to a running PostgreSQL instance with migrations applied:

```bash
# Terminal 1: ensure DB is up and migrated
pnpm db:migrate

# Terminal 2: run E2E (Playwright will start server + web via webServer config)
cd apps/web && pnpm e2e
```

Expected: all tests pass. The `registers a new user` test creates a real user in the DB.

Note: MFA and passkey E2E tests are limited — WebAuthn requires browser-level virtual authenticator support (Playwright's `cdp` session can create one for Chromium). A dedicated passkey E2E test can be added later using `page.context().cdpSession()` to create a virtual authenticator. MFA E2E requires seeding a TOTP secret and generating a valid code, which can be done with `otpauth` in the test.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "test(web): add Playwright setup and auth E2E tests"
```

---

## Task Dependency Graph

```
Task 1 (scaffold) ── Task 2 (shadcn) ── Task 3 (env + API client)
                                              │
                           ┌──────────────────┤
                           │                  │
                      Task 4 (server cookies) │
                           │                  │
                           └──────────────────┤
                                              │
Task 5 (TanStack + layout) ── Task 6 (middleware) ── Task 7 (auth layout)
                                                          │
                                                     Task 8 (shared components)
                                                          │
                                    ┌─────────┬───────────┼───────────┬────────────┐
                                    │         │           │           │            │
                                 Task 9   Task 10     Task 11    Task 12      Task 13
                                (login)   (register)  (MFA)    (verify-email) (password reset)
                                    │         │           │           │            │
                                    │         └───────────┴───────────┴────────────┘
                                    │                     │
                                 Task 14 (passkey)  Task 15 (security headers)
                                    │                     │
                                    └──────────┬──────────┘
                                               │
                                         Task 16 (Playwright E2E)
```

Tasks 9-13 can run **in parallel** after Task 8.
Task 14 depends on Task 9 (modifies login form).
Task 16 depends on all pages being built.
