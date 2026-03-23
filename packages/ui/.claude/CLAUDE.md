# UI Package

Shared component library consumed by `apps/admin` and `apps/web`. Radix UI primitives + Tailwind + custom domain-neutral components.

## Directory Structure

```
src/
├── components/
│   ├── ui/                     # Radix primitive wrappers (17 components)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── form.tsx
│   │   ├── input.tsx
│   │   ├── select.tsx
│   │   ├── table.tsx
│   │   ├── tabs.tsx
│   │   └── ...
│   ├── shared/                 # Custom reusable components
│   │   ├── api-error-alert.tsx # Error display for API failures
│   │   ├── loading-button.tsx  # Button with spinner while loading
│   │   ├── pagination.tsx      # Pagination controls
│   │   ├── password-input.tsx  # Password field with show/hide toggle
│   │   └── confirm-dialog.tsx  # Confirmation modal
│   └── providers.tsx           # TanStack Query provider wrapper
├── lib/
│   ├── api-client.ts           # serverFetch() and clientFetch() helpers
│   └── utils.ts                # cn() for class merging (clsx + tailwind-merge)
├── types/
│   └── api.ts                  # ApiErrorBody, PaginatedResponse interfaces
└── index.ts                    # Barrel export
```

## Key Patterns

- **Radix wrapper pattern** — primitive components wrap Radix with Tailwind classes and CVA variants
- **CVA for variants** — `class-variance-authority` for component variant management (size, color, etc.)
- **Server vs client fetch** — two separate fetch functions:
  - `serverFetch()` — reads `session` cookie, sets Bearer token, `cache: 'no-store'`
  - `clientFetch()` — browser sends cookies via `credentials: 'same-origin'`
- **Standard error shape** — all API errors normalized to `ApiErrorBody` with optional `code`, `fields`

## Conventions

- All shared components use `'use client'` directive
- Props extend Radix/React component props with TypeScript spreading
- Consumers import from `@identity-starter/ui` (workspace dependency)

## Dependencies

`radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `react-hook-form`, `zod`, `@tanstack/react-query`, `lucide-react`, `sonner`, `next-themes`
