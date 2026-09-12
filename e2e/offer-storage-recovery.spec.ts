import { expect, test } from './fixtures';

for (const savedRequest of [false, true]) {
  test(`offer storage retry restores ${savedRequest ? 'the saved acceptance without replay' : 'offer lookup'}`, async ({
    page,
  }) => {
    let mutations = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/offers\//.test(new URL(request.url()).pathname)) mutations++;
    });
    await page.goto('http://localhost:8092');
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open your account', exact: true })).toBeVisible();
    await page.evaluate(() => {
      const read = Storage.prototype.getItem;
      sessionStorage.setItem('e2e.fail-operation-read', 'yes');
      Storage.prototype.getItem = function (key) {
        if (key.startsWith('rove.operation.')) {
          sessionStorage.setItem('e2e.operation-key', key);
          if (read.call(sessionStorage, 'e2e.fail-operation-read') === 'yes')
            throw new Error('Storage unavailable');
        }
        return read.call(this, key);
      };
    });
    let reads = 0;
    await page.route('**/v1/drivers/me/offers', (route) =>
      route.fulfill({
        json: {
          offers:
            reads++ === 0
              ? [
                  {
                    id: '00000000-0000-4000-8000-000000000002',
                    rideId: 'synthetic-recovery-ride',
                    expiresAt: new Date(Date.now() + 60000).toISOString(),
                    pickupArea: 'Raleigh',
                    destinationArea: 'Durham',
                    service: 'standard',
                    pickupSeconds: 240,
                    tripSeconds: 1080,
                    distanceMeters: 10300,
                    estimatedEarnings: { amount: 2600, currency: 'USD' },
                  },
                ]
              : [],
        },
      }),
    );
    await page.getByRole('button', { name: 'View ride request', exact: true }).click();
    await expect(page.getByText('Check your previous request', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Retry reading request', exact: true }).click();
    await expect(page.getByText('Contact support before another action.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Contact support', exact: true })).toBeVisible();
    if (!savedRequest) await page.screenshot({ path: 'reports/offer-storage-recovery.png' });
    await expect(page.getByRole('button', { name: 'Accept ride', exact: true })).toHaveCount(0);
    await page.evaluate((save) => {
      sessionStorage.removeItem('e2e.fail-operation-read');
      if (save) {
        const key = sessionStorage.getItem('e2e.operation-key');
        if (!key) throw new Error('No operation read captured');
        sessionStorage.setItem(
          key,
          JSON.stringify({
            key: '00000000-0000-4000-8000-000000000001',
            operation: { kind: 'accept', offerId: '00000000-0000-4000-8000-000000000002' },
          }),
        );
      }
    }, savedRequest);
    await page.getByRole('button', { name: 'Retry reading request', exact: true }).click();
    if (savedRequest) {
      await expect(page.getByRole('button', { name: 'Check acceptance result', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Accept ride', exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText('This request is no longer available.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Back to driving', exact: true })).toBeVisible();
    }
    expect(mutations).toBe(0);
  });
}
