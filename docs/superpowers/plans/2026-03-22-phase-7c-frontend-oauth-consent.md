# Phase 7c: Frontend OAuth2 Consent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OAuth2 authorization consent page where users approve or deny third-party client access.

**Architecture:** The OAuth `/authorize` endpoint requires a session. If user is logged in and hasn't consented, the server returns a `consent_required` response with client info and requested scopes. The frontend renders a consent UI. On approve/deny, it POSTs to `/oauth/consent` and the server redirects to the client's `redirect_uri`.

**Tech Stack:** Next.js 15, React 19, shadcn/ui

**Prerequisite:** Plan 7a complete. Phase 5a OAuth API available.
**Phase doc:** `docs/phase-7-frontend.md`

---

## File Map

- Create: `apps/web/src/app/oauth/authorize/page.tsx`
- Create: `apps/web/src/components/oauth/consent-form.tsx`
- Create: `apps/web/src/components/oauth/scope-descriptions.ts`
- Create: `apps/web/src/types/oauth.ts`
- Create: `apps/web/e2e/consent.spec.ts`

---

## API Reference

The OAuth authorize flow is a two-step process:

**Step 1: `GET /oauth/authorize?...`** (query params: `response_type`, `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method`, `nonce`)

Returns either:
- **302 redirect** — consent already granted, auth code issued, redirects to `redirect_uri`
- **200 JSON** — consent required:

```json
{
  "type": "consent_required",
  "client": {
    "clientId": "...",
    "clientName": "...",
    "scope": "...",
    "logoUri": "..." | null,
    "policyUri": "..." | null,
    "tosUri": "..." | null
  },
  "requestedScope": "openid profile email",
  "state": "...",
  "redirectUri": "..."
}
```

**Step 2: `POST /oauth/consent`**

Approve body:
```json
{
  "client_id": "...",
  "scope": "openid profile email",
  "decision": "approve",
  "state": "...",
  "redirect_uri": "...",
  "code_challenge": "...",
  "code_challenge_method": "S256",
  "nonce": "..."
}
```

Deny body:
```json
{
  "client_id": "...",
  "scope": "...",
  "decision": "deny",
  "state": "...",
  "redirect_uri": "..."
}
```

Both return **302 redirect** to the client's `redirect_uri`.

---

## Task 1: OAuth Types + Scope Descriptions

**Files:**
- Create: `apps/web/src/types/oauth.ts`
- Create: `apps/web/src/components/oauth/scope-descriptions.ts`

- [ ] **Step 1: Define OAuth types**

Create `apps/web/src/types/oauth.ts`:

```typescript
export interface ConsentClient {
  clientId: string;
  clientName: string;
  scope: string;
  logoUri: string | null;
  policyUri: string | null;
  tosUri: string | null;
}

export interface ConsentRequired {
  type: 'consent_required';
  client: ConsentClient;
  requestedScope: string;
  state: string;
  redirectUri: string;
}
```

- [ ] **Step 2: Create scope descriptions**

Create `apps/web/src/components/oauth/scope-descriptions.ts`:

```typescript
interface ScopeInfo {
  label: string;
  description: string;
}

const SCOPE_MAP: Record<string, ScopeInfo> = {
  openid: {
    label: 'OpenID',
    description: 'Verify your identity',
  },
  profile: {
    label: 'Profile',
    description: 'Access your name and profile information',
  },
  email: {
    label: 'Email',
    description: 'Access your email address',
  },
  offline_access: {
    label: 'Offline access',
    description: 'Access your data when you are not present',
  },
};

export function getScopeDescriptions(scopeString: string): ScopeInfo[] {
  return scopeString
    .split(' ')
    .filter(Boolean)
    .map((scope) => SCOPE_MAP[scope] ?? { label: scope, description: `Access to ${scope}` });
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): add OAuth consent types and scope descriptions"
```

---

## Task 2: Consent Page

**Files:**
- Create: `apps/web/src/components/oauth/consent-form.tsx`
- Create: `apps/web/src/app/oauth/authorize/page.tsx`

- [ ] **Step 1: Create consent form component**

Create `apps/web/src/components/oauth/consent-form.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { LoadingButton } from '@/components/shared/loading-button';
import { getScopeDescriptions } from './scope-descriptions';
import type { ConsentRequired } from '@/types/oauth';
import { CheckCircle2, ExternalLink, Shield } from 'lucide-react';

interface ConsentFormProps {
  data: ConsentRequired;
  authorizeParams: Record<string, string>;
}

export function ConsentForm({ data, authorizeParams }: ConsentFormProps) {
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null);
  const scopes = getScopeDescriptions(data.requestedScope);

  async function handleDecision(decision: 'approve' | 'deny') {
    setSubmitting(decision);

    const body: Record<string, string> = {
      client_id: data.client.clientId,
      scope: data.requestedScope,
      decision,
      state: data.state,
      redirect_uri: data.redirectUri,
    };

    if (decision === 'approve') {
      if (authorizeParams.code_challenge) {
        body.code_challenge = authorizeParams.code_challenge;
      }
      if (authorizeParams.code_challenge_method) {
        body.code_challenge_method = authorizeParams.code_challenge_method;
      }
      if (authorizeParams.nonce) {
        body.nonce = authorizeParams.nonce;
      }
    }

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/oauth/consent';
    for (const [key, value] of Object.entries(body)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {data.client.logoUri && (
            <img
              src={data.client.logoUri}
              alt={data.client.clientName}
              className="mx-auto mb-4 h-16 w-16 rounded-lg"
            />
          )}
          <CardTitle className="text-xl">
            {data.client.clientName} wants to access your account
          </CardTitle>
          <CardDescription>
            This application is requesting the following permissions
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-3">
            {scopes.map((scope) => (
              <div key={scope.label} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
                <div>
                  <p className="text-sm font-medium">{scope.label}</p>
                  <p className="text-xs text-muted-foreground">{scope.description}</p>
                </div>
              </div>
            ))}
          </div>

          <Separator />

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield className="h-3 w-3" />
            <span>
              This will not share your password.{' '}
              {data.client.policyUri && (
                <a
                  href={data.client.policyUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Privacy policy <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {data.client.tosUri && (
                <>
                  {data.client.policyUri && ' · '}
                  <a
                    href={data.client.tosUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Terms of service <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </span>
          </div>
        </CardContent>

        <CardFooter className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            disabled={submitting !== null}
            onClick={() => handleDecision('deny')}
          >
            {submitting === 'deny' ? 'Denying...' : 'Deny'}
          </Button>
          <LoadingButton
            className="flex-1"
            loading={submitting === 'approve'}
            disabled={submitting !== null}
            onClick={() => handleDecision('approve')}
          >
            Allow
          </LoadingButton>
        </CardFooter>
      </Card>
    </div>
  );
}
```

The consent form uses a native HTML form POST (not fetch) because the server responds with a 302 redirect that the browser must follow. `fetch` would swallow the redirect.

- [ ] **Step 2: Create authorize page**

Create `apps/web/src/app/oauth/authorize/page.tsx`:

This page is **not** inside the `(auth)` or `(dashboard)` route groups because it has its own layout (no sidebar, no auth card).

**Auth strategy:** Keep `/oauth` excluded from the middleware matcher (so the consent form POST to `/oauth/consent` goes straight to the API rewrite). Instead, check for the session cookie directly in the page and redirect to login with `callbackUrl` if missing.

**Redirect handling:** The server's `/oauth/authorize` returns 302 when consent is already granted. `serverFetch` follows redirects by default which is wrong here. Use a dedicated `fetchConsentData` helper with `redirect: 'manual'` that extends `serverFetch`'s cookie-forwarding pattern.

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ConsentForm } from '@/components/oauth/consent-form';
import type { ConsentRequired } from '@/types/oauth';

interface AuthorizePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function fetchConsentData(queryString: string): Promise<ConsentRequired> {
  const cookieStore = await cookies();
  const session = cookieStore.get('session');
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

  const response = await fetch(`${apiUrl}/oauth/authorize?${queryString}`, {
    headers: session ? { Authorization: `Bearer ${session.value}` } : {},
    redirect: 'manual',
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) {
      redirect(location);
    }
    throw new Error('Redirect with no location');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? 'Authorization failed');
  }

  return response.json();
}

export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
  const rawParams = await searchParams;
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === 'string') {
      params[key] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      params[key] = value[0];
    }
  }
  const queryString = new URLSearchParams(params).toString();

  const cookieStore = await cookies();
  if (!cookieStore.get('session')) {
    const callbackUrl = `/oauth/authorize?${queryString}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  let response: ConsentRequired;
  try {
    response = await fetchConsentData(queryString);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authorization failed';
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-destructive">{message}</p>
      </div>
    );
  }

  if (response.type !== 'consent_required') {
    redirect('/account');
  }

  return <ConsentForm data={response} authorizeParams={params} />;
}
```

- [ ] **Step 3: Middleware — no changes needed**

The Plan 7a middleware matcher excludes `/oauth` paths. **Keep it as-is.** This is intentional:
- `/oauth/authorize` page handles its own auth (session cookie check + redirect above)
- `/oauth/consent` POST goes straight through the Next.js rewrite to the API server (no middleware interception)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): add OAuth consent page with scope descriptions"
```

---

## Task 3: Playwright E2E — Consent Flow

**Files:**
- Create: `apps/web/e2e/consent.spec.ts`

- [ ] **Step 1: Write consent E2E test**

Create `apps/web/e2e/consent.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';

// This test requires an OAuth client to be registered in the database.
// In a CI environment, you'd seed this via the admin API or directly in the DB.
// For local testing, create a client first via the admin API.

test.describe('OAuth Consent Flow', () => {
  test.skip(
    !process.env.TEST_OAUTH_CLIENT_ID,
    'Requires TEST_OAUTH_CLIENT_ID env var',
  );

  const clientId = process.env.TEST_OAUTH_CLIENT_ID ?? '';
  const redirectUri = process.env.TEST_OAUTH_REDIRECT_URI ?? 'http://localhost:4000/callback';

  test('shows consent page for new authorization', async ({ page }) => {
    // Register + login
    const email = `e2e-consent-${Date.now()}@test.example`;
    await page.goto('/register');
    await page.getByLabel(/name/i).fill('Consent User');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill('TestPassword123!');
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/(account|verify-email)/);

    // Navigate to authorize
    const authUrl = `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid+profile+email&state=test-state&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256`;
    await page.goto(authUrl);

    // Should show consent page
    await expect(page.getByText(/wants to access/i)).toBeVisible();
    await expect(page.getByText(/profile/i)).toBeVisible();
    await expect(page.getByText(/email/i)).toBeVisible();

    // Deny should redirect
    await page.getByRole('button', { name: /deny/i }).click();
    await expect(page).toHaveURL(new RegExp(redirectUri));
  });
});
```

- [ ] **Step 2: Run E2E**

```bash
cd apps/web && pnpm e2e
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(web): add OAuth consent flow E2E test"
```

---

## Task Dependency Graph

```
Task 1 (types + scopes) ── Task 2 (consent page) ── Task 3 (Playwright E2E)
```

Strictly sequential — small plan, 3 tasks.
