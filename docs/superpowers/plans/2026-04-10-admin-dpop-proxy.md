# Admin DPoP Proxy — Fix Client-Side Mutations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all client-side admin API calls through a Next.js catch-all route handler that adds DPoP proof and `Authorization: DPoP` headers, fixing the broken client mutations.

**Architecture:** Currently, client components call `clientFetch('/api/admin/...')` which hits a Next.js rewrite proxy that forwards requests to the backend with no auth headers — the backend rejects them because DPoP-bound tokens require `Authorization: DPoP` + `DPoP` proof headers. The fix creates a catch-all route handler at `app/api/admin/[...path]/route.ts` that intercepts these requests, reads the encrypted session cookie, creates a fresh DPoP proof, and proxies to the backend with proper headers. Client components need zero changes — they keep calling the same paths.

**Tech Stack:** Next.js 16 route handlers, jose (DPoP proof), node:crypto (token decryption)

---

## Current Problem

```
Browser (clientFetch)
  → GET/POST/PATCH/DELETE /api/admin/...
  → Next.js rewrite proxy (next.config.ts)
  → Backend (localhost:3001)
  → Backend auth.ts: no Authorization header, no DPoP proof
  → 401 Unauthorized
```

## Target Architecture

```
Browser (clientFetch)
  → GET/POST/PATCH/DELETE /api/admin/...
  → Next.js route handler (app/api/admin/[...path]/route.ts)
  → Reads admin_session cookie, decrypts tokens
  → Creates DPoP proof for target URL
  → Proxies to backend with Authorization: DPoP + DPoP headers
  → Returns backend response to browser
```

## Affected Client Calls (6 total)

| Component | Method | Path | Purpose |
|---|---|---|---|
| `user-detail.tsx:32` | PATCH | `/api/admin/users/{id}/status` | Suspend/activate user |
| `user-detail.tsx:44` | POST | `/api/admin/users/{id}/roles` | Assign role |
| `user-detail.tsx:57` | DELETE | `/api/admin/users/{id}/roles/{roleId}` | Remove role |
| `session-table.tsx:28` | DELETE | `/api/admin/sessions/{id}` | Revoke session |
| `create-role-dialog.tsx:52` | POST | `/api/admin/roles` | Create role |
| `audit-log-filters.tsx:51` | GET | `/api/admin/audit-logs/export?...` | Export audit logs (blob) |

## File Plan

| Action | File | Responsibility |
|---|---|---|
| Modify | `apps/admin/src/lib/api-client.server.ts` | Export `getCredentials` + `ResolvedCredentials` |
| Create | `apps/admin/src/app/api/admin/[...path]/route.ts` | Catch-all DPoP proxy route handler |
| Modify | `apps/admin/next.config.ts` | Remove the `/api/:path*` rewrite |
| Modify | `apps/admin/src/middleware.ts` | Exclude `/api/` from redirect-to-login (return 401 instead) |

---

### Task 1: Export `getCredentials` from `api-client.server.ts`

**Files:**
- Modify: `apps/admin/src/lib/api-client.server.ts:9-47`

The `getCredentials()` function and `ResolvedCredentials` interface are currently unexported. The new route handler needs them.

- [ ] **Step 1: Add `export` to `ResolvedCredentials` and `getCredentials`**

In `apps/admin/src/lib/api-client.server.ts`, change:

```typescript
// Line 9: add export
export interface ResolvedCredentials {
  accessToken: string;
  dpopKeyPair: DPoPKeyPairJwk;
}

// Line 14: add export
export async function getCredentials(): Promise<ResolvedCredentials | null> {
```

No other changes — the function body stays exactly the same.

- [ ] **Step 2: Verify the build still works**

Run: `pnpm --filter admin build`
Expected: Build succeeds (adding exports is backwards-compatible)

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/lib/api-client.server.ts
git commit -m "refactor(admin): export getCredentials for reuse in DPoP proxy"
```

---

### Task 2: Update middleware to handle `/api/` paths correctly

**Files:**
- Modify: `apps/admin/src/middleware.ts`

Currently the middleware redirects unauthenticated requests to `/auth/login`. For API route handlers, a redirect is wrong — the client gets HTML instead of a JSON error. The middleware should return a 401 JSON response for `/api/` paths.

- [ ] **Step 1: Update middleware to return 401 for API paths**

Replace the full content of `apps/admin/src/middleware.ts`:

```typescript
import { type NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = 'admin_session';

const PUBLIC_PATHS = new Set(['/auth/login', '/auth/callback']);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (pathname === '/login') {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  const session = request.cookies.get(SESSION_COOKIE_NAME);

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized', statusCode: 401 },
        { status: 401 },
      );
    }
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|.*\\.).*)'],
};
```

- [ ] **Step 2: Verify the build**

Run: `pnpm --filter admin build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/middleware.ts
git commit -m "fix(admin): return 401 JSON for unauthenticated API requests instead of redirect"
```

---

### Task 3: Create the catch-all DPoP proxy route handler

**Files:**
- Create: `apps/admin/src/app/api/admin/[...path]/route.ts`

This is the core fix. The route handler intercepts all `/api/admin/...` requests from client components, resolves credentials from the encrypted session cookie, creates a fresh DPoP proof, and proxies to the backend.

- [ ] **Step 1: Create the route handler**

Create `apps/admin/src/app/api/admin/[...path]/route.ts`:

```typescript
import { type NextRequest, NextResponse } from 'next/server';
import { getCredentials } from '@/lib/api-client.server';
import { createDPoPProof } from '@/lib/dpop';
import { env } from '@/lib/env';

async function proxyWithDPoP(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const creds = await getCredentials();
  if (!creds) {
    return NextResponse.json(
      { error: 'Unauthorized', statusCode: 401 },
      { status: 401 },
    );
  }

  const { path } = await params;
  const backendPath = `/api/admin/${path.join('/')}`;
  const queryString = request.nextUrl.search;
  const fullUrl = `${env.API_URL}${backendPath}${queryString}`;
  const method = request.method;
  const htu = `${env.API_URL}${backendPath}`;

  const dpopProof = await createDPoPProof(creds.dpopKeyPair, method, htu, creds.accessToken);

  const headers: Record<string, string> = {
    Authorization: `DPoP ${creds.accessToken}`,
    DPoP: dpopProof,
  };

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  const body = method !== 'GET' && method !== 'HEAD' ? await request.arrayBuffer() : undefined;

  const backendResponse = await fetch(fullUrl, {
    method,
    headers,
    body,
  });

  const responseHeaders = new Headers();
  const passthroughHeaders = ['content-type', 'content-disposition'];
  for (const name of passthroughHeaders) {
    const value = backendResponse.headers.get(name);
    if (value) {
      responseHeaders.set(name, value);
    }
  }

  const responseBody = await backendResponse.arrayBuffer();

  return new NextResponse(responseBody, {
    status: backendResponse.status,
    headers: responseHeaders,
  });
}

export const GET = proxyWithDPoP;
export const POST = proxyWithDPoP;
export const PUT = proxyWithDPoP;
export const PATCH = proxyWithDPoP;
export const DELETE = proxyWithDPoP;
```

Key design decisions:
- Uses `arrayBuffer()` for both request and response bodies to handle JSON and binary (audit log export blob) uniformly
- Passes through `content-type` and `content-disposition` headers (needed for file downloads)
- Returns 401 JSON instead of redirect when credentials are missing (middleware already handles the cookie check, this is a defense-in-depth fallback)
- All HTTP methods share the same handler — no duplication

- [ ] **Step 2: Verify the build**

Run: `pnpm --filter admin build`
Expected: Build succeeds with the new route handler

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/app/api/admin/\[\...path\]/route.ts
git commit -m "feat(admin): add catch-all DPoP proxy for client-side API mutations"
```

---

### Task 4: Remove the rewrite from `next.config.ts`

**Files:**
- Modify: `apps/admin/next.config.ts`

The rewrite rule `{ source: '/api/:path*', destination: '${apiUrl}/api/:path*' }` is now replaced by the route handler for `/api/admin/...` paths. Remove it entirely — there are no other `/api/` paths that need proxying.

- [ ] **Step 1: Remove the rewrite**

Replace `apps/admin/next.config.ts`:

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@identity-starter/ui'],
};

export default nextConfig;
```

- [ ] **Step 2: Verify the build**

Run: `pnpm --filter admin build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/admin/next.config.ts
git commit -m "fix(admin): remove rewrite proxy that bypassed DPoP authentication"
```

---

### Task 5: Verify the full flow end-to-end

- [ ] **Step 1: Start the dev servers**

Run in separate terminals:
```bash
pnpm --filter server dev     # Backend on :3001
pnpm --filter admin dev      # Admin on :3002
```

- [ ] **Step 2: Test each client mutation**

Log in to the admin dashboard at `http://localhost:3002`. Then test each mutation:

1. **User status** — Go to a user detail page, click Suspend/Activate
2. **Role assignment** — On a user detail page, select and assign a role
3. **Role removal** — On a user detail page, click x on an assigned role
4. **Session revocation** — Go to Sessions, click the trash icon
5. **Role creation** — Go to Roles, click "Create role", fill the form
6. **Audit log export** — Go to Audit logs, click Export

Each should succeed without 401 errors. Check the browser DevTools Network tab:
- Request goes to `/api/admin/...` (the Next.js route handler)
- Response has the correct status code and data
- No rewrite to `localhost:3001` visible in the browser

- [ ] **Step 3: Verify DPoP headers reach the backend**

Check the backend server logs. For each mutation, confirm:
- The request has `Authorization: DPoP <token>` (not Bearer)
- The request has a `DPoP` header with a valid JWT proof
- No "DPoP binding mismatch" errors

- [ ] **Step 4: Run existing E2E tests**

```bash
pnpm --filter admin e2e
```

Expected: All existing tests pass (they should still work since the proxy is transparent)

- [ ] **Step 5: Final commit (if any test fixes needed)**

```bash
git add -A
git commit -m "fix(admin): adjust tests for DPoP proxy changes"
```

---

## Summary of Changes

| File | Change | Why |
|---|---|---|
| `api-client.server.ts` | Export `getCredentials` | Reuse in route handler |
| `middleware.ts` | Return 401 for `/api/` paths | API callers need JSON errors, not HTML redirects |
| `app/api/admin/[...path]/route.ts` | New catch-all proxy | Adds DPoP proof to all client→backend requests |
| `next.config.ts` | Remove rewrite | Rewrite bypassed DPoP; route handler replaces it |

**Zero client component changes required.** The `clientFetch` calls keep their existing paths — the routing layer change is transparent.
