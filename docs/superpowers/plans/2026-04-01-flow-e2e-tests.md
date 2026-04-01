# Flow A-F E2E Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create 6 dedicated e2e test files (one per authentication flow A-F) with console table logging of every HTTP request/response.

**Architecture:** Each flow is a single sequential test file with numbered `it()` steps. A shared `flow-logger.ts` helper wraps `api` calls to print formatted request/response tables. A `dpop.ts` helper generates DPoP proofs for Flow C.

**Tech Stack:** Vitest, jose (JWT/DPoP), otpauth (TOTP), native fetch via existing http-client.ts

---

## File Structure

| File | Responsibility |
|------|---------------|
| `e2e/src/helpers/flow-logger.ts` | Console table logging wrapper around `api` |
| `e2e/src/helpers/dpop.ts` | DPoP ES256 key pair + proof JWT generation |
| `e2e/src/16-flow-a-third-party-oauth.e2e.ts` | Flow A: full OAuth 2.1 auth code + PKCE |
| `e2e/src/17-flow-b-first-party-session.e2e.ts` | Flow B: session-based auth lifecycle |
| `e2e/src/18-flow-c-mobile-oauth-par-dpop.e2e.ts` | Flow C: PAR + PKCE + DPoP |
| `e2e/src/19-flow-d-spa-bff-oauth.e2e.ts` | Flow D: OAuth from BFF perspective |
| `e2e/src/20-flow-e-admin-dashboard.e2e.ts` | Flow E: admin operations lifecycle |
| `e2e/src/21-flow-f-service-to-service.e2e.ts` | Flow F: client credentials |

---

### Task 1: Create flow-logger.ts helper

**Files:**
- Create: `e2e/src/helpers/flow-logger.ts`

- [ ] **Step 1: Create the flow-logger helper**

```ts
// e2e/src/helpers/flow-logger.ts
import { type ApiResponse, api } from './http-client.js';

const MAX_BODY_LEN = 200;
const MAX_TOKEN_LEN = 20;

const SENSITIVE_KEYS = new Set(['password', 'clientSecret', 'client_secret', 'currentPassword', 'newPassword']);

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max)}...` : str;
}

function maskSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitive);
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      masked[key] = '***';
    } else if (typeof value === 'string' && (key === 'token' || key === 'authorization' || key === 'mfaToken')) {
      masked[key] = truncate(value, MAX_TOKEN_LEN);
    } else {
      masked[key] = maskSensitive(value);
    }
  }
  return masked;
}

function maskHeaders(headers?: Record<string, string>): string {
  if (!headers || Object.keys(headers).length === 0) return '';
  const masked = { ...headers };
  if (masked.authorization) {
    masked.authorization = truncate(masked.authorization, 30);
  }
  return truncate(JSON.stringify(masked), MAX_BODY_LEN);
}

function formatBody(body: unknown): string {
  if (body === null || body === undefined) return '(none)';
  const masked = maskSensitive(body);
  return truncate(JSON.stringify(masked), MAX_BODY_LEN);
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

export interface FlowLogger {
  step: <T = unknown>(
    label: string,
    fn: () => Promise<ApiResponse<T>>,
    meta?: { method: string; path: string; body?: unknown; headers?: Record<string, string> },
  ) => Promise<ApiResponse<T>>;
  banner: () => void;
  note: (message: string) => void;
}

export function createFlowLogger(flowName: string): FlowLogger {
  let stepNum = 0;

  return {
    banner() {
      const line = '═'.repeat(62);
      console.log(`\n${line}`);
      console.log(`  ${flowName}`);
      console.log(`${line}\n`);
    },

    note(message: string) {
      console.log(`  💡 ${message}\n`);
    },

    async step<T = unknown>(
      label: string,
      fn: () => Promise<ApiResponse<T>>,
      meta?: { method: string; path: string; body?: unknown; headers?: Record<string, string> },
    ): Promise<ApiResponse<T>> {
      stepNum++;
      const stepLabel = `Step ${stepNum}: ${label}`;
      const methodPath = meta ? `${meta.method} ${meta.path}` : '';
      const headerLine = methodPath ? `${stepLabel} (${methodPath})` : stepLabel;
      const width = 61;

      const res = await fn();

      console.log(`┌${'─'.repeat(width)}┐`);
      console.log(`│ ${pad(headerLine, width - 2)} │`);
      console.log(`├${'──────────'}┬${'─'.repeat(width - 11)}┤`);

      if (meta) {
        const reqLine = meta.body ? formatBody(meta.body) : '(none)';
        console.log(`│ ${pad('Request', 8)} │ ${pad(reqLine, width - 12)} │`);
        if (meta.headers && Object.keys(meta.headers).length > 0) {
          console.log(`│ ${pad('Headers', 8)} │ ${pad(maskHeaders(meta.headers), width - 12)} │`);
        }
        console.log(`├${'──────────'}┼${'─'.repeat(width - 11)}┤`);
      }

      const statusStr = String(res.status);
      console.log(`│ ${pad('Status', 8)} │ ${pad(statusStr, width - 12)} │`);
      const resBody = res.data !== null ? formatBody(res.data) : '(empty)';
      console.log(`│ ${pad('Response', 8)} │ ${pad(resBody, width - 12)} │`);

      const locationHeader = res.headers.get('location');
      if (locationHeader) {
        console.log(`│ ${pad('Location', 8)} │ ${pad(truncate(locationHeader, width - 14), width - 12)} │`);
      }

      console.log(`└${'──────────'}┴${'─'.repeat(width - 11)}┘`);
      console.log('');

      return res;
    },
  };
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/messi/Projects/Others/identity-starter && npx tsc --noEmit -p e2e/tsconfig.json 2>&1 || echo "checking imports manually"` — if no tsconfig in e2e, just verify with: `node --loader ts-node/esm --check e2e/src/helpers/flow-logger.ts 2>&1 || true`

Alternatively, just run a quick smoke test in the next task to validate.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/helpers/flow-logger.ts
git commit -m "feat(e2e): add flow-logger helper for request/response console logging"
```

---

### Task 2: Create dpop.ts helper

**Files:**
- Create: `e2e/src/helpers/dpop.ts`

- [ ] **Step 1: Create the DPoP helper**

```ts
// e2e/src/helpers/dpop.ts
import { createHash, randomUUID } from 'node:crypto';
import * as jose from 'jose';

export interface DPoPKeyPair {
  privateKey: CryptoKey;
  publicJwk: jose.JWK;
}

export async function generateDPoPKeyPair(): Promise<DPoPKeyPair> {
  const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
  const publicJwk = await jose.exportJWK(publicKey);
  return { privateKey, publicJwk };
}

export async function createDPoPProof(
  keyPair: DPoPKeyPair,
  method: string,
  url: string,
  accessToken?: string,
): Promise<string> {
  const header: jose.JWTHeaderParameters = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: keyPair.publicJwk,
  };

  const payload: jose.JWTPayload = {
    jti: randomUUID(),
    htm: method,
    htu: url,
    iat: Math.floor(Date.now() / 1000),
  };

  if (accessToken) {
    const hash = createHash('sha256').update(accessToken).digest('base64url');
    payload.ath = hash;
  }

  return new jose.SignJWT(payload).setProtectedHeader(header).sign(keyPair.privateKey);
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/src/helpers/dpop.ts
git commit -m "feat(e2e): add DPoP proof generation helper for Flow C tests"
```

---

### Task 3: Create Flow A test — Third-Party Web App (OAuth 2.1)

**Files:**
- Create: `e2e/src/16-flow-a-third-party-oauth.e2e.ts`

- [ ] **Step 1: Write the test file**

```ts
// e2e/src/16-flow-a-third-party-oauth.e2e.ts
import * as jose from 'jose';
import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_PASSWORD } from './helpers/constants.js';
import { basicAuth, codeFromLocation, pkcePair, uniqueEmail } from './helpers/crypto.js';
import { createFlowLogger } from './helpers/flow-logger.js';
import { api } from './helpers/http-client.js';

const REDIRECT_URI = 'https://thirdparty.example.com/callback';
const SCOPE = 'openid profile email';

describe('Flow A: Third-Party Web App (OAuth 2.1)', () => {
  const flow = createFlowLogger('Flow A: Third-Party Web App (OAuth 2.1)');
  const userEmail = uniqueEmail('flow-a');
  let adminToken: string;
  let clientId: string;
  let clientSecret: string;
  let userToken: string;
  let verificationToken: string;
  let codeVerifier: string;
  let codeChallenge: string;
  let state: string;
  let nonce: string;
  let authorizationCode: string;
  let accessToken: string;
  let refreshToken: string;
  let idToken: string;

  beforeAll(() => {
    flow.banner();
  });

  it('step 1: admin logs in', async () => {
    const body = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
    const res = await flow.step<{ token: string }>(
      'Admin logs in',
      () => api.post('/api/auth/login', { body }),
      { method: 'POST', path: '/api/auth/login', body },
    );
    expect(res.status).toBe(200);
    adminToken = res.data.token;
  });

  it('step 2: admin registers OAuth client for third-party app', async () => {
    const body = {
      clientName: 'Acme Corp (Flow A)',
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      scope: SCOPE,
      tokenEndpointAuthMethod: 'client_secret_basic',
      isConfidential: true,
    };
    const res = await flow.step<{ clientId: string; clientSecret: string }>(
      'Register OAuth client',
      () => api.post('/api/admin/clients', { body, token: adminToken }),
      { method: 'POST', path: '/api/admin/clients', body },
    );
    expect(res.status).toBe(201);
    clientId = res.data.clientId;
    clientSecret = res.data.clientSecret;
  });

  it('step 3: user registers on IdP', async () => {
    const body = { email: userEmail, password: TEST_PASSWORD, displayName: 'Flow A User' };
    const res = await flow.step<{ token: string; verificationToken: string }>(
      'User registers',
      () => api.post('/api/auth/register', { body }),
      { method: 'POST', path: '/api/auth/register', body },
    );
    expect(res.status).toBe(201);
    userToken = res.data.token;
    verificationToken = res.data.verificationToken;
  });

  it('step 4: user verifies email', async () => {
    const body = { token: verificationToken };
    const res = await flow.step(
      'Verify email',
      () => api.post('/api/auth/verify-email', { body }),
      { method: 'POST', path: '/api/auth/verify-email', body },
    );
    expect(res.status).toBe(200);
  });

  it('step 5: user logs in (gets session for authorize)', async () => {
    const body = { email: userEmail, password: TEST_PASSWORD };
    const res = await flow.step<{ token: string }>(
      'User logs in',
      () => api.post('/api/auth/login', { body }),
      { method: 'POST', path: '/api/auth/login', body },
    );
    expect(res.status).toBe(200);
    userToken = res.data.token;
  });

  it('step 6: third-party app generates PKCE pair and redirects to authorize', async () => {
    const pkce = pkcePair();
    codeVerifier = pkce.codeVerifier;
    codeChallenge = pkce.codeChallenge;
    state = `state-${Date.now()}`;
    nonce = `nonce-${Date.now()}`;

    flow.note('Third-party app generates code_verifier + S256 challenge, state, and nonce client-side');

    const query = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      nonce,
    };
    const res = await flow.step<{ type: string }>(
      'Authorize request (expect consent required)',
      () => api.get('/oauth/authorize', { query, token: userToken }),
      { method: 'GET', path: '/oauth/authorize', body: query },
    );
    expect(res.status).toBe(200);
    expect(res.data.type).toBe('consent_required');
  });

  it('step 7: user approves consent on IdP page', async () => {
    const body = {
      client_id: clientId,
      scope: SCOPE,
      decision: 'approve',
      state,
      redirect_uri: REDIRECT_URI,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      nonce,
    };
    const res = await flow.step(
      'User approves consent',
      () => api.post('/oauth/consent', { body, token: userToken }),
      { method: 'POST', path: '/oauth/consent', body },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toContain('thirdparty.example.com/callback');
    expect(location).toContain(`state=${state}`);
    authorizationCode = codeFromLocation(location);
  });

  it('step 8: third-party server exchanges code for tokens', async () => {
    const body = {
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{
      access_token: string;
      refresh_token: string;
      id_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    }>(
      'Exchange authorization code for tokens',
      () => api.post('/oauth/token', { body, headers }),
      { method: 'POST', path: '/oauth/token', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.token_type).toBe('Bearer');
    expect(res.data.scope).toBe(SCOPE);
    accessToken = res.data.access_token;
    refreshToken = res.data.refresh_token;
    idToken = res.data.id_token;
  });

  it('step 9: verify access_token JWT via JWKS', async () => {
    const jwksRes = await flow.step<jose.JSONWebKeySet>(
      'Fetch JWKS public keys',
      () => api.get('/.well-known/jwks.json'),
      { method: 'GET', path: '/.well-known/jwks.json' },
    );
    const jwks = jose.createLocalJWKSet(jwksRes.data);
    const { payload } = await jose.jwtVerify(accessToken, jwks, {
      issuer: 'http://localhost:3001',
      audience: clientId,
    });
    expect(payload.sub).toBeDefined();
    expect(payload.scope).toBe(SCOPE);
    flow.note(`Access token verified: sub=${payload.sub}, scope=${payload.scope}`);
  });

  it('step 10: verify id_token claims', async () => {
    const decoded = jose.decodeJwt(idToken);
    expect(decoded.nonce).toBe(nonce);
    expect(decoded.aud).toBe(clientId);
    expect(decoded.sub).toBeDefined();
    flow.note(`ID token: nonce=${decoded.nonce}, aud=${decoded.aud}, sub=${decoded.sub}`);
  });

  it('step 11: fetch userinfo with access token', async () => {
    const headers = { authorization: `Bearer ${accessToken}` };
    const res = await flow.step<{ sub: string; email: string; name: string }>(
      'Get userinfo',
      () => api.get('/oauth/userinfo', { headers }),
      { method: 'GET', path: '/oauth/userinfo', headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.sub).toBeDefined();
    expect(res.data.email).toBe(userEmail);
  });

  it('step 12: introspect access token (active)', async () => {
    const body = { token: accessToken };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ active: boolean; sub: string }>(
      'Introspect access token',
      () => api.post('/oauth/introspect', { body, headers }),
      { method: 'POST', path: '/oauth/introspect', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.active).toBe(true);
  });

  it('step 13: refresh token rotation', async () => {
    const body = { grant_type: 'refresh_token', refresh_token: refreshToken };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ access_token: string; refresh_token: string }>(
      'Refresh token (rotation)',
      () => api.post('/oauth/token', { body, headers }),
      { method: 'POST', path: '/oauth/token', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.access_token).not.toBe(accessToken);
    expect(res.data.refresh_token).not.toBe(refreshToken);
    flow.note('Both access_token and refresh_token rotated — old tokens replaced');
    accessToken = res.data.access_token;
    refreshToken = res.data.refresh_token;
  });

  it('step 14: revoke refresh token', async () => {
    const body = { token: refreshToken, token_type_hint: 'refresh_token' };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step(
      'Revoke refresh token',
      () => api.post('/oauth/revoke', { body, headers }),
      { method: 'POST', path: '/oauth/revoke', body, headers },
    );
    expect(res.status).toBe(200);
  });

  it('step 15: verify revoked token is inactive', async () => {
    const body = { token: refreshToken, token_type_hint: 'refresh_token' };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ active: boolean }>(
      'Introspect revoked token (expect inactive)',
      () => api.post('/oauth/introspect', { body, headers }),
      { method: 'POST', path: '/oauth/introspect', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.active).toBe(false);
  });

  it('step 16: RP-initiated logout', async () => {
    const query = {
      id_token_hint: idToken,
      post_logout_redirect_uri: REDIRECT_URI,
    };
    const res = await flow.step(
      'End session (RP-initiated logout)',
      () => api.get('/oauth/end-session', { query }),
      { method: 'GET', path: '/oauth/end-session', body: query },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toContain('thirdparty.example.com/callback');
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd /Users/messi/Projects/Others/identity-starter && pnpm --filter @identity-starter/e2e test -- --testPathPattern 16-flow-a`

Expected: All 16 steps pass. Console shows formatted request/response tables.

Note: Tests require the e2e Docker stack to be running. If not running, start with `./scripts/e2e.sh` or `docker compose -f docker-compose.e2e.yml up -d`.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/16-flow-a-third-party-oauth.e2e.ts
git commit -m "test(e2e): add Flow A — third-party OAuth 2.1 auth code + PKCE"
```

---

### Task 4: Create Flow B test — First-Party Web App (Direct Session)

**Files:**
- Create: `e2e/src/17-flow-b-first-party-session.e2e.ts`

- [ ] **Step 1: Write the test file**

```ts
// e2e/src/17-flow-b-first-party-session.e2e.ts
import * as OTPAuth from 'otpauth';
import { TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { createFlowLogger } from './helpers/flow-logger.js';
import { api } from './helpers/http-client.js';

describe('Flow B: First-Party Web App (Direct Session Auth)', () => {
  const flow = createFlowLogger('Flow B: First-Party Web App (Direct Session Auth)');
  const email = uniqueEmail('flow-b');
  const newPassword = 'NewFlowB_Pass123!';
  const resetPassword = 'ResetFlowB_Pass456!';
  let sessionToken: string;
  let verificationToken: string;
  let totp: OTPAuth.TOTP;
  let recoveryCodes: string[];

  beforeAll(() => {
    flow.banner();
  });

  // --- REGISTRATION ---

  it('step 1: register new user', async () => {
    const body = { email, password: TEST_PASSWORD, displayName: 'Flow B User' };
    const res = await flow.step<{ token: string; verificationToken: string; user: { id: string; email: string } }>(
      'Register new user',
      () => api.post('/api/auth/register', { body }),
      { method: 'POST', path: '/api/auth/register', body },
    );
    expect(res.status).toBe(201);
    expect(res.data.user.email).toBe(email);
    sessionToken = res.data.token;
    verificationToken = res.data.verificationToken;
  });

  it('step 2: verify email', async () => {
    const body = { token: verificationToken };
    const res = await flow.step(
      'Verify email via token',
      () => api.post('/api/auth/verify-email', { body }),
      { method: 'POST', path: '/api/auth/verify-email', body },
    );
    expect(res.status).toBe(200);
  });

  // --- LOGIN ---

  it('step 3: login with credentials', async () => {
    const body = { email, password: TEST_PASSWORD };
    const res = await flow.step<{ token: string; user: { email: string } }>(
      'Login with email + password',
      () => api.post('/api/auth/login', { body }),
      { method: 'POST', path: '/api/auth/login', body },
    );
    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();
    sessionToken = res.data.token;
  });

  // --- PROFILE MANAGEMENT ---

  it('step 4: get own profile', async () => {
    const res = await flow.step<{ email: string; displayName: string }>(
      'Get own profile',
      () => api.get('/api/account/profile', { token: sessionToken }),
      { method: 'GET', path: '/api/account/profile' },
    );
    expect(res.status).toBe(200);
    expect(res.data.email).toBe(email);
    expect(res.data.displayName).toBe('Flow B User');
  });

  it('step 5: update display name', async () => {
    const body = { displayName: 'Flow B Updated' };
    const res = await flow.step<{ displayName: string }>(
      'Update profile display name',
      () => api.patch('/api/account/profile', { body, token: sessionToken }),
      { method: 'PATCH', path: '/api/account/profile', body },
    );
    expect(res.status).toBe(200);
    expect(res.data.displayName).toBe('Flow B Updated');
  });

  // --- SESSION MANAGEMENT ---

  it('step 6: list active sessions', async () => {
    const res = await flow.step<{ data: Array<{ id: string }> }>(
      'List own sessions',
      () => api.get('/api/account/sessions', { token: sessionToken }),
      { method: 'GET', path: '/api/account/sessions' },
    );
    expect(res.status).toBe(200);
    expect(res.data.data.length).toBeGreaterThanOrEqual(1);
  });

  // --- MFA ENROLLMENT ---

  it('step 7: enroll TOTP MFA', async () => {
    const res = await flow.step<{ otpauthUri: string; recoveryCodes: string[] }>(
      'Enroll TOTP (generate secret + QR)',
      () => api.post('/api/account/mfa/totp/enroll', { token: sessionToken }),
      { method: 'POST', path: '/api/account/mfa/totp/enroll' },
    );
    expect(res.status).toBe(200);
    expect(res.data.otpauthUri).toContain('otpauth://totp/');
    expect(res.data.recoveryCodes).toHaveLength(8);

    const parsed = OTPAuth.URI.parse(res.data.otpauthUri);
    if (!(parsed instanceof OTPAuth.TOTP)) {
      throw new Error('expected TOTP URI');
    }
    totp = parsed;
    recoveryCodes = res.data.recoveryCodes;
  });

  it('step 8: verify TOTP enrollment with valid OTP', async () => {
    const otp = totp.generate();
    const body = { otp };
    const res = await flow.step(
      'Confirm TOTP enrollment',
      () => api.post('/api/account/mfa/totp/verify', { body, token: sessionToken }),
      { method: 'POST', path: '/api/account/mfa/totp/verify', body },
    );
    expect(res.status).toBe(200);
    flow.note('TOTP is now active — future logins will require MFA step');
  });

  // --- LOGOUT + MFA LOGIN ---

  it('step 9: logout', async () => {
    const res = await flow.step(
      'Logout (revoke session)',
      () => api.post('/api/auth/logout', { token: sessionToken }),
      { method: 'POST', path: '/api/auth/logout' },
    );
    expect(res.status).toBe(204);
  });

  it('step 10: login returns MFA challenge', async () => {
    const body = { email, password: TEST_PASSWORD };
    const res = await flow.step<{ mfaRequired: boolean; mfaToken: string }>(
      'Login (expect MFA challenge)',
      () => api.post('/api/auth/login', { body }),
      { method: 'POST', path: '/api/auth/login', body },
    );
    expect(res.status).toBe(200);
    expect(res.data.mfaRequired).toBe(true);
    expect(res.data.mfaToken).toBeDefined();

    // Complete MFA in next step
    const mfaBody = { mfaToken: res.data.mfaToken, otp: totp.generate() };
    const mfaRes = await flow.step<{ token: string }>(
      'Complete MFA with TOTP',
      () => api.post('/api/auth/mfa/verify', { body: mfaBody }),
      { method: 'POST', path: '/api/auth/mfa/verify', body: mfaBody },
    );
    expect(mfaRes.status).toBe(200);
    sessionToken = mfaRes.data.token;
  });

  // --- RECOVERY CODES ---

  it('step 11: regenerate recovery codes', async () => {
    const body = { password: TEST_PASSWORD };
    const res = await flow.step<{ recoveryCodes: string[] }>(
      'Regenerate recovery codes',
      () => api.post('/api/account/mfa/recovery-codes/regenerate', { body, token: sessionToken }),
      { method: 'POST', path: '/api/account/mfa/recovery-codes/regenerate', body },
    );
    expect(res.status).toBe(200);
    expect(res.data.recoveryCodes).toHaveLength(8);
    recoveryCodes = res.data.recoveryCodes;
  });

  // --- DISABLE TOTP ---

  it('step 12: disable TOTP', async () => {
    const body = { password: TEST_PASSWORD };
    const res = await flow.step(
      'Disable TOTP MFA',
      () => api.delete('/api/account/mfa/totp', { body, token: sessionToken }),
      { method: 'DELETE', path: '/api/account/mfa/totp', body },
    );
    expect(res.status).toBe(204);
    flow.note('MFA disabled — login no longer requires TOTP');
  });

  // --- PASSWORD CHANGE ---

  it('step 13: change password', async () => {
    const body = { currentPassword: TEST_PASSWORD, newPassword };
    const res = await flow.step(
      'Change password (authenticated)',
      () => api.post('/api/auth/change-password', { body, token: sessionToken }),
      { method: 'POST', path: '/api/auth/change-password', body },
    );
    expect(res.status).toBe(204);
  });

  it('step 14: logout after password change', async () => {
    const res = await flow.step(
      'Logout',
      () => api.post('/api/auth/logout', { token: sessionToken }),
      { method: 'POST', path: '/api/auth/logout' },
    );
    expect(res.status).toBe(204);
  });

  // --- FORGOT / RESET PASSWORD ---

  it('step 15: forgot password (initiate reset)', async () => {
    const body = { email };
    const res = await flow.step<{ message: string; resetToken?: string }>(
      'Forgot password (request reset)',
      () => api.post('/api/auth/forgot-password', { body }),
      { method: 'POST', path: '/api/auth/forgot-password', body },
    );
    expect(res.status).toBe(200);
    expect(res.data.resetToken).toBeDefined();

    const resetBody = { token: res.data.resetToken!, newPassword: resetPassword };
    const resetRes = await flow.step(
      'Reset password with token',
      () => api.post('/api/auth/reset-password', { body: resetBody }),
      { method: 'POST', path: '/api/auth/reset-password', body: resetBody },
    );
    expect(resetRes.status).toBe(200);
  });

  // --- FINAL LOGIN + LOGOUT ---

  it('step 16: login with reset password and logout', async () => {
    const body = { email, password: resetPassword };
    const res = await flow.step<{ token: string }>(
      'Login with new password',
      () => api.post('/api/auth/login', { body }),
      { method: 'POST', path: '/api/auth/login', body },
    );
    expect(res.status).toBe(200);
    sessionToken = res.data.token;

    const logoutRes = await flow.step(
      'Final logout',
      () => api.post('/api/auth/logout', { token: sessionToken }),
      { method: 'POST', path: '/api/auth/logout' },
    );
    expect(logoutRes.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/messi/Projects/Others/identity-starter && pnpm --filter @identity-starter/e2e test -- --testPathPattern 17-flow-b`

Expected: All steps pass with formatted logging output.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/17-flow-b-first-party-session.e2e.ts
git commit -m "test(e2e): add Flow B — first-party session auth lifecycle"
```

---

### Task 5: Create Flow C test — Mobile Native App (PAR + DPoP)

**Files:**
- Create: `e2e/src/18-flow-c-mobile-oauth-par-dpop.e2e.ts`

- [ ] **Step 1: Write the test file**

```ts
// e2e/src/18-flow-c-mobile-oauth-par-dpop.e2e.ts
import * as jose from 'jose';
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, TEST_PASSWORD } from './helpers/constants.js';
import { basicAuth, codeFromLocation, pkcePair, uniqueEmail } from './helpers/crypto.js';
import { createDPoPProof, generateDPoPKeyPair, type DPoPKeyPair } from './helpers/dpop.js';
import { createFlowLogger } from './helpers/flow-logger.js';
import { api } from './helpers/http-client.js';

const REDIRECT_URI = 'com.mobileapp.example://callback';
const SCOPE = 'openid profile email';

describe('Flow C: Mobile Native App (OAuth 2.1 + PAR + DPoP)', () => {
  const flow = createFlowLogger('Flow C: Mobile Native App (OAuth 2.1 + PAR + DPoP)');
  const userEmail = uniqueEmail('flow-c');
  let adminToken: string;
  let clientId: string;
  let clientSecret: string;
  let userToken: string;
  let dpopKeyPair: DPoPKeyPair;
  let codeVerifier: string;
  let codeChallenge: string;
  let state: string;
  let nonce: string;
  let requestUri: string;
  let authorizationCode: string;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(() => {
    flow.banner();
  });

  it('step 1: setup — admin creates public mobile client', async () => {
    const loginBody = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
    const loginRes = await flow.step<{ token: string }>(
      'Admin logs in',
      () => api.post('/api/auth/login', { body: loginBody }),
      { method: 'POST', path: '/api/auth/login', body: loginBody },
    );
    adminToken = loginRes.data.token;

    const clientBody = {
      clientName: 'Mobile App (Flow C)',
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      scope: SCOPE,
      tokenEndpointAuthMethod: 'client_secret_basic',
      isConfidential: true,
    };
    const clientRes = await flow.step<{ clientId: string; clientSecret: string }>(
      'Register mobile OAuth client',
      () => api.post('/api/admin/clients', { body: clientBody, token: adminToken }),
      { method: 'POST', path: '/api/admin/clients', body: clientBody },
    );
    expect(clientRes.status).toBe(201);
    clientId = clientRes.data.clientId;
    clientSecret = clientRes.data.clientSecret;
  });

  it('step 2: user registers and logs in', async () => {
    const regBody = { email: userEmail, password: TEST_PASSWORD, displayName: 'Flow C Mobile User' };
    const regRes = await flow.step<{ token: string; verificationToken: string }>(
      'User registers',
      () => api.post('/api/auth/register', { body: regBody }),
      { method: 'POST', path: '/api/auth/register', body: regBody },
    );
    expect(regRes.status).toBe(201);

    const verifyBody = { token: regRes.data.verificationToken };
    await flow.step(
      'Verify email',
      () => api.post('/api/auth/verify-email', { body: verifyBody }),
      { method: 'POST', path: '/api/auth/verify-email', body: verifyBody },
    );

    const loginBody = { email: userEmail, password: TEST_PASSWORD };
    const loginRes = await flow.step<{ token: string }>(
      'User logs in',
      () => api.post('/api/auth/login', { body: loginBody }),
      { method: 'POST', path: '/api/auth/login', body: loginBody },
    );
    userToken = loginRes.data.token;
  });

  it('step 3: generate DPoP key pair + PKCE', async () => {
    dpopKeyPair = await generateDPoPKeyPair();
    const pkce = pkcePair();
    codeVerifier = pkce.codeVerifier;
    codeChallenge = pkce.codeChallenge;
    state = `state-mobile-${Date.now()}`;
    nonce = `nonce-mobile-${Date.now()}`;
    flow.note('Mobile app generates ES256 DPoP key pair + PKCE S256 challenge + state + nonce');
  });

  it('step 4: pushed authorization request (PAR)', async () => {
    const body = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ request_uri: string; expires_in: number }>(
      'Push Authorization Request (PAR)',
      () => api.post('/oauth/par', { body, headers }),
      { method: 'POST', path: '/oauth/par', body, headers },
    );
    expect(res.status).toBe(201);
    expect(res.data.request_uri).toMatch(/^urn:ietf:params:oauth:request_uri:/);
    requestUri = res.data.request_uri;
    flow.note('Auth params sent server-side via PAR — browser URL only carries opaque request_uri');
  });

  it('step 5: authorize with request_uri (system browser)', async () => {
    const query = { request_uri: requestUri, client_id: clientId };
    const res = await flow.step<{ type: string }>(
      'Authorize via request_uri',
      () => api.get('/oauth/authorize', { query, token: userToken }),
      { method: 'GET', path: '/oauth/authorize', body: query },
    );

    if (res.status === 302) {
      const location = res.headers.get('location')!;
      authorizationCode = codeFromLocation(location);
    } else {
      expect(res.status).toBe(200);
      expect(res.data.type).toBe('consent_required');

      const consentBody = {
        client_id: clientId,
        scope: SCOPE,
        decision: 'approve',
        state,
        redirect_uri: REDIRECT_URI,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        nonce,
      };
      const consentRes = await flow.step(
        'User consents in system browser',
        () => api.post('/oauth/consent', { body: consentBody, token: userToken }),
        { method: 'POST', path: '/oauth/consent', body: consentBody },
      );
      expect(consentRes.status).toBe(302);
      authorizationCode = codeFromLocation(consentRes.headers.get('location')!);
    }
  });

  it('step 6: token exchange with DPoP proof', async () => {
    const tokenUrl = `${BASE_URL}/oauth/token`;
    const dpopProof = await createDPoPProof(dpopKeyPair, 'POST', tokenUrl);

    const body = {
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    };
    const headers = {
      authorization: basicAuth(clientId, clientSecret),
      dpop: dpopProof,
    };
    const res = await flow.step<{
      access_token: string;
      refresh_token: string;
      token_type: string;
      id_token: string;
    }>(
      'Exchange code for DPoP-bound tokens',
      () => api.post('/oauth/token', { body, headers }),
      { method: 'POST', path: '/oauth/token', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.token_type).toBe('DPoP');
    accessToken = res.data.access_token;
    refreshToken = res.data.refresh_token;
    flow.note('token_type is "DPoP" — token is bound to the mobile device\'s key pair');
  });

  it('step 7: verify access token has cnf.jkt claim', async () => {
    const decoded = jose.decodeJwt(accessToken);
    expect(decoded.cnf).toBeDefined();
    expect((decoded.cnf as { jkt: string }).jkt).toBeDefined();
    flow.note(`Access token cnf.jkt = ${(decoded.cnf as { jkt: string }).jkt} (DPoP key thumbprint)`);
  });

  it('step 8: userinfo with DPoP proof', async () => {
    const userinfoUrl = `${BASE_URL}/oauth/userinfo`;
    const dpopProof = await createDPoPProof(dpopKeyPair, 'GET', userinfoUrl, accessToken);

    const headers = {
      authorization: `DPoP ${accessToken}`,
      dpop: dpopProof,
    };
    const res = await flow.step<{ sub: string; email: string }>(
      'Get userinfo with DPoP proof',
      () => api.get('/oauth/userinfo', { headers }),
      { method: 'GET', path: '/oauth/userinfo', headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.email).toBe(userEmail);
  });

  it('step 9: refresh token with DPoP proof (rotation)', async () => {
    const tokenUrl = `${BASE_URL}/oauth/token`;
    const dpopProof = await createDPoPProof(dpopKeyPair, 'POST', tokenUrl);

    const body = { grant_type: 'refresh_token', refresh_token: refreshToken };
    const headers = {
      authorization: basicAuth(clientId, clientSecret),
      dpop: dpopProof,
    };
    const res = await flow.step<{ access_token: string; refresh_token: string }>(
      'Refresh token with DPoP (rotation)',
      () => api.post('/oauth/token', { body, headers }),
      { method: 'POST', path: '/oauth/token', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.access_token).not.toBe(accessToken);
    expect(res.data.refresh_token).not.toBe(refreshToken);
    accessToken = res.data.access_token;
    refreshToken = res.data.refresh_token;
  });

  it('step 10: revoke refresh token', async () => {
    const body = { token: refreshToken };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step(
      'Revoke refresh token',
      () => api.post('/oauth/revoke', { body, headers }),
      { method: 'POST', path: '/oauth/revoke', body, headers },
    );
    expect(res.status).toBe(200);
  });

  it('step 11: verify revoked token is inactive', async () => {
    const body = { token: refreshToken, token_type_hint: 'refresh_token' };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ active: boolean }>(
      'Introspect revoked token',
      () => api.post('/oauth/introspect', { body, headers }),
      { method: 'POST', path: '/oauth/introspect', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.active).toBe(false);
    flow.note('Refresh token revoked — mobile app must clear local storage and re-authenticate');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/messi/Projects/Others/identity-starter && pnpm --filter @identity-starter/e2e test -- --testPathPattern 18-flow-c`

Expected: All steps pass. Step 6 shows `token_type: "DPoP"`. Step 7 confirms `cnf.jkt` in the access token.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/18-flow-c-mobile-oauth-par-dpop.e2e.ts
git commit -m "test(e2e): add Flow C — mobile OAuth with PAR + DPoP"
```

---

### Task 6: Create Flow D test — SPA + BFF (OAuth 2.1)

**Files:**
- Create: `e2e/src/19-flow-d-spa-bff-oauth.e2e.ts`

- [ ] **Step 1: Write the test file**

```ts
// e2e/src/19-flow-d-spa-bff-oauth.e2e.ts
import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_PASSWORD } from './helpers/constants.js';
import { basicAuth, codeFromLocation, pkcePair, uniqueEmail } from './helpers/crypto.js';
import { createFlowLogger } from './helpers/flow-logger.js';
import { api } from './helpers/http-client.js';

const BFF_CALLBACK = 'https://bff.spa-example.com/auth/callback';
const SCOPE = 'openid profile email';

describe('Flow D: SPA + BFF Proxy (OAuth 2.1)', () => {
  const flow = createFlowLogger('Flow D: SPA + BFF Proxy (OAuth 2.1)');
  const userEmail = uniqueEmail('flow-d');
  let adminToken: string;
  let clientId: string;
  let clientSecret: string;
  let userToken: string;
  let codeVerifier: string;
  let codeChallenge: string;
  let state: string;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(() => {
    flow.banner();
    flow.note(
      'In this flow, the BFF (Backend-for-Frontend) proxy handles all OAuth interactions.\n' +
      '  The browser SPA never sees or stores tokens — it only has an httpOnly session cookie to the BFF.\n' +
      '  Server-side, the OAuth calls are identical to Flow A.',
    );
  });

  it('step 1: admin registers BFF as confidential client', async () => {
    const loginBody = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
    const loginRes = await flow.step<{ token: string }>(
      'Admin logs in',
      () => api.post('/api/auth/login', { body: loginBody }),
      { method: 'POST', path: '/api/auth/login', body: loginBody },
    );
    adminToken = loginRes.data.token;

    const clientBody = {
      clientName: 'SPA BFF Proxy (Flow D)',
      redirectUris: [BFF_CALLBACK],
      grantTypes: ['authorization_code', 'refresh_token'],
      scope: SCOPE,
      tokenEndpointAuthMethod: 'client_secret_basic',
      isConfidential: true,
    };
    const clientRes = await flow.step<{ clientId: string; clientSecret: string }>(
      'Register BFF as confidential OAuth client',
      () => api.post('/api/admin/clients', { body: clientBody, token: adminToken }),
      { method: 'POST', path: '/api/admin/clients', body: clientBody },
    );
    expect(clientRes.status).toBe(201);
    clientId = clientRes.data.clientId;
    clientSecret = clientRes.data.clientSecret;
    flow.note('BFF stores client_secret server-side — the SPA JavaScript never has it');
  });

  it('step 2: user registers and logs in', async () => {
    const regBody = { email: userEmail, password: TEST_PASSWORD, displayName: 'Flow D SPA User' };
    const regRes = await flow.step<{ token: string; verificationToken: string }>(
      'User registers',
      () => api.post('/api/auth/register', { body: regBody }),
      { method: 'POST', path: '/api/auth/register', body: regBody },
    );
    expect(regRes.status).toBe(201);

    const verifyBody = { token: regRes.data.verificationToken };
    await flow.step(
      'Verify email',
      () => api.post('/api/auth/verify-email', { body: verifyBody }),
      { method: 'POST', path: '/api/auth/verify-email', body: verifyBody },
    );

    const loginBody = { email: userEmail, password: TEST_PASSWORD };
    const loginRes = await flow.step<{ token: string }>(
      'User logs in',
      () => api.post('/api/auth/login', { body: loginBody }),
      { method: 'POST', path: '/api/auth/login', body: loginBody },
    );
    userToken = loginRes.data.token;
  });

  it('step 3: BFF generates PKCE and initiates authorize (server-side)', async () => {
    flow.note('BFF generates PKCE server-side — the browser only calls GET /bff/login');
    const pkce = pkcePair();
    codeVerifier = pkce.codeVerifier;
    codeChallenge = pkce.codeChallenge;
    state = `state-bff-${Date.now()}`;

    const query = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: BFF_CALLBACK,
      scope: SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    };
    const res = await flow.step<{ type: string }>(
      'BFF initiates authorize',
      () => api.get('/oauth/authorize', { query, token: userToken }),
      { method: 'GET', path: '/oauth/authorize', body: query },
    );
    expect(res.status).toBe(200);
    expect(res.data.type).toBe('consent_required');
  });

  it('step 4: user consents in browser (redirected by BFF)', async () => {
    const body = {
      client_id: clientId,
      scope: SCOPE,
      decision: 'approve',
      state,
      redirect_uri: BFF_CALLBACK,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    };
    const res = await flow.step(
      'User approves consent',
      () => api.post('/oauth/consent', { body, token: userToken }),
      { method: 'POST', path: '/oauth/consent', body },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toContain('bff.spa-example.com');
    const authorizationCode = codeFromLocation(location);

    flow.note('IdP redirects back to BFF callback — browser is just along for the ride');

    // BFF exchanges code server-side
    const tokenBody = {
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: BFF_CALLBACK,
      code_verifier: codeVerifier,
    };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const tokenRes = await flow.step<{
      access_token: string;
      refresh_token: string;
      token_type: string;
    }>(
      'BFF exchanges code for tokens (server-to-server)',
      () => api.post('/oauth/token', { body: tokenBody, headers }),
      { method: 'POST', path: '/oauth/token', body: tokenBody, headers },
    );
    expect(tokenRes.status).toBe(200);
    accessToken = tokenRes.data.access_token;
    refreshToken = tokenRes.data.refresh_token;
    flow.note('BFF stores tokens in server memory, sets httpOnly cookie for browser');
  });

  it('step 5: BFF proxies userinfo request', async () => {
    flow.note('Browser calls GET /bff/api/profile → BFF attaches access_token and calls IdP');
    const headers = { authorization: `Bearer ${accessToken}` };
    const res = await flow.step<{ sub: string; email: string }>(
      'BFF fetches userinfo (on behalf of browser)',
      () => api.get('/oauth/userinfo', { headers }),
      { method: 'GET', path: '/oauth/userinfo', headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.email).toBe(userEmail);
  });

  it('step 6: BFF refreshes token (server-side)', async () => {
    flow.note('Token refresh happens server-side — browser session cookie unchanged');
    const body = { grant_type: 'refresh_token', refresh_token: refreshToken };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ access_token: string; refresh_token: string }>(
      'BFF refreshes token',
      () => api.post('/oauth/token', { body, headers }),
      { method: 'POST', path: '/oauth/token', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.access_token).not.toBe(accessToken);
    refreshToken = res.data.refresh_token;
  });

  it('step 7: BFF revokes token on logout', async () => {
    flow.note('User clicks logout in SPA → BFF revokes tokens and clears session cookie');
    const body = { token: refreshToken, token_type_hint: 'refresh_token' };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step(
      'BFF revokes refresh token',
      () => api.post('/oauth/revoke', { body, headers }),
      { method: 'POST', path: '/oauth/revoke', body, headers },
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/messi/Projects/Others/identity-starter && pnpm --filter @identity-starter/e2e test -- --testPathPattern 19-flow-d`

Expected: All steps pass. Console notes explain the BFF/browser boundary at each step.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/19-flow-d-spa-bff-oauth.e2e.ts
git commit -m "test(e2e): add Flow D — SPA + BFF proxy OAuth flow"
```

---

### Task 7: Create Flow E test — Admin Dashboard

**Files:**
- Create: `e2e/src/20-flow-e-admin-dashboard.e2e.ts`

- [ ] **Step 1: Write the test file**

```ts
// e2e/src/20-flow-e-admin-dashboard.e2e.ts
import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { createFlowLogger } from './helpers/flow-logger.js';
import { api } from './helpers/http-client.js';

const REDIRECT_URI = 'https://example.com/callback';

describe('Flow E: Admin Dashboard', () => {
  const flow = createFlowLogger('Flow E: Admin Dashboard');
  let adminToken: string;
  let clientId: string;
  let targetUserId: string;
  let targetSessionToken: string;
  let createdRoleId: string;

  beforeAll(() => {
    flow.banner();
  });

  // --- ADMIN LOGIN ---

  it('step 1: admin logs in', async () => {
    const body = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
    const res = await flow.step<{ token: string }>(
      'Admin logs in',
      () => api.post('/api/auth/login', { body }),
      { method: 'POST', path: '/api/auth/login', body },
    );
    expect(res.status).toBe(200);
    adminToken = res.data.token;
  });

  // --- CLIENT MANAGEMENT ---

  it('step 2: create OAuth client', async () => {
    const body = {
      clientName: 'Flow E Test Client',
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      scope: 'openid profile',
      tokenEndpointAuthMethod: 'client_secret_basic',
      isConfidential: true,
    };
    const res = await flow.step<{ clientId: string; clientSecret: string }>(
      'Create OAuth client',
      () => api.post('/api/admin/clients', { body, token: adminToken }),
      { method: 'POST', path: '/api/admin/clients', body },
    );
    expect(res.status).toBe(201);
    clientId = res.data.clientId;
  });

  it('step 3: list clients', async () => {
    const res = await flow.step<Array<{ clientId: string; clientName: string }>>(
      'List all OAuth clients',
      () => api.get('/api/admin/clients', { token: adminToken }),
      { method: 'GET', path: '/api/admin/clients' },
    );
    expect(res.status).toBe(200);
  });

  it('step 4: get client by ID', async () => {
    const res = await flow.step<{ clientId: string; clientName: string }>(
      'Get client details',
      () => api.get(`/api/admin/clients/${clientId}`, { token: adminToken }),
      { method: 'GET', path: `/api/admin/clients/${clientId}` },
    );
    expect(res.status).toBe(200);
    expect(res.data.clientName).toBe('Flow E Test Client');
  });

  it('step 5: update client', async () => {
    const body = { clientName: 'Flow E Updated Client' };
    const res = await flow.step<{ clientName: string }>(
      'Update client name',
      () => api.patch(`/api/admin/clients/${clientId}`, { body, token: adminToken }),
      { method: 'PATCH', path: `/api/admin/clients/${clientId}`, body },
    );
    expect(res.status).toBe(200);
    expect(res.data.clientName).toBe('Flow E Updated Client');
  });

  it('step 6: rotate client secret', async () => {
    const res = await flow.step<{ clientSecret: string }>(
      'Rotate client secret',
      () => api.post(`/api/admin/clients/${clientId}/rotate-secret`, { token: adminToken }),
      { method: 'POST', path: `/api/admin/clients/${clientId}/rotate-secret` },
    );
    expect(res.status).toBe(200);
    expect(res.data.clientSecret).toBeDefined();
  });

  it('step 7: delete client', async () => {
    const res = await flow.step(
      'Delete OAuth client',
      () => api.delete(`/api/admin/clients/${clientId}`, { token: adminToken }),
      { method: 'DELETE', path: `/api/admin/clients/${clientId}` },
    );
    expect(res.status).toBe(204);
  });

  // --- USER MANAGEMENT ---

  it('step 8: register target user', async () => {
    const email = uniqueEmail('flow-e-target');
    const body = { email, password: TEST_PASSWORD, displayName: 'Flow E Target' };
    const res = await flow.step<{ token: string; user: { id: string } }>(
      'Register target user',
      () => api.post('/api/auth/register', { body }),
      { method: 'POST', path: '/api/auth/register', body },
    );
    expect(res.status).toBe(201);
    targetUserId = res.data.user.id;
    targetSessionToken = res.data.token;
  });

  it('step 9: list users', async () => {
    const res = await flow.step<{ data: unknown[]; total: number }>(
      'List users (paginated)',
      () => api.get('/api/admin/users', { token: adminToken }),
      { method: 'GET', path: '/api/admin/users' },
    );
    expect(res.status).toBe(200);
    expect(res.data.total).toBeGreaterThanOrEqual(2);
  });

  it('step 10: get user by ID', async () => {
    const res = await flow.step<{ id: string; email: string }>(
      'Get user details',
      () => api.get(`/api/admin/users/${targetUserId}`, { token: adminToken }),
      { method: 'GET', path: `/api/admin/users/${targetUserId}` },
    );
    expect(res.status).toBe(200);
    expect(res.data.id).toBe(targetUserId);
  });

  it('step 11: suspend user', async () => {
    const body = { status: 'suspended' };
    const res = await flow.step<{ status: string }>(
      'Suspend user',
      () => api.patch(`/api/admin/users/${targetUserId}/status`, { body, token: adminToken }),
      { method: 'PATCH', path: `/api/admin/users/${targetUserId}/status`, body },
    );
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('suspended');
  });

  it('step 12: reactivate user', async () => {
    const body = { status: 'active' };
    const res = await flow.step<{ status: string }>(
      'Reactivate user',
      () => api.patch(`/api/admin/users/${targetUserId}/status`, { body, token: adminToken }),
      { method: 'PATCH', path: `/api/admin/users/${targetUserId}/status`, body },
    );
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('active');
  });

  // --- RBAC ---

  it('step 13: create role', async () => {
    const body = { name: `flow_e_role_${Date.now()}` };
    const res = await flow.step<{ id: string; name: string }>(
      'Create RBAC role',
      () => api.post('/api/admin/roles', { body, token: adminToken }),
      { method: 'POST', path: '/api/admin/roles', body },
    );
    expect(res.status).toBe(201);
    createdRoleId = res.data.id;
  });

  it('step 14: list roles', async () => {
    const res = await flow.step<Array<{ id: string; name: string }>>(
      'List roles + permissions',
      () => api.get('/api/admin/roles', { token: adminToken }),
      { method: 'GET', path: '/api/admin/roles' },
    );
    expect(res.status).toBe(200);
    expect(res.data.length).toBeGreaterThanOrEqual(4);
  });

  it('step 15: assign role to user', async () => {
    const body = { roleId: createdRoleId };
    const res = await flow.step(
      'Assign role to user',
      () => api.post(`/api/admin/users/${targetUserId}/roles`, { body, token: adminToken }),
      { method: 'POST', path: `/api/admin/users/${targetUserId}/roles`, body },
    );
    expect(res.status).toBe(201);
  });

  it('step 16: remove role from user', async () => {
    const res = await flow.step(
      'Remove role from user',
      () => api.delete(`/api/admin/users/${targetUserId}/roles/${createdRoleId}`, { token: adminToken }),
      { method: 'DELETE', path: `/api/admin/users/${targetUserId}/roles/${createdRoleId}` },
    );
    expect(res.status).toBe(204);
  });

  // --- SESSION OVERSIGHT ---

  it('step 17: list all sessions', async () => {
    const res = await flow.step<{ data: Array<{ id: string }> }>(
      'List all sessions',
      () => api.get('/api/admin/sessions', { token: adminToken }),
      { method: 'GET', path: '/api/admin/sessions' },
    );
    expect(res.status).toBe(200);
    expect(res.data.data.length).toBeGreaterThanOrEqual(1);
  });

  it('step 18: bulk revoke target user sessions', async () => {
    const res = await flow.step(
      'Bulk revoke user sessions',
      () => api.delete(`/api/admin/users/${targetUserId}/sessions`, { token: adminToken }),
      { method: 'DELETE', path: `/api/admin/users/${targetUserId}/sessions` },
    );
    expect(res.status).toBe(200);
    flow.note('All of target user\'s sessions revoked — they are now logged out everywhere');
  });

  // --- AUDIT ---

  it('step 19: query audit logs', async () => {
    const res = await flow.step<{ data: Array<{ action: string }>; total: number }>(
      'Query audit logs',
      () => api.get('/api/admin/audit-logs', { token: adminToken }),
      { method: 'GET', path: '/api/admin/audit-logs' },
    );
    expect(res.status).toBe(200);
    expect(res.data.total).toBeGreaterThan(0);
  });

  it('step 20: verify audit chain integrity', async () => {
    const res = await flow.step<{ valid: boolean; totalEntries: number }>(
      'Verify audit hash chain',
      () => api.get('/api/admin/audit-logs/verify', { token: adminToken }),
      { method: 'GET', path: '/api/admin/audit-logs/verify' },
    );
    expect(res.status).toBe(200);
    expect(res.data.valid).toBe(true);
  });

  it('step 21: export audit logs (NDJSON)', async () => {
    const res = await flow.step<string>(
      'Export audit logs',
      () => api.get('/api/admin/audit-logs/export', { token: adminToken }),
      { method: 'GET', path: '/api/admin/audit-logs/export' },
    );
    expect(res.status).toBe(200);
    const lines = (res.data as string).split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    flow.note(`Exported ${lines.length} audit log entries as NDJSON`);
  });

  // --- LOGOUT ---

  it('step 22: admin logs out', async () => {
    const res = await flow.step(
      'Admin logs out',
      () => api.post('/api/auth/logout', { token: adminToken }),
      { method: 'POST', path: '/api/auth/logout' },
    );
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/messi/Projects/Others/identity-starter && pnpm --filter @identity-starter/e2e test -- --testPathPattern 20-flow-e`

Expected: All 22 steps pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/20-flow-e-admin-dashboard.e2e.ts
git commit -m "test(e2e): add Flow E — admin dashboard full lifecycle"
```

---

### Task 8: Create Flow F test — Service-to-Service (Client Credentials)

**Files:**
- Create: `e2e/src/21-flow-f-service-to-service.e2e.ts`

- [ ] **Step 1: Write the test file**

```ts
// e2e/src/21-flow-f-service-to-service.e2e.ts
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/constants.js';
import { basicAuth } from './helpers/crypto.js';
import { createFlowLogger } from './helpers/flow-logger.js';
import { api } from './helpers/http-client.js';

describe('Flow F: Service-to-Service (Client Credentials)', () => {
  const flow = createFlowLogger('Flow F: Service-to-Service (Client Credentials)');
  let adminToken: string;
  let clientId: string;
  let clientSecret: string;
  let accessToken: string;

  beforeAll(() => {
    flow.banner();
    flow.note(
      'No human user involved. A backend service authenticates with its own\n' +
      '  client_id + client_secret to get an access token for machine-to-machine API calls.',
    );
  });

  it('step 1: admin registers a confidential service client', async () => {
    const loginBody = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
    const loginRes = await flow.step<{ token: string }>(
      'Admin logs in',
      () => api.post('/api/auth/login', { body: loginBody }),
      { method: 'POST', path: '/api/auth/login', body: loginBody },
    );
    adminToken = loginRes.data.token;

    const clientBody = {
      clientName: 'Cron Service (Flow F)',
      redirectUris: [],
      grantTypes: ['client_credentials'],
      scope: 'openid',
      tokenEndpointAuthMethod: 'client_secret_basic',
      isConfidential: true,
    };
    const clientRes = await flow.step<{ clientId: string; clientSecret: string }>(
      'Register service client',
      () => api.post('/api/admin/clients', { body: clientBody, token: adminToken }),
      { method: 'POST', path: '/api/admin/clients', body: clientBody },
    );
    expect(clientRes.status).toBe(201);
    clientId = clientRes.data.clientId;
    clientSecret = clientRes.data.clientSecret;
  });

  it('step 2: service authenticates via client_credentials grant', async () => {
    const body = { grant_type: 'client_credentials' };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token?: string;
      id_token?: string;
      scope: string;
    }>(
      'Client credentials token request',
      () => api.post('/oauth/token', { body, headers }),
      { method: 'POST', path: '/oauth/token', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.token_type).toBe('Bearer');
    expect(res.data.access_token).toBeDefined();
    expect(res.data.refresh_token).toBeUndefined();
    expect(res.data.id_token).toBeUndefined();
    accessToken = res.data.access_token;
    flow.note('No refresh_token or id_token — client_credentials has no user context');
  });

  it('step 3: introspect service token (active)', async () => {
    const body = { token: accessToken };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ active: boolean; client_id: string }>(
      'Introspect service access token',
      () => api.post('/oauth/introspect', { body, headers }),
      { method: 'POST', path: '/oauth/introspect', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.active).toBe(true);
  });

  it('step 4: revoke service token', async () => {
    const body = { token: accessToken };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step(
      'Revoke access token',
      () => api.post('/oauth/revoke', { body, headers }),
      { method: 'POST', path: '/oauth/revoke', body, headers },
    );
    expect(res.status).toBe(200);
  });

  it('step 5: re-authenticate (get new token)', async () => {
    flow.note('Token expired or revoked? Just request a new one — no refresh needed');
    const body = { grant_type: 'client_credentials' };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ access_token: string }>(
      'Re-authenticate with client_credentials',
      () => api.post('/oauth/token', { body, headers }),
      { method: 'POST', path: '/oauth/token', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.access_token).toBeDefined();
    expect(res.data.access_token).not.toBe(accessToken);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/messi/Projects/Others/identity-starter && pnpm --filter @identity-starter/e2e test -- --testPathPattern 21-flow-f`

Expected: All 5 steps pass. Step 2 confirms no refresh_token/id_token in response.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/21-flow-f-service-to-service.e2e.ts
git commit -m "test(e2e): add Flow F — service-to-service client credentials"
```

---

### Task 9: Run all flow tests together and verify

- [ ] **Step 1: Run all 6 flow tests**

Run: `cd /Users/messi/Projects/Others/identity-starter && pnpm --filter @identity-starter/e2e test -- --testPathPattern '(16|17|18|19|20|21)-flow'`

Expected: All tests pass. Console output shows formatted banners and tables for each flow.

- [ ] **Step 2: Run lint**

Run: `cd /Users/messi/Projects/Others/identity-starter && pnpm biome check e2e/src/`

Expected: Zero errors. If there are lint issues, fix them.

- [ ] **Step 3: Final commit (if lint fixes needed)**

```bash
git add e2e/src/
git commit -m "fix(e2e): lint fixes for flow tests"
```
