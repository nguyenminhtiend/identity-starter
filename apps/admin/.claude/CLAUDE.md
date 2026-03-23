# Admin Dashboard

Next.js 16 admin panel for managing users, roles, sessions, and audit logs. Runs on port 3002.

## Commands

```bash
pnpm --filter admin dev         # Start dev server (port 3002, Turbopack)
pnpm --filter admin build       # Production build
pnpm --filter admin e2e         # Playwright end-to-end tests
```

## Directory Structure

```
src/
├── app/
│   ├── (dashboard)/            # Protected routes (users, roles, sessions, audit-logs)
│   │   ├── users/              # User management (list + [id] detail)
│   │   ├── roles/              # Role management
│   │   ├── sessions/           # Session management
│   │   └── audit-logs/         # Audit log viewing and export
│   └── login/                  # Auth entry point
├── components/                 # Feature-organized: users/, roles/, sessions/, audit/, layout/
├── lib/                        # env.ts (Zod-validated env vars)
├── types/                      # admin.ts (entity interfaces)
└── middleware.ts               # Session-based route protection
```

## Key Patterns

- **Server Components for data fetching** — pages use `serverFetch()` with async/await
- **URL-based filter state** — filters persist in query params (`?page=2&status=active&email=test`)
- **Debounced search** — 300ms debounce on search inputs using `useRef` + `setTimeout`
- **Suspense boundaries** — filters and pagination wrapped in `<Suspense>`
- **Server-side pagination** — `limit` and `page` params; client navigates via URL updates

## Auth & Middleware

- Middleware checks `session` cookie; redirects unauthenticated users to `/login`
- Authenticated users on `/login` are redirected to `/users`
- `(dashboard)/layout.tsx` fetches user profile and verifies admin role

## Conventions

- Components import from `@/components/...` (path alias)
- Types exported from `/types/admin.ts`
- Toast notifications via `sonner`
- Forms use `react-hook-form` + `@hookform/resolvers` + Zod
- Mutations use `@tanstack/react-query` `useMutation()`
- API errors displayed via `ApiErrorAlert` from `@identity-starter/ui`

## Dependencies

`@identity-starter/ui` (shared components), `@tanstack/react-query`, `react-hook-form`, `zod`, `lucide-react`, `sonner`, Tailwind v4
