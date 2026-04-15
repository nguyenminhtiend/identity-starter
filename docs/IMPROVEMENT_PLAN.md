# Identity-Starter Improvement Plan

Consolidated from security, performance, and code-quality scans across the monorepo (apps/server, apps/admin, apps/web, packages/*). Phased by risk × effort. Each item lists file references and acceptance criteria.

**Generated:** 2026-04-15
**Source skills:** `code-review-and-quality`, `code-simplification`, `security-and-hardening`, `performance-optimization`

---

## Phase 0 — Critical (fix before any production use)

These block safe deployment. Est. ~6h.

| # | Item | Files | Acceptance |
|---|------|-------|-----------|
| 0.1 | **Enforce OAuth `state` min length (CSRF)** | `apps/server/src/modules/oauth/oauth.schemas.ts:8,95` | `z.string().min(16)`; unit test rejecting short state |
| 0.2 | **DPoP replay protection** (store `jti` in Redis) | `apps/server/src/modules/token/dpop.service.ts:94-96` | Duplicate `jti` within window returns 400; integration test |
| 0.3 | **Reject default TOTP encryption key in all envs** | `apps/server/src/core/env.ts:33-37` | Boot fails if `TOTP_ENCRYPTION_KEY === '0'.repeat(64)` |
| 0.4 | **Remove/rotate hardcoded admin OAuth secret** | `apps/admin/.env.example:9`, `apps/server/src/modules/client/client.service.ts:50` | Secret generated on bootstrap; `.env.example` has placeholder only |
| 0.5 | **Audit log PII redaction** | `apps/server/src/modules/audit/audit.service.ts:66` | `details` passes through a redactor; emails/tokens stripped; test covers |
| 0.6 | **Generic login error message (no user enumeration)** | `apps/server/src/modules/auth/auth.service.ts:98-100` | Same message for bad email vs bad password vs suspended; test covers |

---

## Phase 1 — High-impact performance (biggest user-visible wins)

Session/RBAC validation hits DB on every authenticated request. Est. ~8h.

| # | Item | Files | Acceptance |
|---|------|-------|-----------|
| 1.1 | **Cache session validation in Redis** | `apps/server/src/modules/session/session.service.ts:56-76` | Redis hit on warm session; invalidated on logout/revoke; p95 auth latency drops |
| 1.2 | **Cache RBAC permissions per user in Redis** | `apps/server/src/modules/rbac/rbac.service.ts:152-183`, `apps/server/src/core/plugins/rbac.ts:18-28` | Lazy-load on role change event; TTL ≤ 5 min |
| 1.3 | **Collapse `hasPermission` into single JOIN** | `rbac.service.ts:152-183` | 1 query instead of 2 when cache miss |
| 1.4 | **Add missing FK indexes** | `packages/db/src/schema/{session,user-role,role-permission,audit-log,login-attempt}.ts` | Drizzle migration generated; `EXPLAIN` uses index |
| 1.5 | **Paginate admin list endpoints** | `apps/server/src/modules/admin/admin.routes.ts:101-112`, `rbac.service.ts:56-72` | Default 50, max 200; total count returned |
| 1.6 | **Bound audit chain verify** | `apps/server/src/modules/audit/audit.service.ts:105-168` | Incremental verification (resume from cached checkpoint) or moved to background job |
| 1.7 | **Tune Postgres pool** | `packages/db/src/client.ts:6` | `max: 20, idle_timeout: 30` |

---

## Phase 2 — High-impact security hardening

Est. ~4h.

| # | Item | Files | Acceptance |
|---|------|-------|-----------|
| 2.1 | **Reduce refresh-token grace window to 5s** | `apps/server/src/core/env.ts:27` | Default `REFRESH_GRACE_PERIOD_SECONDS=5`; doc rationale |
| 2.2 | **Per-user throttle on email verification attempts** | `apps/server/src/modules/auth/auth.routes.ts:85-97` | Additional lockout counter; failed attempts audited |
| 2.3 | **Explicit CSP + `frame-ancestors 'none'`** | `apps/server/src/app.ts:40` | Helmet CSP configured; verified via response headers |
| 2.4 | **Verify CORS preflight for DPoP header** | `apps/server/src/modules/oauth/oauth.routes.ts:87-98` | Integration test sends `OPTIONS` with `DPoP` header |

---

## Phase 3 — Code quality & simplification

Can be sequenced incrementally. Est. ~10h.

| # | Item | Files | Acceptance |
|---|------|-------|-----------|
| 3.1 | **Decide on `Result<T,E>` monad: adopt or delete** | `packages/core/*` | Either apply systematically in new services or remove dead export |
| 3.2 | **Split `oauth.service.ts` (1052 lines)** | `apps/server/src/modules/oauth/oauth.service.ts` → `oauth.authorize.ts`, `oauth.token.ts`, `oauth.introspect.ts` | No file > 400 lines; tests still green |
| 3.3 | **Enforce module barrels (no cross-module internal imports)** | `apps/server/src/modules/{token,client,session}/index.ts` | Add missing exports; eslint/biome rule optional |
| 3.4 | **Consolidate API clients** | `packages/ui/src/lib/api-client.ts`, `apps/admin/src/lib/api-client.ts`, `apps/admin/src/lib/api-client.server.ts` | One `clientFetch` + `serverFetch` in shared package; unified error shape |
| 3.5 | **Typed mock-DB builder for tests** | new `apps/server/test/mock-db.ts` | Removes `as unknown as Database` (130+ sites) |
| 3.6 | **Shared env base for apps** | `packages/core/env.ts` | `NODE_ENV`, `API_URL` centralized; apps extend |
| 3.7 | **Remove dead `void eventBus`** | `apps/server/src/modules/mfa/mfa.service.ts:71` | Parameter removed from call sites |
| 3.8 | **Rename `SafeRow`/`SafeRowResult`** | `apps/server/src/modules/auth/auth.service.ts` | `UserPublicFields`/`UserPublicData` |

---

## Phase 4 — Medium-impact performance

Est. ~4h.

| # | Item | Files | Acceptance |
|---|------|-------|-----------|
| 4.1 | **Offload argon2 to worker pool** | `apps/server/src/core/password.ts` | Piscina pool; concurrent registrations don't block event loop |
| 4.2 | **Async audit log writes** | `apps/server/src/modules/audit/audit.listener.ts:253-265` | Queue-based; failures don't block request path |
| 4.3 | **Trigram index for email ILIKE search** | `packages/db/src/schema/user.ts`, migration | Admin user search uses index; verified via `EXPLAIN` |
| 4.4 | **React.memo on admin tables** | `apps/admin/src/components/users/user-table.tsx`, `audit-log-table.tsx` | Row-level memoization; measurable reduction in re-render time |
| 4.5 | **Dynamic import for `jose`** | `apps/admin/**`, `apps/web/**` | Not bundled on pages that don't use JWT decode |

---

## Suggested execution order

1. **Phase 0** in one branch (security-critical, small surgical diffs, each fix a separate commit).
2. **Phase 1.4** (indexes) first — zero risk, big win; then **1.1 + 1.2** (caching) together.
3. **Phase 2** in parallel with Phase 1 (different files).
4. **Phase 3.2** (oauth split) before Phase 3.3 (barrels) — easier to fix imports after the split.
5. **Phase 4** last; measure before/after with `autocannon` or the existing E2E harness.

---

## Open questions to resolve before starting

1. Do you want Phase 0 delivered as one PR or six separate PRs? (Recommend separate for reviewability.)
2. Adopt `Result<T,E>` monad or delete it? (Current state is confusing dead code.)
3. Is there a production deployment to protect, or is this still learning-phase? (Changes Phase 0 urgency.)
4. Acceptable to introduce a worker-pool dependency (`piscina`) for argon2?

---

## Scan details (raw findings)

### Security — key strengths

- Argon2 password hashing (excellent)
- Comprehensive DPoP implementation
- Session invalidation on logout
- RBAC with permission checks
- Audit logging with chain verification
- Parameterized queries via Drizzle ORM
- No `dangerouslySetInnerHTML` usage detected

### Security — full findings count

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 4 |
| Medium | 5 |
| Low | 2 |

### Performance — biggest wins

- Session cache (Phase 1.1) and RBAC cache (Phase 1.2) affect **every authenticated request**
- Missing FK indexes (Phase 1.4) — zero-risk, big win
- Audit chain verify (Phase 1.6) — full-table scan on every admin dashboard load

### Code quality — biggest wins

- 130+ `as unknown as Database` casts in tests (Phase 3.5)
- `oauth.service.ts` is 1052 lines mixing 6+ concerns (Phase 3.2)
- 3 divergent API-client implementations (Phase 3.4)
- `Result<T,E>` exported from core but **never used** — decision needed (Phase 3.1)

---

## Total effort estimate

| Phase | Est. hours |
|-------|-----------|
| Phase 0 — Critical | 6 |
| Phase 1 — High perf | 8 |
| Phase 2 — Security hardening | 4 |
| Phase 3 — Quality | 10 |
| Phase 4 — Medium perf | 4 |
| **Total** | **~32** |
