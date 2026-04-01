# E2E Flow Tests with Input/Output Logging

> Date: 2026-04-01

## Goal

Create dedicated e2e tests for each of the 6 authentication flows (A-F) defined in `docs/API_STANDARDS_AUDIT.md`. Each test file exercises one complete flow end-to-end, with console table logging of every HTTP request/response so the developer can trace the entire sequence.

## Flows Under Test

| File | Flow | What It Proves |
|------|------|----------------|
| `16-flow-a-third-party-oauth.e2e.ts` | A: Third-Party Web App | Full OAuth 2.1 authorization code + PKCE: client setup, authorize, login, consent, token exchange, userinfo, introspect, refresh rotation, revoke, end-session |
| `17-flow-b-first-party-session.e2e.ts` | B: First-Party Web App | Session-based auth: register, verify email, login, MFA enroll/verify, profile management, session management, password change, forgot/reset password, logout |
| `18-flow-c-mobile-oauth-par-dpop.e2e.ts` | C: Mobile Native App | PAR + PKCE + DPoP: push authorization request, authorize via request_uri, DPoP-bound token exchange, DPoP-bound userinfo, DPoP-bound refresh, revoke |
| `19-flow-d-spa-bff-oauth.e2e.ts` | D: SPA + BFF | Same OAuth endpoints as Flow A but framed from BFF proxy perspective with logging that explains the BFF conceptual model |
| `20-flow-e-admin-dashboard.e2e.ts` | E: Admin Dashboard | Admin login, client CRUD + secret rotation, user management + suspend/activate, RBAC role/permission assignment, session oversight, audit log query/verify/export, logout |
| `21-flow-f-service-to-service.e2e.ts` | F: Client Credentials | Client credentials grant, use access token, no refresh token issued, re-authenticate on expiry |

## New Helpers

### `e2e/src/helpers/flow-logger.ts`

Wraps the existing `api` from `http-client.ts` to log each step.

**API:**

```ts
function createFlowLogger(flowName: string): {
  step: <T>(label: string, method: string, path: string, fn: () => Promise<ApiResponse<T>>) => Promise<ApiResponse<T>>;
  banner: () => void;
};
```

**Console output format:**

```
══════════════════════════════════════════════════════════════
  Flow A: Third-Party Web App (OAuth 2.1)
══════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────┐
│ Step 1: Register OAuth client (POST /api/admin/clients)     │
├──────────┬──────────────────────────────────────────────────┤
│ Request  │ {"clientName":"E2E Flow A App","redirectUris"…   │
│ Headers  │ Authorization: Bearer eyJhbG…(20 chars)          │
├──────────┼──────────────────────────────────────────────────┤
│ Status   │ 201                                              │
│ Response │ {"clientId":"clnt_…","clientSecret":"***"}        │
└──────────┴──────────────────────────────────────────────────┘
```

**Behavior:**

- Uses `console.log` (visible during `pnpm test:e2e`)
- Truncates token/bearer values to 20 chars
- Masks `password`, `clientSecret`, `client_secret` fields with `***`
- Truncates request/response bodies to 200 chars
- Step counter auto-increments per flow

### `e2e/src/helpers/dpop.ts`

DPoP proof generation for Flow C, using `jose` (already a dependency of the e2e package).

```ts
interface DPoPKeyPair {
  privateKey: CryptoKey;
  publicJwk: jose.JWK;
}

function generateDPoPKeyPair(): Promise<DPoPKeyPair>;
function createDPoPProof(keyPair: DPoPKeyPair, method: string, url: string, accessToken?: string): Promise<string>;
```

- ES256 algorithm (matches server's supported DPoP algorithms)
- Includes `jti`, `htm`, `htu`, `iat` claims per RFC 9449
- When `accessToken` provided, includes `ath` (access token hash) claim

## Test Structure Per File

Each test file follows this pattern:

```ts
import { createFlowLogger } from './helpers/flow-logger.js';

describe('Flow X: <Name>', () => {
  const flow = createFlowLogger('Flow X: <Name>');

  // Shared state across steps
  let token: string;

  beforeAll(() => {
    flow.banner();
  });

  it('step 1: <description>', async () => {
    const res = await flow.step('Description', 'POST', '/path', () =>
      api.post('/path', { body: { ... } })
    );
    expect(res.status).toBe(200);
    token = res.data.token;
  });

  it('step 2: <description>', async () => {
    // ...
  });
});
```

Tests are sequential within each file (vitest `sequence.concurrent: false` is already set). Each `it()` is one logical step from the audit doc's flow diagram.

## Flow-Specific Details

### Flow A (16 steps)

1. Admin login
2. Register OAuth client
3. Register a test user (separate from admin)
4. Verify test user email
5. Login as test user
6. Generate PKCE pair + state + nonce
7. GET /oauth/authorize (expect consent_required)
8. POST /oauth/consent (approve)
9. POST /oauth/token (exchange code + PKCE verifier)
10. Verify access_token JWT (via JWKS)
11. Verify id_token claims (nonce, aud)
12. GET /oauth/userinfo
13. POST /oauth/introspect (active=true)
14. POST /oauth/token (refresh_token grant, verify rotation)
15. POST /oauth/revoke (refresh_token)
16. GET /oauth/end-session

### Flow B (18 steps)

1. Register new user
2. Verify email
3. Login
4. Get profile
5. Update profile (displayName)
6. List sessions
7. Enroll TOTP MFA
8. Verify TOTP enrollment
9. Logout
10. Login (gets mfaRequired)
11. Verify MFA (complete login)
12. Regenerate recovery codes
13. Disable TOTP
14. Change password
15. Logout
16. Forgot password
17. Reset password
18. Login with new password + final logout

### Flow C (12 steps)

1. Admin login + create public OAuth client
2. Register + verify test user + login
3. Generate DPoP key pair + PKCE pair
4. POST /oauth/par (push authorization request)
5. GET /oauth/authorize with request_uri
6. POST /oauth/consent (if needed)
7. POST /oauth/token with DPoP proof (code exchange)
8. Verify token_type is "DPoP"
9. GET /oauth/userinfo with DPoP proof
10. POST /oauth/token with DPoP (refresh, verify rotation)
11. POST /oauth/revoke
12. Verify revoked token introspects as inactive

### Flow D (10 steps)

Same OAuth endpoints as Flow A, but logging emphasizes the BFF role:
1. BFF registers as confidential client
2. BFF generates PKCE (server-side, not in browser)
3. BFF initiates authorize
4. User authenticates (login step)
5. User consents
6. BFF exchanges code for tokens (server-to-server)
7. BFF calls userinfo on behalf of user
8. BFF refreshes token (server-side)
9. BFF revokes token
10. Logging notes explain what the browser vs. BFF sees at each step

### Flow E (20 steps)

1. Admin login
2. Create OAuth client
3. List clients
4. Get client by ID
5. Update client
6. Rotate client secret
7. Delete client
8. Register target user
9. List users
10. Get user by ID
11. Suspend user
12. Reactivate user
13. Create role
14. List roles
15. Set role permissions
16. Assign role to user
17. Remove role from user
18. List sessions / force-revoke
19. Query audit logs
20. Logout

### Flow F (5 steps)

1. Admin login + create confidential client
2. POST /oauth/token (client_credentials)
3. Verify no refresh_token or id_token in response
4. POST /oauth/introspect (verify active)
5. POST /oauth/revoke

## What This Does NOT Cover

- WebAuthn/passkey flows in Flow B (requires browser WebAuthn API, not testable via HTTP)
- Actual BFF proxy server in Flow D (the BFF is not part of this IdP)
- DPoP nonce negotiation (if server doesn't enforce nonces)
- `prompt=none` / `login_hint` / `max_age` (marked as NOT IMPLEMENTED in audit)

## Dependencies

- `jose` — already in e2e package.json (used for JWT verification in existing tests)
- No new npm dependencies needed
