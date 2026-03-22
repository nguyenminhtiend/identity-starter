# Phase 7: Frontend — Plan Overview

**Goal:** Build the Next.js 15 web UI for the identity-starter project. Consumes the REST API built in Phases 2-6.

**Decisions:**
- Hybrid data strategy: Server Components for reads, TanStack Query for interactive mutations
- Custom auth middleware (no next-auth) — we ARE the identity provider
- React Hook Form + Zod 4 for form validation
- Playwright E2E tests (component-level RTL deferred)
- Split into 4 independently-shippable sub-plans

---

## Sub-Plans

| Plan | Domain | API Dependency | Detailed Plan | Tasks |
|------|--------|---------------|---------------|-------|
| **7a** | Foundation + Auth Flows | Phases 2-3 (done) | `2026-03-22-phase-7a-frontend-foundation-auth.md` | 16 |
| **7b** | Account Self-Service | Phase 4 (done) | `2026-03-22-phase-7b-frontend-account.md` | 7 |
| **7c** | OAuth2 Consent | Phase 5 (in progress) | `2026-03-22-phase-7c-frontend-oauth-consent.md` | 3 |
| **7d** | Admin Dashboard | Phase 6 (in progress) | `2026-03-22-phase-7d-frontend-admin.md` | 9 |

---

All sub-plans are fully detailed in their respective files. See the table above for links.

**Execution order:** 7a → 7b → 7c (can overlap with 7b) → 7d (requires 7b dashboard layout)

**Total tasks across all plans:** 35
