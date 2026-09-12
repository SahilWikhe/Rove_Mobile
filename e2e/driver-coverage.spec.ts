import { expect, test } from '@playwright/test';

test('driver coverage persists and retries a lost save response without widening it twice', async ({
  page,
  request,
}) => {
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Coverage radius', exact: true }).click();
  const field = page.getByLabel('Pickup radius (miles)', { exact: true });
  await expect(field).toBeEditable();
  await field.fill('0');
  await expect(page.getByRole('button', { name: 'Save coverage', exact: true })).toBeDisabled();
  await field.fill('35');
  const keys: string[] = [];
  await page.route('**/v1/drivers/me/coverage', async (route) => {
    keys.push(route.request().headers()['idempotency-key']!);
    if (keys.length === 1) {
      const result = await route.fetch();
      expect(result.ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Save coverage', exact: true }).click();
  await expect(field).not.toBeEditable();
  await page.getByRole('button', { name: 'Retry coverage save', exact: true }).click();
  await expect(page.getByText('Coverage saved: 35 miles.', { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(new Set(keys).size).toBe(1);
  const profile = await request.get('http://localhost:4085/v1/drivers/me', {
    headers: { Authorization: 'Bearer synthetic-driver' },
  });
  expect((await profile.json()).coverageRadiusMiles).toBe(35);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({ path: 'test-results/driver-coverage.png', fullPage: true });
  const forbidden = await request.put('http://localhost:4085/v1/drivers/me/coverage', {
    headers: { Authorization: 'Bearer synthetic-rider', 'Idempotency-Key': crypto.randomUUID() },
    data: { radiusMiles: 40 },
  });
  expect(forbidden.status()).toBe(403);
  await page.unroute('**/v1/drivers/me/coverage');
  await field.fill('25');
  await page.getByRole('button', { name: 'Save coverage', exact: true }).click();
  await expect(page.getByText('Coverage saved: 25 miles.', { exact: true })).toBeVisible();
});
