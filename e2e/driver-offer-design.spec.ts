import { expect, test } from './fixtures';

test('offer sheet wraps broad areas and disables expired responses', async ({ page }) => {
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.route('**/v1/drivers/me/offers', (route) =>
    route.fulfill({
      json: {
        offers: [
          {
            id: 'synthetic-design-offer',
            rideId: 'synthetic-design-ride',
            expiresAt: new Date(Date.now() + 4000).toISOString(),
            pickupArea: 'Northwest Raleigh and surrounding neighborhoods',
            destinationArea: 'Downtown Durham and surrounding neighborhoods',
            service: 'accessible',
            pickupSeconds: 240,
            tripSeconds: 1080,
            distanceMeters: 10300,
            estimatedEarnings: { amount: 2600, currency: 'USD' },
          },
        ],
      },
    }),
  );
  await page.getByRole('button', { name: 'View ride request', exact: true }).click();
  await expect(page.getByText('New ride request', { exact: true })).toBeVisible();
  await expect(page.getByText('Wheelchair-accessible service', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Northwest Raleigh and surrounding neighborhoods', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('$26.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept ride', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('button', { name: 'Decline', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Decline', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(page.getByText('OFFER EXPIRED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept ride', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Decline', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('New ride request', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/rove-offer-sheet-web.png', fullPage: true });
  await page.getByRole('button', { name: 'Back to driving', exact: true }).click();
  await expect(page).toHaveURL(/\/drive$/);
});
