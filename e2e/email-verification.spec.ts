import { expect, test } from './fixtures';

for (const [role, port] of [
  ['rider', 8091],
  ['driver', 8092],
] as const) {
  test(`${role} cannot continue past verification and can recover with a fresh sign-in`, async ({ page }) => {
    let verified = false;
    await page.route('**/v1/me', async (route) => {
      if (verified) return route.continue();
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'EMAIL_VERIFICATION_REQUIRED',
            message: 'Verify your email, then sign in again.',
            requestId: 'synthetic-verification',
          },
        }),
      });
    });
    await page.goto(`http://localhost:${port}`);
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await expect(page.getByText('Verify your email', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry loading account', exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'I verified my email — sign in', exact: true }).click();
    await expect(page.getByText('Verify your email', { exact: true })).toBeVisible();
    // The button is not proof of verification: only a successful API response grants access.
    verified = true;
    await page.getByRole('button', { name: 'I verified my email — sign in', exact: true }).click();
    await expect(page.getByText('Verify your email', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: role === 'rider' ? 'Where are you going?' : 'Account', exact: true }),
    ).toBeVisible();
  });
}
