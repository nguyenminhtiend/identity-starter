# Phase 7: Frontend — Plan Overview

**Goal:** Build the Next.js 15 web UIs for the identity-starter project. Two separate apps — one for end users, one for admins — following industry-standard separation of concerns.

**Key Architecture Decision: Two Separate Apps**

| App | Path | Purpose | Port |
|-----|------|---------|------|
| `apps/web` | End-user facing | Auth flows, account self-service, OAuth consent | 3000 |
| `apps/admin` | Admin dashboard | User/role/session management, audit logs | 3002 |

**Why separate apps (industry standard):**
- **Security isolation** — admin app can enforce stricter auth (always require MFA, IP allowlisting)
- **Independent deployments** — ship admin fixes without touching the user-facing app
- **Bundle optimization** — admin doesn't ship WebAuthn browser lib; user app doesn't ship data table code
- **Different caching/CDN strategies** — admin can be internal-only, user app on public CDN
- **Access control** — admin app is not even reachable by non-admin users at the network level

**Shared Code: `packages/ui`**
- Both apps share a **single `packages/ui` workspace package** containing shadcn components, API client, utility functions, and shared custom components
- Apps use **tsconfig path aliases** so `@/components/ui/*` resolves to the shared package — zero import changes needed in component code
- See `2026-03-22-phase-7-pre-shared-ui-package.md` for details

**Shared Decisions:**
- Hybrid data strategy: Server Components for reads, TanStack Query for interactive mutations
- Custom auth middleware (no next-auth) — we ARE the identity provider
- React Hook Form + Zod 4 for form validation
- Playwright E2E tests (component-level RTL deferred)
- Both apps share the same Fastify backend via API rewrites

**Design Philosophy (per frontend-design skill):**
- Each app has a **distinct, intentional aesthetic** — not generic shadcn defaults
- `apps/web`: Refined, trustworthy, modern — think Clerk/Linear auth pages with distinctive typography
- `apps/admin`: Professional, data-dense, efficient — think Vercel dashboard meets Linear

**Vercel React Best Practices Applied:**
- Server Components for data fetching (eliminate waterfalls with `async-parallel`)
- `bundle-dynamic-imports` for heavy components (QR code, WebAuthn, data tables)
- `server-serialization` — minimize data passed from Server to Client Components
- `rerender-no-inline-components` — no components defined inside other components
- `rendering-conditional-render` — ternary over `&&` for conditional JSX

---

## Sub-Plans

| Plan | Domain | App | API Dependency | Detailed Plan | Tasks |
|------|--------|-----|---------------|---------------|-------|
| **7-pre** | Shared UI Package | `packages/ui` | None | `2026-03-22-phase-7-pre-shared-ui-package.md` | 5 |
| **7a** | Foundation + Auth Flows | `apps/web` | Phases 2-3 (done) | `2026-03-22-phase-7a-frontend-foundation-auth.md` | 15 |
| **7b** | Account Self-Service | `apps/web` | Phase 4 (done) | `2026-03-22-phase-7b-frontend-account.md` | 6 |
| **7c** | OAuth2 Consent | `apps/web` | Phase 5 (done) | `2026-03-22-phase-7c-frontend-oauth-consent.md` | 3 |
| **7d** | Admin Dashboard | `apps/admin` | Phase 6 (done) | `2026-03-22-phase-7d-frontend-admin.md` | 12 |

---

**Execution order:** 7-pre → 7a → 7b → 7c (can overlap with 7b) → 7d (independent — separate app, can start after 7-pre + 7a server cookie changes)

**Total tasks across all plans:** 41
