import { expect, test } from './fixtures';
test('driver sees bank payout status separately from setup, pages history and clears stale data after refresh failure', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let failed = false,
    older = false;
  const item = {
    id: 'po_current',
    amountCents: 12550,
    currency: 'usd',
    status: 'in_transit',
    createdAt: '2026-09-10T12:00:00Z',
    expectedArrivalAt: '2026-09-14T00:00:00Z',
    destinationType: 'bank_account',
  };
  await page.route('**/v1/drivers/me/payout-setup', (route) => route.fulfill({ json: { status: 'ready' } }));
  await page.route('**/v1/drivers/me/payout-history*', (route) => {
    if (failed) return route.abort();
    older = new URL(route.request().url()).searchParams.has('after');
    return route.fulfill({
      json: {
        status: 'available',
        items: [older ? { ...item, id: 'po_old', status: 'failed', amountCents: 3400 } : item],
        nextCursor: older ? null : 'po_current',
        checkedAt: '2026-09-12T12:00:00Z',
      },
    });
  });
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Payout setup', exact: true }).click();
  await expect(page.getByText('On the way', { exact: true })).toBeVisible();
  await expect(page.getByText('$125.50', { exact: true })).toBeVisible();
  await expect(page.getByText('Estimated arrival Sep 14, 2026', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('bank-payouts.png'), fullPage: true });
  await page.getByRole('button', { name: 'Older payouts', exact: true }).click();
  await expect(page.getByText('Payout failed', { exact: true })).toBeVisible();
  expect(older).toBe(true);
  await expect(page.getByText('$125.50', { exact: true })).toBeVisible();
  failed = true;
  await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
  await expect(
    page.getByText('Unable to load bank payouts. Pull down to try again.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('$125.50', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Stripe details are ready.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
