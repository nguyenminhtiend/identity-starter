import { expect, test } from '@playwright/test';

test.describe('OAuth Consent Flow', () => {
  test.skip(!process.env.TEST_OAUTH_CLIENT_ID, 'Requires TEST_OAUTH_CLIENT_ID env var');

  const clientId = process.env.TEST_OAUTH_CLIENT_ID ?? '';
  const redirectUri = process.env.TEST_OAUTH_REDIRECT_URI ?? 'http://localhost:4000/callback';

  test('shows consent page for new authorization', async ({ page }) => {
    const email = `e2e-consent-${Date.now()}@test.example`;
    await page.goto('/register');
    await page.getByLabel(/name/i).fill('Consent User');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill('TestPassword123!');
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/(account|verify-email)/);

    const authUrl = `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid+profile+email&state=test-state&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256`;
    await page.goto(authUrl);

    await expect(page.getByText(/wants to access/i)).toBeVisible();
    await expect(page.getByText(/profile/i)).toBeVisible();
    await expect(page.getByText(/email/i)).toBeVisible();

    await page.getByRole('button', { name: /deny/i }).click();
    await expect(page).toHaveURL(new RegExp(redirectUri));
  });
});
