import { expect, test } from './fixtures';

for (const [role, port, route, label] of [
  ['rider', 8091, 'ride', 'ride'],
  ['driver', 8092, 'trip', 'trip'],
] as const) {
  test(`${role} signed-out trip links recover through account setup without private reads or mutations`, async ({
    page,
  }) => {
    let tripRequests = 0;
    await page.route('**/v1/rides/*', async (request) => {
      tripRequests += 1;
      await request.abort();
    });
    await page.goto(`http://localhost:${port}/${route}?id=00000000-0000-4000-8000-000000000001`);
    await expect(page.getByText(`Sign in to view your ${label}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Loading your ${label}…`, { exact: true })).toHaveCount(0);
    expect(tripRequests).toBe(0);
    await page.getByRole('button', { name: 'Continue to your account', exact: true }).click();
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: role === 'rider' ? 'Where are you going?' : 'Open your account',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: role === 'rider' ? 'My rides' : 'Trips', exact: true }).click();
    await expect(page.getByText('Your rides and their latest status', { exact: true })).toBeVisible();
  });
}
