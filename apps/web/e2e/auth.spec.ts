import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Authentication', () => {
  const testEmail = `e2e-${Date.now()}@test.example`;

  test('registers a new user', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText(/create your account/i)).toBeVisible();
    await page.getByLabel(/name/i).fill('E2E User');
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill('TestPassword123!');
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/(account|verify-email)/);
  });

  test('logs in with existing user', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText(/welcome back/i)).toBeVisible();
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill('TestPassword123!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/account/);
  });

  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows forgot password page', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByText(/reset your password/i)).toBeVisible();
  });
});
