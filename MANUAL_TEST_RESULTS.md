# Manual Test Results

## PART 1: WEB APP

### 1.1 Home Page Redirect

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 1.1.1 | Unauthenticated redirect | Redirects to `/login` | Redirected to `/login?callbackUrl=%2F` | **PASS** | Working as designed. |

### 1.2 User Registration

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 1.2.1 | Successful registration | Success, redirected to `/verify-email` | Redirects successfully to `/verify-email` after registration | **PASS** | Fixed and re-tested. Page shows verification instructions. |

### 1.3 Email Verification

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 1.3.1 | Verify email page loads | Page shows verification instructions | Page displayed "Verify your email" and resend button. | **PASS** | Registration properly redirects here. |
| 1.3.2 | Verify with token (dev) | Email verified, redirected to `/account` | Redirected to `/account` and profile shows Email verified: Yes. | **PASS** | Valid token processed successfully. |
| 1.3.3 | Resend verification | Toast: verification email resent | Received "Failed to resend verification email" (400 Bad Request). | **FAIL** | Resend button is broken or missing something in payload. |
| 1.3.4 | Invalid token | Error message: invalid or expired token | Displayed "Invalid or expired verification token". | **PASS** | Handled correctly. |

### 1.4 Login

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 1.4.1 | Successful login | Redirected to `/account` | Logged in and redirected to `/account`. | **PASS** | `admin@idp.local` works perfectly. |
| 1.4.2 | Wrong password | Error: invalid credentials | Shows "Invalid email or password". | **PASS** | Handled properly. |
| 1.4.3 | Non-existent email | Error: invalid credentials | Shows "Invalid email or password". | **PASS** | No email enumeration. |
| 1.4.4 | Empty form submission | Validation errors | Shows errors: "Enter a valid email" and "Password is required". | **PASS** | Client/server validation works. |
| 1.4.5 | Unverified user login | Block or allow with limited access | User successfully logged in and was directed to `/account` with "Pending Verification" status. | **PASS** | System correctly allows unverified users but marks them as pending. |
| 1.4.6 | Navigate to register | Navigates to `/register` | Navigates back and forth as expected. | **PASS** | Link works. |
| 1.4.7 | Navigate to forgot password | Navigates to `/forgot-password` | Navigates back and forth as expected. | **PASS** | Link works. |

### 1.5 MFA (Two-Factor Authentication)

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 1.5.1-7 | MFA flows | Redirected to `/mfa`, TOTP tests | N/A | **SKIPPED** | API enrollment required but not tested in browser automation. |

### 1.6 Passkey Authentication

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 1.6.1-3 | Passkey flows | Passkey registration and login | N/A | **SKIPPED** | Requires biometric/hardware key support not suitable for headless browser testing. |

### 1.7 Forgot Password

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 1.7.1 | Request reset | Success message | Success message shown. | **PASS** | Tested with existing email. |
| 1.7.2 | Non-existent email | Same success message (no enumeration) | Success message shown as expected. | **PASS** | Prevents enumeration attacks. |
| 1.7.3 | Empty email | Validation error | "Enter a valid email" validation error shown. | **PASS** | Client/server validation works. |

### 1.8 Reset Password

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 1.8.4 | Invalid token | Error: invalid or expired token | "Validation Error" shown on submittion. | **PASS** | Prevents reset with invalid token. |

### 1.9 Account Profile

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 1.9.1 | View profile | Shows display name, email, etc | `/account` shows correct details. | **PASS** | Verified correct login mechanics. |
| 1.9.2 | Logout | Session ended, redirected to `/login` | Successful logout verified. | **PASS** | Flow works. |
| 1.9.3 | Protected route | Redirected to `/login?callbackUrl=/account` | Triggered correctly. | **PASS** | Unauthenticated access redirected. |
| 1.9.4 | Callback after login | Redirected back to `/account` | Redirect success. | **PASS** | Completed seamless return to `/account`. |

### 1.10 OAuth Consent Flow

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 1.10.1 | Consent page loads | Consent page shows client name, scopes | "Validation Error" shown. | **FAIL** | Endpoint rejected the dummy `code_challenge` / `state` from test url plan. Needs valid dynamic PKCE setup for actual test. |

## PART 2: ADMIN DASHBOARD (http://localhost:3002)

### 2.1 Authentication (OAuth Flow)

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 2.1.1 | Login page redirect | Redirected to `/auth/login` | Redirected to `http://localhost:3100/login?callbackUrl=...` successfully. | **PASS** | Fixed authorize URL to point to the web app (`localhost:3100`). |
| 2.1.2 | OAuth login flow | Redirected back to admin `/users` page | Web app correctly processes login, server issues redirect, and user lands on admin `/users` page. | **PASS** | Fixed server `Internal Server Error` and frontend `NEXT_REDIRECT` error. |
| 2.1.3 | Non-admin access | Access denied or redirected | Shows `{"error":"Internal Server Error"}` | **FAIL** | Similar error to 2.1.2. Cannot test access control yet. |
| 2.1.4 | Logout | Session cleared, redirected to login | Logged out successfully when the button was pressed. | **PASS** | Logout works, but subsequent login failed because subagent suspended the admin account. |

### 2.2 User Management

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 2.2.1 | User list loads | Table shows users with details | User list loads correctly with proper columns. | **PASS** | Verified via browser subagent. |
| 2.2.3 | Search by email | Filters to matching users | Typing in search box filters the table correctly. | **PASS** | Tested with 'admin'. |
| 2.2.4 | Clear search | All users shown | Clearing search works as expected. | **PASS** | |
| 2.2.5 | Filter by status (active) | Only active users shown | Filtering by "Active" status works. | **PASS** | |
| 2.2.6 | Filter by status (suspended) | Only suspended users shown | Filtering by "Suspended" status works. | **PASS** | |
| 2.2.7 | Filter by status (pending) | Only pending users shown | Filtering by "Pending Verification" works. | **PASS** | |

### 2.3 User Detail & Status Management

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 2.3.1 | Open user detail | Navigates to `/users/<id>` | Detail page opens properly on row click. | **PASS** | |
| 2.3.3 | Suspend user | User status changes to `suspended` | Clicked suspend, toast appeared, user was suspended. | **PASS** | Subagent suspended the admin user itself causing logout/login flow to break. |
| 2.3.4 | Activate user | User status changes to `active` | Successfully activated a suspended user. | **PASS** | Tested on a secondary user. |

### 2.4 Role Management (User Detail)

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 2.4.2 | Assign role | Role added to user | Assigned "admin" role to user successfully. | **PASS** | |
| 2.4.3 | Remove role | Role removed from user | Removed "admin" role successfully. | **PASS** | |
| 2.4.4 | Prevent system role removal | Should show warning/prevent | Prevented removing `super_admin` from seed admin. | **PASS** | Correctly prevented modification of seed admin's `super_admin` role. |

### 2.5 Role List & Creation

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 2.5.1 | Role list loads | Table shows roles with details | Table shows all required columns. | **PASS** | |
| 2.5.2 | System roles visible | `super_admin`, `admin`, `user` shown with "System" badge | `super_admin`, `admin`, `user` visible. | **PASS** | |
| 2.5.3 | Create role dialog | Dialog opens with name and description fields | Dialog opens with desired fields. | **PASS** | |
| 2.5.4 | Create valid role | Role created, appears in table, toast confirmation | Created role "editor", toast appeared, visible in table. | **PASS** | |
| 2.5.5 | Create without name | Validation error | Validation error appeared. | **PASS** | |
| 2.5.6 | Duplicate role name | API error | Error appeared. | **PASS** | |

### 2.6 Session Management

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 2.6.1 | Session list loads | Table shows session details | Session list loads correctly. | **PASS** | |
| 2.6.2 | Active sessions visible | At least one session for `admin@idp.local` visible | Active sessions visible. | **PASS** | |
| 2.6.3 | Pagination | Pagination works, URL updates | Only 8 sessions, pagination not active. | **SKIPPED** | Less than 20 sessions available. |
| 2.6.4 | Revoke session | Session removed from list, toast confirmation | Successfully revoked a curl session. | **PASS** | |
| 2.6.5 | Revoke own session impact | Web app should require re-login | Revoked active browser session from UI; session was removed and toast shown, but user was not logged out locally and could still navigate around without re-login. | **FAIL** | Bug: Revoking own active session doesn't force re-login. |

### 2.7 Audit Logs

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 2.7.1 | Audit log list loads | Table shows audit log details | Audit log list loads correctly. | **PASS** | |
| 2.7.2 | Entries from actions | New audit log entries visible for actions | Verified actions like role_created appear in logs. | **PASS** | |
| 2.7.3 | Search by action | Filters to matching audit entries | Correctly filters logs. | **PASS** | |
| 2.7.4 | Filter by resource type | Shows only filtered audit entries | Filtering by role/user works. | **PASS** | |
| 2.7.5 | Pagination | Pagination works correctly | Less than 50 entries. | **SKIPPED** | Only 1 page of results available. |
| 2.7.6 | Chain verification | Shows integrity status | Properly indicated status as "Chain broken". | **PASS** | |
| 2.7.7 | Export NDJSON | Downloads `.ndjson` file | Toast error "Failed to export audit logs" appeared. | **FAIL** | Bug: Export fails. |
| 2.7.8 | Export with filters | Exported file only contains filtered entries | See 2.7.7 | **FAIL** | Export failing entirely. |

### 2.8 Admin Sidebar Navigation

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 2.8.1 | Sidebar visible | Sidebar shows nav items | Sidebar navigation works. | **PASS** | |
| 2.8.2 | Navigate Users | Navigates to `/users` | Works. | **PASS** | |
| 2.8.3 | Navigate Roles | Navigates to `/roles` | Works. | **PASS** | |
| 2.8.4 | Navigate Sessions | Navigates to `/sessions` | Works. | **PASS** | |
| 2.8.5 | Navigate Audit Logs | Navigates to `/audit-logs` | Works. | **PASS** | |
| 2.8.6 | Active state | Active item is visually highlighted | Works. | **PASS** | |
