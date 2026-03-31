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

## PART 2: ADMIN DASHBOARD (http://localhost:3002)

### 2.1 Authentication (OAuth Flow)

| # | Test | Expected Result | Actual Result | Status | Notes |
|---|------|-----------------|---------------|--------|-------|
| 2.1.1 | Login page redirect | Redirected to `/auth/login` | Redirected to `http://localhost:3100/login?callbackUrl=...` successfully. | **PASS** | Fixed authorize URL to point to the web app (`localhost:3100`). |
| 2.1.2 | OAuth login flow | Redirected back to admin `/users` page | Web app correctly processes login, server issues redirect, and user lands on admin `/users` page. | **PASS** | Fixed server `Internal Server Error` and frontend `NEXT_REDIRECT` error. |
| 2.1.3 | Non-admin access | Access denied or redirected | Shows `{"error":"Internal Server Error"}` | **FAIL** | Similar error to 2.1.2. Cannot test access control yet. |
| 2.1.4 | Logout | Session cleared, redirected to login | N/A | **BLOCKED** | Cannot reach admin UI to click logout due to login failure. |
