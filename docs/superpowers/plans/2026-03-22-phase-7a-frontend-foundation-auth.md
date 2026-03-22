# Phase 7a: Frontend Foundation + Auth Flows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Next.js 15 end-user web app (`apps/web`) with all authentication pages — login, registration, MFA verification, email verification, password reset, and passkey conditional UI.

**Architecture:** Next.js 15 App Router with a hybrid data strategy — Server Components for reads, TanStack Query for interactive forms. Custom auth middleware (no next-auth). Server-side cookie support added to the Fastify API so the browser gets httpOnly session cookies. Next.js rewrites proxy `/api/*` to the server for same-origin cookie flow.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS v4, shadcn/ui, React Hook Form + Zod 4, TanStack Query, @simplewebauthn/browser, Playwright

**Prerequisite:** Phase 7-pre complete (`packages/ui` shared package). Phases 2-3 complete (auth + MFA + passkey APIs).
**Phase doc:** `docs/phase-7-frontend.md`
**Related plans:** Phase 7-pre (shared UI package), 7b (Account), 7c (OAuth Consent), 7d (Admin — separate app)

**Design Direction:** Refined minimalism with high-trust signals. This is an identity provider — the design must communicate security and professionalism. Use a distinctive display font (e.g., Outfit, Satoshi, or Cabinet Grotesk) paired with a clean body font (e.g., Plus Jakarta Sans). Muted color palette with a strong accent for CTAs. Subtle entrance animations on auth cards. No generic Inter/Roboto.

**Vercel Best Practices:**
- `async-parallel`: Parallel data fetches where multiple calls are needed
- `bundle-dynamic-imports`: Lazy-load `@simplewebauthn/browser` (only needed on login/passkey pages)
- `server-serialization`: Pass only needed fields from Server Components to Client Components
- `rerender-lazy-state-init`: Use function initializer for `useState` with expensive defaults
- `rendering-conditional-render`: Ternary over `&&` for conditional JSX

---

## File Map

### New App (`apps/web/`)

- Create: `apps/web/package.json` — depends on `@identity-starter/ui`
- Create: `apps/web/next.config.ts` — API rewrites + `transpilePackages`
- Create: `apps/web/tsconfig.json` — path aliases pointing shared code to `packages/ui`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/src/app/layout.tsx` — root layout with providers from packages/ui
- Create: `apps/web/src/app/page.tsx` — redirect to /account or /login
- Create: `apps/web/src/app/globals.css` — Tailwind v4 entry + `@source` for packages/ui
- Create: `apps/web/src/middleware.ts` — auth route protection
- Create: `apps/web/src/lib/env.ts` — validated env config (app-specific)
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
- Create: `apps/web/src/types/api.ts` — app-specific API response types (AuthResponse, LoginResponse, etc.)
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/auth.spec.ts`

**Shared code from `packages/ui` (via tsconfig path aliases — no local copies):**
- `@/components/ui/*` → `packages/ui/src/components/ui/*` (all shadcn components)
- `@/components/shared/*` → `packages/ui/src/components/shared/*` (LoadingButton, ApiErrorAlert, PasswordInput, ConfirmDialog, Pagination)
- `@/lib/utils` → `packages/ui/src/lib/utils.ts` (cn helper)
- `@/lib/api-client` → `packages/ui/src/lib/api-client.ts` (serverFetch, clientFetch, ApiRequestError)

### Server Changes

- Modify: `apps/server/package.json` — add `@fastify/cookie`
- Modify: `apps/server/src/app.ts` — register cookie plugin
- Modify: `apps/server/src/core/plugins/auth.ts` — read token from cookie too
- Modify: `apps/server/src/modules/auth/auth.routes.ts` — set/clear session cookie
- Modify: `apps/server/src/modules/mfa/mfa.auth-routes.ts` — set session cookie on MFA verify
- Modify: `apps/server/src/modules/passkey/passkey.routes.ts` — set session cookie on passkey login
- Modify: `.env.example` — update PORT, add COOKIE_SECRET

### Root Config

- Modify: `turbo.json` — add `.next/**` to build outputs, add `e2e` task

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
- Scripts: `dev`, `build`, `start` (remove the eslint lint script)

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

- [ ] **Step 6: Update turbo.json for Next.js outputs**

In `turbo.json`, update build task outputs to include `.next/**`:

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

- [ ] **Step 7: Verify build**

```bash
cd apps/web && pnpm build
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(web): scaffold Next.js 15 app with API rewrites"
```

---

## Task 2: Configure Shared Package + Path Aliases

**Files:**
- Modify: `apps/web/package.json` — add `@identity-starter/ui` dependency
- Modify: `apps/web/tsconfig.json` — add path aliases for shared code
- Modify: `apps/web/next.config.ts` — add `transpilePackages`
- Modify: `apps/web/src/app/globals.css` — add `@source` for shared package

All shadcn components, shared components, API client, and utilities come from `packages/ui` (created in Phase 7-pre). No local copies needed.

- [ ] **Step 1: Add shared package dependency**

```bash
cd apps/web && pnpm add @identity-starter/ui@workspace:*
```

- [ ] **Step 2: Configure tsconfig path aliases**

Update `apps/web/tsconfig.json` paths — **specific paths must come before the catch-all `@/*`**:

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

This makes `@/components/ui/button` resolve to `packages/ui` while `@/lib/env` and `@/components/auth/*` resolve to local `./src/`.

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

In `apps/web/src/app/globals.css`, add after the Tailwind import:

```css
@import "tailwindcss";
@source "../../../../packages/ui/src";
```

This ensures Tailwind generates classes used by shared components.

- [ ] **Step 5: Verify build**

```bash
cd apps/web && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): configure shared UI package with path aliases"
```

---

## Task 3: Environment Config + App-Specific Types

**Files:**
- Create: `apps/web/src/lib/env.ts`
- Create: `apps/web/src/types/api.ts`

API client (`serverFetch`, `clientFetch`, `ApiRequestError`) and shared types (`ApiErrorBody`, `PaginatedResponse`) come from `packages/ui` via path aliases — no local copies.

- [ ] **Step 1: Install Zod**

```bash
cd apps/web && pnpm add zod@^4
```

- [ ] **Step 2: Create env config**

Create `apps/web/src/lib/env.ts` (app-specific — different apps have different env vars):

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

- [ ] **Step 3: Define app-specific API response types**

Create `apps/web/src/types/api.ts` — these types are specific to `apps/web` auth flows:

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

export function isMfaChallenge(response: LoginResponse): response is MfaChallengeResponse {
  return 'mfaRequired' in response && response.mfaRequired === true;
}
```

Note: `ApiErrorBody` is NOT defined here — it's in `packages/ui/src/types/api.ts` and resolved via the path alias `@/lib/api-client`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): add environment config and app-specific API types"
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

**Note:** This task modifies server files. Both `apps/web` and `apps/admin` (Phase 7d) benefit from these changes — cookie auth only needs to be added once.

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

## Task 5: Root Layout + Fonts

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/globals.css`

Providers component comes from `packages/ui` via path alias (`@/components/providers`). No local copy needed.

- [ ] **Step 1: Install distinctive fonts**

```bash
cd apps/web && pnpm add @fontsource-variable/outfit @fontsource-variable/plus-jakarta-sans
```

- [ ] **Step 2: Create root layout**

Update `apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Identity Starter',
  description: 'Identity and access management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
```

Update `apps/web/src/app/globals.css` — add font imports at the top:

```css
@import '@fontsource-variable/outfit';
@import '@fontsource-variable/plus-jakarta-sans';
```

Add to the CSS variables / theme section:

```css
:root {
  --font-sans: 'Plus Jakarta Sans Variable', system-ui, sans-serif;
  --font-display: 'Outfit Variable', system-ui, sans-serif;
}
```

- [ ] **Step 3: Verify build**

```bash
cd apps/web && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): add distinctive fonts and root layout"
```

---

## Task 6: Auth Middleware

**Files:**
- Create: `apps/web/src/middleware.ts`

- [ ] **Step 1: Create auth middleware**

Create `apps/web/src/middleware.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get('session');

  // Auth pages: redirect to /account if already logged in
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    if (session) {
      return NextResponse.redirect(new URL('/account', request.url));
    }
    return NextResponse.next();
  }

  // Protected pages: redirect to /login if not logged in
  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except Next.js internals, static files, and API/OAuth routes
    '/((?!_next|api|oauth|.well-known|favicon.ico|.*\\.).*)',
  ],
};
```

The matcher excludes `/oauth` paths — the OAuth consent page handles its own auth (Plan 7c).

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(web): add auth middleware for route protection"
```

---

## ~~Task 7: Shared Components~~ — REMOVED

All shared components (PasswordInput, LoadingButton, ApiErrorAlert) are in `packages/ui` (Phase 7-pre). They're available via tsconfig path aliases — imports like `@/components/shared/loading-button` resolve to `packages/ui/src/components/shared/loading-button.tsx` automatically.

---

## Task 8: Auth Layout

**Files:**
- Create: `apps/web/src/app/(auth)/layout.tsx`

- [ ] **Step 1: Create centered auth card layout**

Create `apps/web/src/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
```

The auth layout is intentionally minimal — a centered column with a soft muted background. Each auth page provides its own `<Card>` wrapper with appropriate titles.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(web): add centered auth layout"
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
import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { PasswordInput } from '@/components/shared/password-input';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch } from '@/lib/api-client';
import { isMfaChallenge, type LoginResponse } from '@/types/api';

const loginSchema = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/account';

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: LoginValues) =>
      clientFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: (data) => {
      if (isMfaChallenge(data)) {
        router.push(`/mfa?token=${data.mfaToken}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        {mutation.error ? <ApiErrorAlert error={mutation.error} /> : null}

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="username webauthn" {...field} />
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
                <PasswordInput autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" className="w-full" loading={mutation.isPending}>
          Sign in
        </LoadingButton>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Create login page**

Create `apps/web/src/app/(auth)/login/page.tsx`:

```tsx
import Link from 'next/link';
import { Suspense } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-2xl">Welcome back</CardTitle>
        <CardDescription>Sign in to your account</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 text-center text-sm text-muted-foreground">
        <Link href="/forgot-password" className="hover:text-primary hover:underline">
          Forgot your password?
        </Link>
        <p>
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-primary hover:underline">
            Create one
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): add login page with MFA redirect support"
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
import { PasswordInput } from '@/components/shared/password-input';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch } from '@/lib/api-client';
import type { AuthResponse } from '@/types/api';

const registerSchema = z.object({
  displayName: z.string().min(1, 'Name is required').max(255),
  email: z.email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: RegisterValues) =>
      clientFetch<AuthResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      router.push('/verify-email');
      router.refresh();
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        {mutation.error ? <ApiErrorAlert error={mutation.error} /> : null}

        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input autoComplete="name" {...field} />
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
                <Input type="email" autoComplete="email" {...field} />
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
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" className="w-full" loading={mutation.isPending}>
          Create account
        </LoadingButton>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Create register page**

Create `apps/web/src/app/(auth)/register/page.tsx`:

```tsx
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { RegisterForm } from '@/components/auth/register-form';

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-2xl">Create your account</CardTitle>
        <CardDescription>Get started with Identity Starter</CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm />
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="ml-1 text-primary hover:underline">
          Sign in
        </Link>
      </CardFooter>
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
import { useMutation } from '@tanstack/react-query';
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
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch } from '@/lib/api-client';
import type { MfaVerifyResponse } from '@/types/api';

const totpSchema = z.object({
  otp: z.string().length(6, 'Enter the 6-digit code'),
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
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');

  const totpForm = useForm<TotpValues>({
    resolver: zodResolver(totpSchema),
    defaultValues: { otp: '' },
  });

  const recoveryForm = useForm<RecoveryValues>({
    resolver: zodResolver(recoverySchema),
    defaultValues: { recoveryCode: '' },
  });

  const totpMutation = useMutation({
    mutationFn: (values: TotpValues) =>
      clientFetch<MfaVerifyResponse>('/api/auth/mfa/totp/verify', {
        method: 'POST',
        body: JSON.stringify({ ...values, mfaToken }),
      }),
    onSuccess: () => {
      router.push(callbackUrl);
      router.refresh();
    },
  });

  const recoveryMutation = useMutation({
    mutationFn: (values: RecoveryValues) =>
      clientFetch<MfaVerifyResponse>('/api/auth/mfa/recovery/verify', {
        method: 'POST',
        body: JSON.stringify({ ...values, mfaToken }),
      }),
    onSuccess: () => {
      router.push(callbackUrl);
      router.refresh();
    },
  });

  if (mode === 'recovery') {
    return (
      <Form {...recoveryForm}>
        <form onSubmit={recoveryForm.handleSubmit((v) => recoveryMutation.mutate(v))} className="space-y-4">
          {recoveryMutation.error ? <ApiErrorAlert error={recoveryMutation.error} /> : null}

          <FormField
            control={recoveryForm.control}
            name="recoveryCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Recovery code</FormLabel>
                <FormControl>
                  <Input placeholder="xxxx-xxxx-xxxx" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <LoadingButton type="submit" className="w-full" loading={recoveryMutation.isPending}>
            Verify recovery code
          </LoadingButton>

          <Button type="button" variant="link" className="w-full" onClick={() => setMode('totp')}>
            Use authenticator app instead
          </Button>
        </form>
      </Form>
    );
  }

  return (
    <Form {...totpForm}>
      <form onSubmit={totpForm.handleSubmit((v) => totpMutation.mutate(v))} className="space-y-4">
        {totpMutation.error ? <ApiErrorAlert error={totpMutation.error} /> : null}

        <FormField
          control={totpForm.control}
          name="otp"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Authentication code</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" className="w-full" loading={totpMutation.isPending}>
          Verify
        </LoadingButton>

        <Button type="button" variant="link" className="w-full" onClick={() => setMode('recovery')}>
          Use a recovery code
        </Button>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Create MFA page**

Create `apps/web/src/app/(auth)/mfa/page.tsx`:

```tsx
import { Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MfaForm } from '@/components/auth/mfa-form';

export default function MfaPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-2xl">Two-factor authentication</CardTitle>
        <CardDescription>Enter the code from your authenticator app</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={null}>
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { VerifyEmailActions } from './actions';

interface VerifyEmailPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  const token = params.token;

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-2xl">Verify your email</CardTitle>
        <CardDescription>
          {token
            ? 'Verifying your email address...'
            : 'Check your inbox for a verification link'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VerifyEmailActions token={token} />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create verify email actions component**

Create `apps/web/src/app/(auth)/verify-email/actions.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface VerifyEmailActionsProps {
  token?: string;
}

export function VerifyEmailActions({ token }: VerifyEmailActionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>(
    token ? 'verifying' : 'idle',
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token) return;
    clientFetch('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then(() => {
        setStatus('success');
        setTimeout(() => {
          router.push('/account');
          router.refresh();
        }, 2000);
      })
      .catch((err) => {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Verification failed');
      });
  }, [token, router]);

  async function handleResend() {
    setResending(true);
    try {
      await clientFetch('/api/auth/resend-verification', { method: 'POST' });
      toast.success('Verification email sent');
    } catch {
      toast.error('Failed to resend verification email');
    } finally {
      setResending(false);
    }
  }

  if (status === 'verifying') {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === 'success') {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>Email verified! Redirecting...</AlertDescription>
      </Alert>
    );
  }

  if (status === 'error') {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
        <Button onClick={handleResend} disabled={resending} className="w-full">
          {resending ? 'Sending...' : 'Resend verification email'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <p className="text-sm text-muted-foreground">
        Didn&apos;t receive an email?
      </p>
      <Button onClick={handleResend} disabled={resending} variant="outline" className="w-full">
        {resending ? 'Sending...' : 'Resend verification email'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): add email verification page with auto-verify and resend"
```

---

## Task 13: Forgot Password + Reset Password Pages

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
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/shared/loading-button';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { clientFetch } from '@/lib/api-client';
import { CheckCircle2 } from 'lucide-react';

const forgotPasswordSchema = z.object({
  email: z.email('Enter a valid email'),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: ForgotPasswordValues) =>
      clientFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: () => setSent(true),
  });

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle2 className="h-8 w-8 text-green-600" />
        <p className="text-sm text-muted-foreground">
          If an account exists with that email, we sent a password reset link.
        </p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        {mutation.error ? <ApiErrorAlert error={mutation.error} /> : null}

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" className="w-full" loading={mutation.isPending}>
          Send reset link
        </LoadingButton>
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
import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
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

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: ResetPasswordValues) =>
      clientFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password: values.password }),
      }),
    onSuccess: () => {
      toast.success('Password reset! You can now sign in.');
      router.push('/login');
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        {mutation.error ? <ApiErrorAlert error={mutation.error} /> : null}

        <FormField
          control={form.control}
          name="password"
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
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" className="w-full" loading={mutation.isPending}>
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
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-2xl">Reset your password</CardTitle>
        <CardDescription>Enter your email and we&apos;ll send a reset link</CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm />
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 4: Create reset password page**

Create `apps/web/src/app/(auth)/reset-password/page.tsx`:

```tsx
import { Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-2xl">Set new password</CardTitle>
        <CardDescription>Choose a strong password for your account</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={null}>
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

- [ ] **Step 1: Create passkey autofill component**

This component is loaded dynamically (best practice: `bundle-dynamic-imports`) because `@simplewebauthn/browser` is only needed on the login page.

Create `apps/web/src/components/auth/passkey-autofill.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
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

    async function startConditionalUI() {
      const { browserSupportsWebAuthnAutofill, startAuthentication } = await import(
        '@simplewebauthn/browser'
      );

      const supported = await browserSupportsWebAuthnAutofill();
      if (!supported || cancelled) return;

      try {
        const options = await clientFetch<{ publicKey: PublicKeyCredentialRequestOptions }>(
          '/api/auth/passkeys/login/options',
          { method: 'POST' },
        );

        abortRef.current = new AbortController();

        const credential = await startAuthentication({
          optionsJSON: options.publicKey as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'],
          useBrowserAutofill: true,
        });

        if (cancelled) return;

        await clientFetch<AuthResponse>('/api/auth/passkeys/login/verify', {
          method: 'POST',
          body: JSON.stringify(credential),
        });

        router.push(callbackUrl);
        router.refresh();
      } catch {
        // User cancelled or browser doesn't support — fail silently
      }
    }

    startConditionalUI();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [callbackUrl, router]);

  return null;
}
```

- [ ] **Step 2: Install @simplewebauthn/browser**

```bash
cd apps/web && pnpm add @simplewebauthn/browser
```

- [ ] **Step 3: Add passkey autofill to login page**

In `apps/web/src/app/(auth)/login/page.tsx`, add inside `<CardContent>` before `<LoginForm>`:

```tsx
import dynamic from 'next/dynamic';

const PasskeyAutofill = dynamic(
  () => import('@/components/auth/passkey-autofill').then((m) => ({ default: m.PasskeyAutofill })),
  { ssr: false },
);
```

```tsx
<CardContent>
  <PasskeyAutofill callbackUrl="/account" />
  <Suspense fallback={null}>
    <LoginForm />
  </Suspense>
</CardContent>
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): add passkey conditional UI with dynamic import"
```

---

## Task 15: Playwright E2E Setup + Auth Tests

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/auth.spec.ts`

- [ ] **Step 1: Install Playwright**

```bash
cd apps/web && pnpm add -D @playwright/test
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
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 3: Add e2e script to package.json**

In `apps/web/package.json`, add:

```json
"e2e": "playwright test"
```

- [ ] **Step 4: Write auth E2E tests**

Create `apps/web/e2e/auth.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';

test.describe('Authentication', () => {
  const testEmail = `e2e-${Date.now()}@test.example`;

  test('registers a new user', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText(/create your account/i)).toBeVisible();
    await page.getByLabel(/name/i).fill('E2E User');
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill('TestPassword123!');
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/(account|verify-email)/);
  });

  test('logs in with existing user', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText(/welcome back/i)).toBeVisible();
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill('TestPassword123!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/account/);
  });

  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows forgot password page', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByText(/reset your password/i)).toBeVisible();
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(web): add Playwright E2E setup and auth flow tests"
```

---

## Task 16: Build Verification + Final Lint

- [ ] **Step 1: Run full build**

```bash
pnpm turbo build
```

- [ ] **Step 2: Run Biome lint**

```bash
pnpm biome check apps/web/
```

Fix any issues found.

- [ ] **Step 3: Run E2E tests (requires server running)**

```bash
cd apps/web && pnpm e2e
```

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "chore(web): fix lint issues and verify build"
```

---

## Task Dependency Graph

```
Phase 7-pre (packages/ui) must be complete before starting.

Task 1 (scaffold) ─┬─ Task 2 (shared pkg config) ─┬─ Task 8 (auth layout) ─┬─ Task 9 (login) ─── Task 14 (passkey)
                    │                               │                         ├─ Task 10 (register)
                    ├─ Task 3 (env/types) ──────────┘                         ├─ Task 11 (MFA)
                    │                                                         ├─ Task 12 (verify email)
                    └─ Task 4 (server cookies) ─── independent                └─ Task 13 (forgot/reset pw)

Task 5 (root layout) ─── depends on Task 2
Task 6 (middleware) ─── depends on Task 1

Task 15 (Playwright) ─── depends on auth pages
Task 16 (build verify) ─── depends on all above

Note: Task 7 (shared components) removed — now in packages/ui (Phase 7-pre)
```
