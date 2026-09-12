import { expect, test } from './fixtures';

for (const savedRequest of [false, true]) {
  test(`booking storage retry restores ${savedRequest ? 'the saved request without replay' : 'route entry'}`, async ({
    page,
  }) => {
    let bookings = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/rides') bookings++;
    });
    await page.goto('http://localhost:8091');
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
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
    await page.getByRole('button', { name: 'Where are you going?', exact: true }).click();
    await expect(page.getByText('Check your previous request', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Retry reading request', exact: true }).click();
    await expect(page.getByText('Contact support before another action.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Contact support', exact: true })).toBeVisible();
    if (!savedRequest) await page.screenshot({ path: 'reports/booking-storage-recovery.png' });
    await expect(page.getByLabel('Pickup address', { exact: true })).toHaveCount(0);
    await page.evaluate((save) => {
      sessionStorage.removeItem('e2e.fail-operation-read');
      if (save) {
        const key = sessionStorage.getItem('e2e.operation-key');
        if (!key) throw new Error('No operation read captured');
        sessionStorage.setItem(
          key,
          JSON.stringify({
            key: '00000000-0000-4000-8000-000000000001',
            operation: { kind: 'book', quoteId: '00000000-0000-4000-8000-000000000002' },
          }),
        );
      }
    }, savedRequest);
    await page.getByRole('button', { name: 'Retry reading request', exact: true }).click();
    if (savedRequest) {
      await expect(page.getByRole('button', { name: 'Check booking result', exact: true })).toBeVisible();
      await expect(page.getByLabel('Pickup address', { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByLabel('Pickup address', { exact: true })).toBeVisible();
    }
    expect(bookings).toBe(0);
  });
}
