import { test, expect } from '@playwright/test';
test('driver can inspect payout setup without claiming a synthetic bank account is connected', async ({
  page,
}) => {
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Payout setup', exact: true }).click();
  await expect(page.getByText('Payout setup is not available yet.', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Synthetic preview. No bank account is connected and no real payouts are enabled.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Stripe', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
  await expect(page.getByText('Payout setup is not available yet.', { exact: true })).toBeVisible();
});
