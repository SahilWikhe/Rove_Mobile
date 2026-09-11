import { expect, test } from './fixtures';

test('Account exposes payment settings with an honest unavailable state in web preview', async ({ page }) => {
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Payment methods', exact: true }).click();
  await expect(page.getByText('Your saved payment methods', { exact: true })).toBeVisible();
  await expect(page.getByText(/Payment settings are not available in this build/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Manage saved payment methods', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved places', exact: true })).toBeVisible();
});
