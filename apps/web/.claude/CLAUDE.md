# Web App

Next.js 16 user-facing authentication app. Handles login, registration, MFA, passkeys, and OAuth consent.

## Commands

```bash
pnpm --filter web dev           # Start dev server (port 3100)
pnpm --filter web build         # Production build
pnpm --filter web e2e           # Playwright end-to-end tests
```

## Directory Structure

```
src/
├── app/
│   ├── (auth)/                 # Public auth routes
│   │   ├── login/
│   │   ├── register/
│   │   ├── forgot-password/
│   │   ├── reset-password/
│   │   ├── verify-email/
│   │   └── mfa/
│   └── oauth/authorize/        # OAuth consent flow
├── components/
│   ├── auth/                   # Login, register, MFA, passkey forms
│   └── oauth/                  # OAuth consent UI
├── lib/                        # env.ts (Zod-validated env vars)
├── types/                      # api.ts (auth responses, MFA discriminator), oauth.ts
└── middleware.ts               # Public path whitelist, session-based redirect
```

## Key Patterns

- **Client-side forms** — `react-hook-form` + Zod resolver with `useMutation()` for submission
- **MFA challenge handling** — discriminated union: `isMfaChallenge()` type guard differentiates MFA challenge from login success
- **Passkey autofill** — `@simplewebauthn/browser` for WebAuthn autofill UI
- **Callback URL** — post-login redirects via `?callbackUrl=/account` query param
- **API error display** — `ApiErrorAlert` component renders structured API errors

## Auth & Middleware

- Public paths defined in array; all other routes require `session` cookie
- Authenticated users on auth pages are redirected away
- Session cookie sent automatically via `credentials: 'same-origin'`

## Conventions

- Same as admin: path aliases (`@/`), `sonner` toasts, `lucide-react` icons
- `clientFetch()` for browser-side API calls
- Loading states via `LoadingButton` with spinner

## Dependencies

`@identity-starter/ui` (shared components), `@simplewebauthn/browser` (passkeys), `@tanstack/react-query`, `react-hook-form`, `zod`, `lucide-react`, `sonner`, Tailwind v4
