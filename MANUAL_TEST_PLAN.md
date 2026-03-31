# Manual Test Plan — Identity Starter

## Prerequisites & Local Setup

### Start Infrastructure

```bash
# Terminal 1: Start Postgres + Redis
docker compose up postgres redis

# Terminal 2: Install deps, migrate, seed
pnpm install
pnpm db:migrate
pnpm db:seed

# Terminal 3: Start API server (port 3001)
pnpm --filter server dev

# Terminal 4: Start web app (port 3100)
pnpm --filter web dev

# Terminal 5: Start admin dashboard (port 3002)
pnpm --filter admin dev
```

### Seeded Data

| Entity | Value |
|--------|-------|
| Admin email | `admin@idp.local` |
| Admin password | `Admin123!` |
| Admin roles | `super_admin`, `admin` |
| OAuth client ID | `admin-dashboard` |
| OAuth client secret | `admin-dashboard-dev-secret` |

### URLs

| App | URL |
|-----|-----|
| Web (user-facing) | http://localhost:3100 |
| Admin dashboard | http://localhost:3002 |
| API server | http://localhost:3001 |

---

## PART 1: WEB APP (http://localhost:3100)

### 1.1 Home Page Redirect

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 1.1.1 | Unauthenticated redirect | Open http://localhost:3100 | Redirects to `/login` |
| 1.1.2 | Authenticated redirect | Login first, then visit http://localhost:3100 | Redirects to `/account` |

---

### 1.2 User Registration

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 1.2.1 | Successful registration | Go to `/register`, fill: Display Name=`Test User`, Email=`test@example.com`, Password=`Password123!`, submit | Success, redirected to `/verify-email` |
| 1.2.2 | Missing display name | Submit register form with empty display name | Validation error on display name field |
| 1.2.3 | Invalid email | Enter `not-an-email` as email | Validation error on email field |
| 1.2.4 | Short password | Enter password `abc` (less than 8 chars) | Validation error: password must be 8+ characters |
| 1.2.5 | Duplicate email | Register with `admin@idp.local` (already exists) | API error: email already registered |
| 1.2.6 | Navigate to login | Click "Sign in" link on register page | Navigates to `/login` page |

---

### 1.3 Email Verification

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 1.3.1 | Verify email page loads | After registration, verify you're on `/verify-email` | Page shows verification instructions |
| 1.3.2 | Verify with token (dev) | In dev mode, check server logs for verification token. Visit `/verify-email?token=<token>` | Email verified, redirected to `/account` |
| 1.3.3 | Resend verification | On `/verify-email`, click resend button | Toast: verification email resent |
| 1.3.4 | Invalid token | Visit `/verify-email?token=invalid-token` | Error message: invalid or expired token |

---

### 1.4 Login

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 1.4.1 | Successful login | Go to `/login`, enter `admin@idp.local` / `Admin123!`, submit | Redirected to `/account` |
| 1.4.2 | Wrong password | Enter `admin@idp.local` / `wrongpassword` | Error: invalid credentials |
| 1.4.3 | Non-existent email | Enter `nobody@example.com` / `anything` | Error: invalid credentials (no enumeration) |
| 1.4.4 | Empty form submission | Click submit with empty fields | Validation errors on both fields |
| 1.4.5 | Unverified user login | Register new user (don't verify email), try to login | Should either block or allow with limited access |
| 1.4.6 | Navigate to register | Click "Create an account" link | Navigates to `/register` |
| 1.4.7 | Navigate to forgot password | Click "Forgot password?" link | Navigates to `/forgot-password` |

---

### 1.5 MFA (Two-Factor Authentication)

> **Setup:** First enable TOTP via API (see Part 3, test 3.5.1), then test login flow.

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 1.5.1 | MFA challenge on login | Login with MFA-enabled account | Redirected to `/mfa` page with TOTP input |
| 1.5.2 | Valid TOTP code | Enter valid 6-digit code from authenticator app | Login succeeds, redirected to `/account` |
| 1.5.3 | Invalid TOTP code | Enter `000000` as TOTP code | Error: invalid code |
| 1.5.4 | Switch to recovery mode | Click "Use recovery code" toggle on MFA page | Form switches to recovery code input |
| 1.5.5 | Valid recovery code | Enter a valid recovery code (from enrollment) | Login succeeds, redirected to `/account` |
| 1.5.6 | Invalid recovery code | Enter `XXXX-XXXX` as recovery code | Error: invalid recovery code |
| 1.5.7 | Used recovery code | Re-use a recovery code already consumed | Error: code already used |

---

### 1.6 Passkey Authentication

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 1.6.1 | Passkey autofill | Visit `/login` in a browser supporting WebAuthn | Passkey autofill UI appears (if credentials exist) |
| 1.6.2 | Register passkey (API) | While logged in, call `POST /api/auth/passkeys/register/options`, complete ceremony, call `POST /api/auth/passkeys/register/verify` | Passkey registered successfully |
| 1.6.3 | Login with passkey | After registering passkey, logout, use passkey to login | Login succeeds, redirected to `/account` |

---

### 1.7 Forgot Password

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 1.7.1 | Request reset | Go to `/forgot-password`, enter `admin@idp.local`, submit | Success message (check server logs for token) |
| 1.7.2 | Non-existent email | Enter `nobody@test.com`, submit | Same success message (no enumeration) |
| 1.7.3 | Empty email | Submit with empty email | Validation error on email field |

---

### 1.8 Reset Password

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 1.8.1 | Valid reset | Get reset token from server logs. Go to `/reset-password?token=<token>`, enter new password + confirm | Password reset, redirected to `/login` |
| 1.8.2 | Password mismatch | Enter different passwords in both fields | Validation error: passwords don't match |
| 1.8.3 | Short password | Enter 4-char password | Validation error: password must be 8+ characters |
| 1.8.4 | Invalid token | Visit `/reset-password?token=bad-token`, submit valid passwords | Error: invalid or expired token |
| 1.8.5 | Expired token | Wait >1 hour (or manually expire in DB), try reset | Error: token expired |

---

### 1.9 Account Profile

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 1.9.1 | View profile | Login, go to `/account` | Shows display name, email, email verified status, account status, creation date |
| 1.9.2 | Logout | Click logout button on profile page | Session ended, redirected to `/login` |
| 1.9.3 | Protected route | Clear cookies, visit `/account` directly | Redirected to `/login?callbackUrl=/account` |
| 1.9.4 | Callback after login | After redirect from 1.9.3, login successfully | Redirected back to `/account` (not default page) |

---

### 1.10 OAuth Consent Flow

> **Setup:** Requires a third-party OAuth client configured in the system.

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 1.10.1 | Consent page loads | Navigate to `/oauth/authorize?client_id=admin-dashboard&response_type=code&redirect_uri=http://localhost:3002/auth/callback&scope=openid profile email&state=test123&code_challenge=<challenge>&code_challenge_method=S256` (logged in) | Consent page shows client name, requested scopes |
| 1.10.2 | Approve consent | Click "Approve" on consent page | Redirected to client's redirect_uri with `?code=...&state=test123` |
| 1.10.3 | Deny consent | Click "Deny" on consent page | Redirected to client's redirect_uri with error |
| 1.10.4 | Unauthenticated consent | Visit authorize URL without session | Redirected to `/login` with callbackUrl to consent |

---

## PART 2: ADMIN DASHBOARD (http://localhost:3002)

### 2.1 Authentication (OAuth Flow)

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 2.1.1 | Login page redirect | Visit http://localhost:3002 without session | Redirected to `/auth/login` which initiates OAuth flow to web app |
| 2.1.2 | OAuth login flow | Follow the OAuth redirect, login with `admin@idp.local` / `Admin123!` | After consent/auto-consent, redirected back to admin `/users` page |
| 2.1.3 | Non-admin access | Login with a regular user (no admin role) | Access denied or redirected (admin role required) |
| 2.1.4 | Logout | Click logout in sidebar | Session cleared, redirected to login |

---

### 2.2 User Management

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 2.2.1 | User list loads | After login, verify `/users` page | Table shows users with: email, name, status, created date |
| 2.2.2 | Pagination | If >20 users exist, click page 2 | Shows next set of users, URL has `?page=2` |
| 2.2.3 | Search by email | Type `admin` in email search box | Table filters to show only matching users (after 300ms debounce) |
| 2.2.4 | Clear search | Clear the search box | All users shown again |
| 2.2.5 | Filter by status (active) | Select "Active" from status dropdown | Only active users shown, URL has `?status=active` |
| 2.2.6 | Filter by status (suspended) | Select "Suspended" from status dropdown | Only suspended users shown (may be empty) |
| 2.2.7 | Filter by status (pending) | Select "Pending Verification" from status dropdown | Only pending users shown |
| 2.2.8 | Combined filter | Search `test` + filter status `active` | Shows only active users with `test` in email |
| 2.2.9 | Clear all filters | Click clear/reset button | All filters removed, full list shown |

---

### 2.3 User Detail & Status Management

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 2.3.1 | Open user detail | Click on a user email in the list | Navigates to `/users/<id>`, shows user details |
| 2.3.2 | User info display | View detail page | Shows: email, display name, status, email verification, created date |
| 2.3.3 | Suspend user | Click "Suspend" button on an active user | User status changes to `suspended`, toast confirmation |
| 2.3.4 | Activate user | Click "Activate" on a suspended user | User status changes to `active`, toast confirmation |
| 2.3.5 | Verify suspended login | After suspending a user, try to login as that user in web app | Login should be blocked (account suspended) |

---

### 2.4 Role Management (User Detail)

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 2.4.1 | View assigned roles | On user detail page, check roles section | Shows list of roles assigned to user |
| 2.4.2 | Assign role | Select a role from dropdown, click assign | Role added to user, appears in list |
| 2.4.3 | Remove role | Click remove/delete button on an assigned role | Role removed from user |
| 2.4.4 | Prevent system role removal | Try to remove `super_admin` from the seed admin user | Should show warning or prevent if last admin |

---

### 2.5 Role List & Creation

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 2.5.1 | Role list loads | Navigate to `/roles` via sidebar | Table shows roles: name, description, permission count, type badge |
| 2.5.2 | System roles visible | Check the roles table | `super_admin`, `admin`, `user` shown with "System" badge |
| 2.5.3 | Create role dialog | Click "Create Role" button | Dialog opens with name and description fields |
| 2.5.4 | Create valid role | Enter Name=`editor`, Description=`Can edit content`, submit | Role created, appears in table, toast confirmation |
| 2.5.5 | Create without name | Submit dialog with empty name | Validation error: name required |
| 2.5.6 | Duplicate role name | Create role with same name as existing | API error: role already exists |

---

### 2.6 Session Management

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 2.6.1 | Session list loads | Navigate to `/sessions` via sidebar | Table shows: user ID, IP address, user agent, last active, created |
| 2.6.2 | Active sessions visible | Check that your current session appears | At least one session for `admin@idp.local` visible |
| 2.6.3 | Pagination | If >20 sessions, navigate pages | Pagination works, URL updates with `?page=N` |
| 2.6.4 | Revoke session | Click revoke/delete button on a session (not your own admin session) | Session removed from list, toast confirmation |
| 2.6.5 | Revoke own session impact | Revoke the web app session of admin, check web app | Web app should require re-login |

---

### 2.7 Audit Logs

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 2.7.1 | Audit log list loads | Navigate to `/audit-logs` via sidebar | Table shows: timestamp, action, resource type+ID, actor ID, IP |
| 2.7.2 | Entries from actions | After performing user status change or role assignment | New audit log entries visible for those actions |
| 2.7.3 | Search by action | Type `user.status` in action search | Filters to matching audit entries |
| 2.7.4 | Filter by resource type | Select "User" from resource type dropdown | Shows only user-related audit entries |
| 2.7.5 | Pagination | Navigate audit log pages (50/page) | Pagination works correctly |
| 2.7.6 | Chain verification | Check chain verification status on page | Shows integrity status (valid/invalid) |
| 2.7.7 | Export NDJSON | Click export button | Downloads `.ndjson` file with audit entries matching current filters |
| 2.7.8 | Export with filters | Apply filter, then export | Exported file only contains filtered entries |

---

### 2.8 Admin Sidebar Navigation

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 2.8.1 | Sidebar visible | Login to admin | Sidebar shows: Users, Roles, Sessions, Audit Logs + user profile |
| 2.8.2 | Navigate Users | Click "Users" in sidebar | Navigates to `/users` |
| 2.8.3 | Navigate Roles | Click "Roles" in sidebar | Navigates to `/roles` |
| 2.8.4 | Navigate Sessions | Click "Sessions" in sidebar | Navigates to `/sessions` |
| 2.8.5 | Navigate Audit Logs | Click "Audit Logs" in sidebar | Navigates to `/audit-logs` |
| 2.8.6 | Active state | Click each nav item | Active item is visually highlighted |

---

## PART 3: API TESTING (http://localhost:3001)

> Use `curl`, Postman, or any HTTP client. Replace `<session_token>` with actual token from login.

### 3.1 Auth — Registration & Login

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.1.1 | Register user | `POST /api/auth/register` body: `{"email":"api-test@test.com","password":"Test1234!","displayName":"API Test"}` | 201, returns `{token, user}` + `verificationToken` in dev |
| 3.1.2 | Register duplicate | Same request again | 409 Conflict, error: email already exists |
| 3.1.3 | Register invalid email | Body: `{"email":"bad","password":"Test1234!","displayName":"X"}` | 400, validation error on email |
| 3.1.4 | Login valid | `POST /api/auth/login` body: `{"email":"admin@idp.local","password":"Admin123!"}` | 200, returns `{token, user}` |
| 3.1.5 | Login wrong password | Body: `{"email":"admin@idp.local","password":"wrong"}` | 401, invalid credentials |
| 3.1.6 | Login non-existent | Body: `{"email":"ghost@test.com","password":"any"}` | 401, invalid credentials |
| 3.1.7 | Rate limiting | Send 11+ login requests in 15 minutes | 429 Too Many Requests |

---

### 3.2 Auth — Email Verification

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.2.1 | Verify email | `POST /api/auth/verify-email` body: `{"token":"<token_from_register>"}` | 200, email verified |
| 3.2.2 | Invalid token | Body: `{"token":"invalid"}` | 400 or 404, invalid token |
| 3.2.3 | Resend verification | `POST /api/auth/resend-verification` body: `{"email":"api-test@test.com"}` | 200, new token sent |
| 3.2.4 | Resend rate limit | Send 4+ resend requests in 15 minutes | 429 Too Many Requests |

---

### 3.3 Auth — Password Management

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.3.1 | Change password | `POST /api/auth/change-password` with session, body: `{"currentPassword":"Admin123!","newPassword":"NewPass123!"}` | 200, password changed |
| 3.3.2 | Change wrong current | Body with wrong `currentPassword` | 401, current password incorrect |
| 3.3.3 | Forgot password | `POST /api/auth/forgot-password` body: `{"email":"admin@idp.local"}` | 200 (always succeeds, no enumeration) |
| 3.3.4 | Reset password | `POST /api/auth/reset-password` body: `{"token":"<token>","password":"Reset123!"}` | 200, password reset |
| 3.3.5 | Reset invalid token | Body: `{"token":"bad","password":"Reset123!"}` | 400, invalid token |

---

### 3.4 Auth — Session Management

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.4.1 | Logout | `POST /api/auth/logout` with session cookie/token | 200, session revoked |
| 3.4.2 | Use revoked session | Make any authenticated request with revoked token | 401, session expired/invalid |
| 3.4.3 | List my sessions | `GET /api/account/sessions` with session | 200, array of sessions with IP, userAgent, timestamps |
| 3.4.4 | Revoke specific session | `DELETE /api/account/sessions/<sessionId>` | 200, session revoked |

---

### 3.5 MFA — TOTP Management

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.5.1 | Enroll TOTP | `POST /api/account/mfa/totp/enroll` with session | 200, returns `{otpauthUri, recoveryCodes[8]}` |
| 3.5.2 | Verify TOTP enrollment | `POST /api/account/mfa/totp/verify` body: `{"code":"<6-digit-from-app>"}` | 200, TOTP enabled |
| 3.5.3 | Login with MFA | `POST /api/auth/login` with MFA-enrolled account | 200, returns `{mfaRequired:true, mfaToken:"..."}` |
| 3.5.4 | Complete MFA challenge | `POST /api/auth/mfa/verify` body: `{"mfaToken":"...","code":"<6-digit>"}` | 200, returns `{token, user}` |
| 3.5.5 | MFA with recovery code | `POST /api/auth/mfa/verify` body: `{"mfaToken":"...","recoveryCode":"XXXX-XXXX"}` | 200, returns `{token, user}` |
| 3.5.6 | Disable TOTP | `DELETE /api/account/mfa/totp` body: `{"password":"..."}` | 200, TOTP disabled |
| 3.5.7 | Regenerate recovery codes | `POST /api/account/mfa/recovery-codes/regenerate` body: `{"password":"..."}` | 200, new set of 8 codes |
| 3.5.8 | Enroll rate limit | 11+ enroll requests in 15 min | 429 Too Many Requests |

---

### 3.6 Passkeys (WebAuthn)

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.6.1 | Get registration options | `POST /api/auth/passkeys/register/options` with session | 200, returns WebAuthn registration options |
| 3.6.2 | Verify registration | `POST /api/auth/passkeys/register/verify` with attestation response | 200, passkey registered |
| 3.6.3 | Get login options | `POST /api/auth/passkeys/login/options` | 200, returns authentication challenge |
| 3.6.4 | Verify login | `POST /api/auth/passkeys/login/verify` with assertion response | 200, returns session token |
| 3.6.5 | List my passkeys | `GET /api/account/passkeys` with session | 200, array of passkeys with names, device types |
| 3.6.6 | Rename passkey | `PATCH /api/account/passkeys/<id>` body: `{"name":"My Yubikey"}` | 200, name updated |
| 3.6.7 | Delete passkey | `DELETE /api/account/passkeys/<id>` | 200, passkey removed |

---

### 3.7 Account Profile

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.7.1 | Get profile | `GET /api/account/profile` with session | 200, returns `{id, email, displayName, status, emailVerified, createdAt}` |
| 3.7.2 | Update display name | `PATCH /api/account/profile` body: `{"displayName":"New Name"}` | 200, name updated |
| 3.7.3 | Update metadata | `PATCH /api/account/profile` body: `{"metadata":{"key":"value"}}` | 200, metadata updated |
| 3.7.4 | Unauthenticated access | `GET /api/account/profile` without session | 401 Unauthorized |

---

### 3.8 OAuth2 / OIDC

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.8.1 | Discovery endpoint | `GET /.well-known/openid-configuration` | 200, JSON with issuer, endpoints, supported flows |
| 3.8.2 | JWKS endpoint | `GET /.well-known/jwks.json` | 200, JSON with signing keys |
| 3.8.3 | PAR request | `POST /oauth/par` with client auth + redirect_uri, scope, code_challenge | 200, returns `{request_uri, expires_in}` |
| 3.8.4 | Authorization endpoint | `GET /oauth/authorize?response_type=code&client_id=admin-dashboard&redirect_uri=http://localhost:3002/auth/callback&scope=openid&code_challenge=...&code_challenge_method=S256` with session | 302 redirect to consent or redirect_uri |
| 3.8.5 | Token exchange | `POST /oauth/token` with `grant_type=authorization_code&code=...&code_verifier=...&redirect_uri=...` + client auth | 200, returns `{access_token, id_token, refresh_token, expires_in}` |
| 3.8.6 | Refresh token | `POST /oauth/token` with `grant_type=refresh_token&refresh_token=...` + client auth | 200, new access_token + id_token |
| 3.8.7 | Client credentials | `POST /oauth/token` with `grant_type=client_credentials` + client auth | 200, returns access_token |
| 3.8.8 | Token introspection | `POST /oauth/introspect` body: `{"token":"<access_token>"}` + client auth | 200, returns `{active:true, ...claims}` |
| 3.8.9 | Token revocation | `POST /oauth/revoke` body: `{"token":"<token>"}` + client auth | 200, token revoked |
| 3.8.10 | Userinfo endpoint | `GET /oauth/userinfo` with `Authorization: Bearer <access_token>` | 200, returns user claims based on scopes |
| 3.8.11 | Invalid client | Token request with wrong client_secret | 401, invalid client |
| 3.8.12 | Invalid PKCE | Token exchange with wrong code_verifier | 400, invalid code_verifier |
| 3.8.13 | Expired auth code | Wait >10 min, try token exchange | 400, code expired |
| 3.8.14 | Rate limit on token | 61+ token requests in 1 minute | 429 Too Many Requests |

---

### 3.9 Admin — User Management API

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.9.1 | List users | `GET /api/admin/users` with admin session | 200, paginated user list |
| 3.9.2 | List with pagination | `GET /api/admin/users?page=1&limit=5` | 200, max 5 users, total count in response |
| 3.9.3 | Filter by status | `GET /api/admin/users?status=active` | 200, only active users |
| 3.9.4 | Filter by email | `GET /api/admin/users?email=admin` | 200, matching users |
| 3.9.5 | Get user detail | `GET /api/admin/users/<userId>` | 200, user details + MFA status |
| 3.9.6 | Update user status | `PATCH /api/admin/users/<userId>/status` body: `{"status":"suspended"}` | 200, status updated |
| 3.9.7 | Bulk revoke sessions | `DELETE /api/admin/users/<userId>/sessions` | 200, all user sessions revoked |
| 3.9.8 | Non-admin access | Make admin API request with regular user session | 403 Forbidden |

---

### 3.10 Admin — Role Management API

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.10.1 | List roles | `GET /api/admin/roles` with admin session | 200, all roles with permission counts |
| 3.10.2 | Create role | `POST /api/admin/roles` body: `{"name":"api-test-role","description":"Test"}` | 201, role created |
| 3.10.3 | Set permissions | `PUT /api/admin/roles/<roleId>/permissions` body: `{"permissions":["users:read"]}` | 200, permissions set |
| 3.10.4 | Assign role to user | `POST /api/admin/users/<userId>/roles` body: `{"roleId":"<roleId>"}` | 200, role assigned |
| 3.10.5 | Remove role from user | `DELETE /api/admin/users/<userId>/roles/<roleId>` | 200, role removed |
| 3.10.6 | Duplicate role name | Create role with existing name | 409, already exists |

---

### 3.11 Admin — Session Management API

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.11.1 | List all sessions | `GET /api/admin/sessions` with admin session | 200, paginated session list |
| 3.11.2 | Paginate sessions | `GET /api/admin/sessions?page=1&limit=10` | 200, paginated result |
| 3.11.3 | Revoke session | `DELETE /api/admin/sessions/<sessionId>` | 200, session revoked |

---

### 3.12 Admin — Audit Log API

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.12.1 | Query audit logs | `GET /api/admin/audit-logs` with admin session | 200, paginated audit entries |
| 3.12.2 | Filter by action | `GET /api/admin/audit-logs?action=user.status.updated` | 200, matching entries |
| 3.12.3 | Filter by resource | `GET /api/admin/audit-logs?resourceType=user` | 200, user-related entries |
| 3.12.4 | Filter by actor | `GET /api/admin/audit-logs?actorId=<userId>` | 200, entries by that actor |
| 3.12.5 | Filter by date range | `GET /api/admin/audit-logs?from=2024-01-01&to=2026-12-31` | 200, entries in range |
| 3.12.6 | Verify chain integrity | `GET /api/admin/audit-logs/verify` | 200, `{valid: true/false}` |
| 3.12.7 | Export NDJSON | `GET /api/admin/audit-logs/export` | 200, content-type ndjson, streaming download |
| 3.12.8 | Export with filters | `GET /api/admin/audit-logs/export?resourceType=user` | 200, only filtered entries in export |

---

### 3.13 Admin — Client Management API

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.13.1 | List clients | `GET /api/admin/clients` with admin session | 200, list of OAuth clients |
| 3.13.2 | Get client detail | `GET /api/admin/clients/<clientId>` | 200, client details |
| 3.13.3 | Create client | `POST /api/admin/clients` body: `{"clientName":"Test App","redirectUris":["http://localhost:4000/callback"],"allowedScopes":["openid","profile"]}` | 201, client created with generated clientId + clientSecret |
| 3.13.4 | Update client | `PATCH /api/admin/clients/<clientId>` body: `{"clientName":"Updated App"}` | 200, client updated |
| 3.13.5 | Rotate client secret | `POST /api/admin/clients/<clientId>/rotate-secret` | 200, new secret returned |
| 3.13.6 | Delete client | `DELETE /api/admin/clients/<clientId>` | 200, client deleted |
| 3.13.7 | Non-admin access | Client API request with regular user | 403 Forbidden |

---

## PART 4: CROSS-APP INTEGRATION TESTS

### 4.1 End-to-End Flows

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 4.1.1 | Full registration → admin visibility | 1. Register user at web app 2. Verify email 3. Login to admin 4. Check user list | New user appears in admin user list with correct status |
| 4.1.2 | Admin suspend → web login blocked | 1. Suspend user in admin 2. Try to login as that user in web app | Login fails with account suspended error |
| 4.1.3 | Admin activate → web login works | 1. Activate suspended user in admin 2. Login as that user in web app | Login succeeds |
| 4.1.4 | Session revoke → web logout | 1. In admin, revoke a user's session 2. User tries to access protected page in web | User is redirected to login (session invalid) |
| 4.1.5 | Audit trail for admin actions | 1. Perform various actions in admin (suspend, role change) 2. Check audit logs | All admin actions recorded with correct actor, action, resource |
| 4.1.6 | OAuth full cycle | 1. Admin initiates OAuth login 2. User authenticates on web app 3. Consent granted 4. Admin receives tokens 5. Admin uses access token | Complete OAuth flow works across apps |

---

### 4.2 Security Tests

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 4.2.1 | Session cookie httpOnly | Inspect session cookie in browser dev tools | Cookie is httpOnly, cannot be read by JavaScript |
| 4.2.2 | CORS enforcement | Make API request from `http://evil.com` origin | Request blocked by CORS policy |
| 4.2.3 | Rate limit persistence | Hit rate limit, wait, verify it resets | Rate limit resets after window (15 min for auth) |
| 4.2.4 | Token not reusable after revoke | Revoke a token, try to use it | 401 Unauthorized |
| 4.2.5 | Password not in responses | Check all API responses | passwordHash never appears in any response |
| 4.2.6 | Email enumeration safe | Try forgot-password with existing and non-existing emails | Same response for both (no enumeration) |

---

## PART 5: GAPS & MISSING COVERAGE

These are features that exist in the API but have **no UI** or are **not fully testable** from the current web/admin apps:

| # | Feature | Status | Where to Test |
|---|---------|--------|---------------|
| 5.1 | **Passkey management UI** (list, rename, delete) | API only — no web UI page | API: `GET/PATCH/DELETE /api/account/passkeys` |
| 5.2 | **TOTP enrollment UI** | API only — no web UI page | API: `POST /api/account/mfa/totp/enroll` then use authenticator app |
| 5.3 | **Profile edit UI** (display name, metadata) | API only — web shows profile but no edit form | API: `PATCH /api/account/profile` |
| 5.4 | **Change password UI** | API only — no web UI page for changing password while logged in | API: `POST /api/auth/change-password` |
| 5.5 | **OAuth client management UI** | API only — admin dashboard doesn't have a clients page | API: `GET/POST/PATCH/DELETE /api/admin/clients` |
| 5.6 | **Role permission management UI** | API only — admin can create roles but not assign permissions via UI | API: `PUT /api/admin/roles/:id/permissions` |
| 5.7 | **Consent management UI** (revoke consent) | API only — no UI to view/revoke OAuth consents | API: `DELETE /oauth/consent/:clientId` |
| 5.8 | **DPoP token binding** | API only — requires custom HTTP client | API: `DPoP` header on token requests |
| 5.9 | **End session endpoint** | API only | `GET /oauth/end-session` |
| 5.10 | **Session list UI** (user's own sessions) | API only — no web UI for users to see their sessions | API: `GET /api/account/sessions` |
| 5.11 | **Recovery code regeneration UI** | API only | API: `POST /api/account/mfa/recovery-codes/regenerate` |
| 5.12 | **Admin bulk session revoke UI** | API exists but no dedicated UI button | API: `DELETE /api/admin/users/:id/sessions` |

---

## Recommended Test Order

1. **Setup**: Start all 3 apps (Part 0 prerequisites)
2. **Web basics**: Registration → Email verification → Login → Profile (1.2 → 1.3 → 1.4 → 1.9)
3. **Admin login**: OAuth flow to admin dashboard (2.1)
4. **Admin features**: Users → Roles → Sessions → Audit Logs (2.2 → 2.5 → 2.6 → 2.7)
5. **User detail ops**: Status changes, role assignment (2.3 → 2.4)
6. **Cross-app**: Registration visibility, suspend/activate, session revoke (4.1)
7. **Password flows**: Forgot/reset password (1.7 → 1.8)
8. **MFA flows**: TOTP enroll via API, then login with MFA in web (3.5 → 1.5)
9. **OAuth/OIDC**: Discovery, PAR, token exchange, introspection (3.8)
10. **API-only features**: Client management, passkeys, profile edit (3.6, 3.7, 3.13)
11. **Security**: Cookie flags, CORS, rate limits, enumeration (4.2)
12. **Gaps**: Test API-only features listed in Part 5
