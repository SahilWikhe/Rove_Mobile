import { expect, test } from './fixtures';

const rideId = '00000000-0000-4000-8000-000000000021';
const trip = {
  id: rideId,
  state: 'en_route',
  version: 2,
  fare: { amount: 1800, currency: 'USD' },
  paymentState: 'authorized',
  pickupArea: 'Recovery pickup',
  destinationArea: 'Recovery destination',
  createdAt: '2026-09-12T12:00:00.000Z',
};
for (const role of ['rider', 'driver'] as const) {
  for (const saved of [false, true]) {
    test(`${role} trip storage retry ${saved ? 'preserves an uncertain action' : 'restores trip controls'}`, async ({
      page,
    }) => {
      let mutations = 0;
      page.on('request', (request) => {
        if (request.method() === 'POST' && /\/v1\/(rides|offers)/.test(new URL(request.url()).pathname))
          mutations++;
      });
      await page.goto(`http://localhost:${role === 'rider' ? 8091 : 8092}`);
      await page.getByRole('button', { name: 'Get started', exact: true }).click();
      await expect(
        page.getByRole('button', {
          name: role === 'rider' ? 'Where are you going?' : 'Account',
          exact: true,
        }),
      ).toBeVisible();
      await page.route('**/v1/rides', (route) =>
        route.fulfill({ json: { rides: [trip], nextCursor: null } }),
      );
      await page.route(`**/v1/rides/${rideId}`, (route) => route.fulfill({ json: trip }));
      await page.getByRole('button', { name: role === 'rider' ? 'My rides' : 'Trips', exact: true }).click();
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
      await page.getByRole('button', { name: /Recovery pickup to Recovery destination/ }).click();
      const action = page.getByRole('button', {
        name: role === 'rider' ? 'Cancel ride' : 'I’ve arrived',
        exact: true,
      });
      await expect(page.getByText('Check your previous request', { exact: true })).toBeVisible();
      await expect(action).toHaveCount(0);
      await page.getByRole('button', { name: 'Retry reading request', exact: true }).click();
      await expect(page.getByText('Contact support before another action.', { exact: false })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Contact support', exact: true })).toBeVisible();
      await expect(page.getByText('Recovery destination', { exact: true }).first()).toBeVisible();
      if (!saved)
        await page.screenshot({ path: `reports/${role}-trip-storage-recovery.png`, fullPage: true });
      await page.evaluate(
        ({ save, id, actor }) => {
          sessionStorage.removeItem('e2e.fail-operation-read');
          if (save) {
            const key = sessionStorage.getItem('e2e.operation-key');
            if (!key) throw new Error('Operation key missing');
            sessionStorage.setItem(
              key,
              JSON.stringify({
                key: '00000000-0000-4000-8000-000000000022',
                operation: {
                  kind: 'transition',
                  rideId: id,
                  version: 2,
                  state: actor === 'rider' ? 'cancelled' : 'arrived',
                },
              }),
            );
          }
        },
        { save: saved, id: rideId, actor: role },
      );
      await page.getByRole('button', { name: 'Retry reading request', exact: true }).click();
      if (saved) {
        await expect(page.getByRole('button', { name: 'Check previous action', exact: true })).toBeVisible();
        await expect(action).toHaveCount(0);
      } else {
        await expect(action).toBeVisible();
        await action.click();
        await expect(
          page.getByRole('button', {
            name: role === 'rider' ? 'Confirm cancellation' : 'Confirm: I’ve arrived',
            exact: true,
          }),
        ).toBeVisible();
      }
      expect(mutations).toBe(0);
    });
  }
}
