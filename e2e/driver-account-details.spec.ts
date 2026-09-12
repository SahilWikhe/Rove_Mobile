import { expect, test } from './fixtures';

test('Account shows current vehicle and review details and refreshes on return', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let activityUnavailable = false;
  await page.route('**/v1/drivers/me/activity', (route) =>
    activityUnavailable
      ? route.abort()
      : route.fulfill({
          json: { completedTrips: 1240, acceptedOffers: 1300, joinedAt: '2025-01-15T00:00:00Z' },
        }),
  );
  let payout = 'needs_information';
  let vehicleUnavailable = false;
  await page.route('**/v1/drivers/me/vehicle-submission', async (route) => {
    if (vehicleUnavailable) return route.abort();
    await route.fulfill({
      json: {
        submission: {
          revision: '00000000-0000-4000-8000-000000000001',
          vehicle: {
            make: 'Toyota',
            model: 'Sienna',
            year: 2025,
            color: 'Black',
            plate: 'TEST123',
            registrationRegion: 'NC',
            requestedService: 'standard',
          },
          status: 'approved',
          corrections: [],
          submittedAt: '2026-09-01T00:00:00Z',
        },
      },
    });
  });
  await page.route('**/v1/drivers/me/documents', (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: '00000000-0000-4000-8000-000000000002',
            kind: 'driver_license',
            state: 'quarantined',
            verification: 'replacement_required',
            createdAt: '2026-09-01T00:00:00Z',
            expiresAt: '2026-09-01T00:15:00Z',
          },
        ],
      },
    }),
  );
  await page.route('**/v1/drivers/me/payout-setup', (route) => route.fulfill({ json: { status: payout } }));
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  const vehicle = page.getByRole('button', { name: 'Vehicle & review status', exact: true });
  const documents = page.getByRole('button', { name: 'Documents & credentials', exact: true });
  const payouts = page.getByRole('button', { name: 'Payout setup', exact: true });
  await expect(page.getByText('TRIPS COMPLETED', { exact: true })).toBeVisible();
  await expect(page.getByText('1,240', { exact: true })).toBeVisible();
  await expect(page.getByText('1,300', { exact: true })).toBeVisible();
  await expect(page.getByText('Jan 2025', { exact: true })).toBeVisible();
  await expect(vehicle).toContainText('Toyota Sienna · TEST123');
  await expect(documents).toContainText('1 needs attention');
  await expect(payouts).toContainText('Action needed');
  await page.screenshot({ path: testInfo.outputPath('driver-account-details.png'), fullPage: true });
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
  activityUnavailable = true;
  vehicleUnavailable = true;
  payout = 'ready';
  await page.goBack();
  await expect(
    page.getByText('Activity unavailable. Pull down to try again.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('1,240', { exact: true })).toHaveCount(0);
  await expect(vehicle).toContainText('Unable to load');
  await expect(vehicle).not.toContainText('Toyota');
  await expect(payouts).toContainText('Details ready');
  await expect(documents).toContainText('1 needs attention');
  await vehicle.click();
  await expect(page.getByRole('button', { name: 'Reload vehicle', exact: true })).toBeVisible();
});
