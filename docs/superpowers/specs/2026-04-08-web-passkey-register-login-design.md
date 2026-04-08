# Web Passkey Register & Login

Date: 2026-04-08
Scope: `apps/web`

## Goal

Enable end users to (1) enroll a passkey from their account page and (2) sign in with a passkey via an explicit button on `/login`, complementing the existing WebAuthn conditional-UI autofill.

## Current State

Server endpoints already exist and are unchanged by this work:

- `POST /api/auth/passkeys/register/options` (session required)
- `POST /api/auth/passkeys/register/verify` (session required)
- `POST /api/auth/passkeys/login/options`
- `POST /api/auth/passkeys/login/verify`

Web today:

- `components/auth/passkey-autofill.tsx` already handles conditional UI on `/login` via `PasskeyAutofillLoader`.
- `/account` shows only `AccountProfile`; no passkey management.
- `login-form.tsx` handles email/password + MFA redirect.

List / delete of enrolled passkeys is out of scope (server endpoints do not exist yet).

## Design

### 1. Passkey enrollment (account page)

New client component `components/account/passkey-manager.tsx`:

- Renders a card titled "Passkeys" with a short description and a "Register a passkey" button.
- On click:
  1. `POST /api/auth/passkeys/register/options` via `clientFetch` → returns `PublicKeyCredentialCreationOptionsJSON`.
  2. Dynamically import `@simplewebauthn/browser` and call `startRegistration({ optionsJSON })`.
  3. `POST /api/auth/passkeys/register/verify` with the credential.
  4. On success → `toast.success('Passkey registered')`.
- Errors:
  - User cancels (`NotAllowedError` / `AbortError`) → silent, no toast.
  - API errors → `ApiErrorAlert` inline (or `toast.error` via structured error).
- Mutation via `@tanstack/react-query` `useMutation`.
- Loading state via `LoadingButton`.

Wire into `app/account/page.tsx` beneath `AccountProfile` in the same centered column.

### 2. Passkey login (explicit button on `/login`)

New client component `components/auth/passkey-login-button.tsx`:

- Renders a full-width secondary button "Sign in with a passkey".
- On click:
  1. `POST /api/auth/passkeys/login/options`.
  2. Dynamically import `@simplewebauthn/browser`, call `startAuthentication({ optionsJSON, useBrowserAutofill: false })`.
  3. `POST /api/auth/passkeys/login/verify` → typed as `AuthResponse` (reuse `LoginResponse` + `isMfaChallenge`).
  4. If MFA challenge → `router.push('/mfa?token=...&callbackUrl=...')`. Otherwise → `router.push(callbackUrl)`.
- Cancellation is silent. API errors shown via `toast.error` (no shared error surface with the password form).
- Reads `callbackUrl` from `useSearchParams` the same way `LoginForm` does.

Rendered inside `LoginForm` after the submit button, separated by a horizontal "or" divider. Kept inside `LoginForm` so it participates in the same layout container; button itself owns its own state.

### Data flow

```
Account page                    Login page
-------------                   -----------
[Register passkey]              [Sign in]  ← email/password
   ↓                            [Sign in with a passkey]
/register/options                  ↓
   ↓                            /login/options
startRegistration()                ↓
   ↓                            startAuthentication()
/register/verify                   ↓
   ↓                            /login/verify
toast success                      ↓
                                MFA? → /mfa
                                else → callbackUrl
```

### Error handling summary

| Condition | Behavior |
|---|---|
| User cancels WebAuthn prompt | Silent (no toast) |
| Browser lacks WebAuthn support | Button still renders; failure surfaces as toast on click |
| API 4xx/5xx | `toast.error` with message from structured error |
| Verify succeeds with MFA challenge | Redirect to `/mfa` |

### Files touched

- `apps/web/src/components/account/passkey-manager.tsx` (new)
- `apps/web/src/components/auth/passkey-login-button.tsx` (new)
- `apps/web/src/app/account/page.tsx` (render `PasskeyManager`)
- `apps/web/src/components/auth/login-form.tsx` (render `PasskeyLoginButton` + divider)

No server changes. No type changes (`AuthResponse` / `LoginResponse` / `isMfaChallenge` already exist in `types/api.ts`).

## Out of Scope

- Listing enrolled passkeys
- Renaming / deleting passkeys
- Passkey-only registration (new account via passkey without password)
- E2E Playwright tests for passkey flows (WebAuthn virtual authenticator requires additional setup; add in a follow-up)
