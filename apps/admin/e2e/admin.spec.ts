import { expect, test } from '@playwright/test';

test.describe('Admin Dashboard', () => {
  test.skip(
    !process.env.TEST_ADMIN_EMAIL || !process.env.TEST_ADMIN_PASSWORD,
    'Requires TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD env vars',
  );

  const adminEmail = process.env.TEST_ADMIN_EMAIL ?? '';
  const adminPassword = process.env.TEST_ADMIN_PASSWORD ?? '';

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(adminEmail);
    await page.getByLabel(/password/i).fill(adminPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/users');
  });

  test('shows users page', async ({ page }) => {
    await expect(page.getByText(/user management/i)).toBeVisible();
  });

  test('shows roles page', async ({ page }) => {
    await page.goto('/roles');
    await expect(page.getByText(/role management/i)).toBeVisible();
  });

  test('shows sessions page', async ({ page }) => {
    await page.goto('/sessions');
    await expect(page.getByText(/active sessions/i)).toBeVisible();
  });

  test('shows audit logs page', async ({ page }) => {
    await page.goto('/audit-logs');
    await expect(page.getByText(/activity log/i)).toBeVisible();
  });

  test('redirects non-admin to login', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/users');
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
